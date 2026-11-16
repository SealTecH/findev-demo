import { encodeUpdates, UPDATE_FIELDS } from '../market/update-codec';
import { type Generator, ProducerEngine, type WasmProducer } from './producer-engine';
import type { WorkerToMain } from './protocol';
import { type ProducerSettings } from './settings';

const SETTINGS: ProducerSettings = { instrumentCount: 2, updatesPerBatch: 3, intervalMs: 500 };

// Every generated update: instrument 0 trades 1 unit at $100.
function fakeGenerator() {
  return {
    symbols: ['TKR001', 'TKR002'],
    generate: vi.fn<(batchSize: number) => Int32Array>((batchSize) =>
      encodeUpdates(
        Array.from({ length: batchSize }, () => ({
          instrumentIndex: 0,
          priceCents: 10_000,
          tradeQuantity: 1,
          bidCents: 9_999,
          askCents: 10_000,
          bidQuantity: 10,
          askQuantity: 10,
        })),
      ),
    ),
    free: vi.fn<() => void>(),
  } satisfies Generator;
}

function setup(wasm: Partial<WasmProducer> = {}) {
  const posted: WorkerToMain[] = [];
  const generators: ReturnType<typeof fakeGenerator>[] = [];
  const engine = new ProducerEngine({
    post: (message) => posted.push(message),
    loadWasm: async () => ({
      layout: [...UPDATE_FIELDS],
      createGenerator: () => {
        const generator = fakeGenerator();
        generators.push(generator);
        return generator;
      },
      ...wasm,
    }),
  });

  const of = <T extends WorkerToMain['type']>(type: T) =>
    posted.filter((m): m is Extract<WorkerToMain, { type: T }> => m.type === type);

  return { engine, posted, generators, of };
}

async function started(runId = 1, settings = SETTINGS, paused = false) {
  const context = setup();
  await context.engine.handle({ type: 'init', wasmUrl: '/wasm/producer_bg.wasm' });
  await context.engine.handle({ type: 'start', runId, settings, paused });
  return context;
}

describe('ProducerEngine', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  describe('initialization', () => {
    it('loads the Wasm module and reports ready', async () => {
      const { engine, posted } = setup();
      await engine.handle({ type: 'init', wasmUrl: '/wasm/producer_bg.wasm' });
      expect(posted).toEqual([{ type: 'ready' }]);
    });

    it('reports a failed load as an init error with the cause', async () => {
      const posted: WorkerToMain[] = [];
      const engine = new ProducerEngine({
        post: (m) => posted.push(m),
        loadWasm: () => Promise.reject(new Error('HTTP 404')),
      });
      await engine.handle({ type: 'init', wasmUrl: '/wasm/producer_bg.wasm' });
      expect(posted).toEqual([
        {
          type: 'error',
          runId: null,
          phase: 'init',
          message: 'Could not initialize the Wasm producer: HTTP 404',
        },
      ]);
    });

    it('rejects a Wasm module whose update layout differs', async () => {
      const { engine, of } = setup({ layout: ['priceCents'] });
      await engine.handle({ type: 'init', wasmUrl: '/wasm/producer_bg.wasm' });
      expect(of('error')[0]).toMatchObject({ phase: 'init', message: /does not match/ });
      expect(of('ready')).toEqual([]);
    });

    it('refuses to start before initialization', async () => {
      const { engine, of } = setup();
      await engine.handle({ type: 'start', runId: 1, settings: SETTINGS, paused: false });
      expect(of('error')[0]).toMatchObject({ runId: 1, phase: 'run' });
    });
  });

  describe('generation', () => {
    it('announces the run, then generates one batch per interval with the requested size', async () => {
      const { generators, of } = await started();
      expect(of('started')).toEqual([
        { type: 'started', runId: 1, symbols: ['TKR001', 'TKR002'], state: 'running' },
      ]);

      vi.advanceTimersByTime(499);
      expect(of('snapshot')).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(of('snapshot')).toHaveLength(1);
      vi.advanceTimersByTime(1_000);
      expect(of('snapshot')).toHaveLength(3);
      expect(generators[0].generate).toHaveBeenCalledWith(3);
    });

    it('posts cumulative totals and stats in every snapshot', async () => {
      const { of } = await started();
      vi.advanceTimersByTime(1_000);

      const last = of('snapshot').at(-1)!;
      expect(last.runId).toBe(1);
      expect(last.instruments[0]).toMatchObject({ volume: 6, notionalCents: 60_000n });
      expect(last.instruments[1].volume).toBe(0);
      expect(last.stats).toEqual({ batches: 2, updates: 6 });
    });

    it('posts copies, so later batches do not change an earlier snapshot', async () => {
      const { of } = await started();
      vi.advanceTimersByTime(1_000);
      expect(of('snapshot')[0].instruments[0].volume).toBe(3);
    });

    it('does not catch up missed batches after falling behind', async () => {
      const { of } = await started();
      // Freeze the clock 5 intervals ahead without running timers (a throttled tab).
      vi.setSystemTime(Date.now() + 2_500);
      vi.advanceTimersToNextTimer();
      expect(of('snapshot')).toHaveLength(1);
      vi.advanceTimersByTime(499);
      expect(of('snapshot')).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(of('snapshot')).toHaveLength(2);
    });
  });

  describe('pause and resume', () => {
    it('pausing stops generation; resuming keeps totals and skips the paused interval', async () => {
      const { engine, generators, of } = await started();
      vi.advanceTimersByTime(500);
      await engine.handle({ type: 'pause', runId: 1 });
      expect(of('status')).toEqual([{ type: 'status', runId: 1, state: 'paused' }]);

      vi.advanceTimersByTime(10_000);
      expect(generators[0].generate).toHaveBeenCalledTimes(1);

      await engine.handle({ type: 'resume', runId: 1 });
      expect(of('status').at(-1)).toEqual({ type: 'status', runId: 1, state: 'running' });
      vi.advanceTimersByTime(500);

      const last = of('snapshot').at(-1)!;
      expect(last.instruments[0].volume).toBe(6);
      expect(last.stats).toEqual({ batches: 2, updates: 6 });
    });

    it('a run can start paused: no batches until resume', async () => {
      const { engine, of } = await started(1, SETTINGS, true);
      expect(of('started')[0].state).toBe('paused');

      vi.advanceTimersByTime(10_000);
      expect(of('snapshot')).toHaveLength(0);

      await engine.handle({ type: 'resume', runId: 1 });
      vi.advanceTimersByTime(500);
      expect(of('snapshot')).toHaveLength(1);
    });

    it('ignores pause/resume for another run and repeated commands', async () => {
      const { engine, of } = await started(2);
      await engine.handle({ type: 'pause', runId: 1 });
      await engine.handle({ type: 'resume', runId: 2 });
      expect(of('status')).toEqual([]);

      await engine.handle({ type: 'pause', runId: 2 });
      await engine.handle({ type: 'pause', runId: 2 });
      expect(of('status')).toHaveLength(1);
    });
  });

  describe('starting a new run', () => {
    it('frees the previous generator and resets totals', async () => {
      const { engine, generators, of } = await started();
      vi.advanceTimersByTime(500);

      await engine.handle({ type: 'start', runId: 2, settings: SETTINGS, paused: false });
      expect(generators[0].free).toHaveBeenCalledOnce();

      vi.advanceTimersByTime(500);
      const last = of('snapshot').at(-1)!;
      expect(last.runId).toBe(2);
      expect(last.instruments[0].volume).toBe(3);
      expect(last.stats.batches).toBe(1);
    });

    it('starts generating even if the previous run was paused', async () => {
      const { engine, of } = await started();
      await engine.handle({ type: 'pause', runId: 1 });
      await engine.handle({ type: 'start', runId: 2, settings: SETTINGS, paused: false });
      vi.advanceTimersByTime(500);
      expect(of('snapshot').map((s) => s.runId)).toEqual([2]);
    });

    it("the old run's timer never generates into the new run", async () => {
      const { engine, generators } = await started();
      await engine.handle({
        type: 'start',
        runId: 2,
        settings: { ...SETTINGS, intervalMs: 2_000 },
        paused: false,
      });
      vi.advanceTimersByTime(1_999);
      expect(generators[0].generate).not.toHaveBeenCalled();
      expect(generators[1].generate).not.toHaveBeenCalled();
    });
  });

  it('stops and reports a run error when generation fails', async () => {
    const { generators, of } = await started();
    generators[0].generate.mockImplementation(() => {
      throw new Error('unreachable');
    });
    vi.advanceTimersByTime(500);

    expect(of('error')).toEqual([
      { type: 'error', runId: 1, phase: 'run', message: 'The producer stopped: unreachable' },
    ]);
    expect(generators[0].free).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(5_000);
    expect(generators[0].generate).toHaveBeenCalledOnce();
  });
});
