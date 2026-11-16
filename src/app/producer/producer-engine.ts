import { applyBatch, createAggregates } from '../market/aggregator';
import type { InstrumentAggregate } from '../market/models';
import { assertLayout, STRIDE } from '../market/update-codec';
import { assertNever, type MainToWorker, type WorkerToMain } from './protocol';
import type { ProducerSettings } from './settings';

// One run of the Wasm generator.
export interface Generator {
  readonly symbols: readonly string[];
  generate(batchSize: number): Int32Array;
  free(): void;
}

export interface WasmProducer {
  readonly layout: readonly string[];
  createGenerator(instrumentCount: number, seed: number): Generator;
}

export interface EngineDeps {
  loadWasm(url: string): Promise<WasmProducer>;
  post(message: WorkerToMain): void;
}

interface Run {
  readonly id: number;
  readonly settings: ProducerSettings;
  readonly generator: Generator;
  readonly aggregates: InstrumentAggregate[];
  state: 'running' | 'paused';
  timer: ReturnType<typeof setTimeout> | undefined;
  // Target time of the next batch.
  nextAt: number;
  batches: number;
  updates: number;
  // Running time without pauses, up to `runningSince`.
  activeMs: number;
  runningSince: number;
}

// Worker logic: generates a batch per interval and posts the totals.
export class ProducerEngine {
  private wasm: WasmProducer | null = null;
  private run: Run | null = null;

  constructor(private readonly deps: EngineDeps) {}

  async handle(message: MainToWorker): Promise<void> {
    switch (message.type) {
      case 'init':
        return this.init(message.wasmUrl);
      case 'start':
        return this.start(message.runId, message.settings, message.paused);
      case 'pause':
        return this.pause(message.runId);
      case 'resume':
        return this.resume(message.runId);
      default:
        assertNever(message);
    }
  }

  private async init(wasmUrl: string): Promise<void> {
    try {
      const wasm = await this.deps.loadWasm(wasmUrl);
      assertLayout(wasm.layout);
      this.wasm = wasm;
      this.deps.post({ type: 'ready' });
    } catch (error) {
      this.fail(null, 'init', `Could not initialize the Wasm producer: ${describe(error)}`);
    }
  }

  private start(runId: number, settings: ProducerSettings, paused: boolean): void {
    this.stop();
    if (!this.wasm) {
      this.fail(runId, 'run', 'The Wasm producer is not initialized.');
      return;
    }

    let generator: Generator;
    try {
      generator = this.wasm.createGenerator(settings.instrumentCount, randomSeed());
    } catch (error) {
      this.fail(runId, 'run', `Could not start the producer: ${describe(error)}`);
      return;
    }

    const now = Date.now();
    this.run = {
      id: runId,
      settings,
      generator,
      aggregates: createAggregates(settings.instrumentCount),
      state: paused ? 'paused' : 'running',
      timer: undefined,
      nextAt: now + settings.intervalMs,
      batches: 0,
      updates: 0,
      activeMs: 0,
      runningSince: now,
    };
    this.deps.post({ type: 'started', runId, symbols: generator.symbols, state: this.run.state });
    if (!paused) this.schedule(this.run);
  }

  private pause(runId: number): void {
    const run = this.run;
    if (run?.id !== runId || run.state !== 'running') return;
    clearTimeout(run.timer);
    run.activeMs += Date.now() - run.runningSince;
    run.state = 'paused';
    this.deps.post({ type: 'status', runId, state: 'paused' });
  }

  // The paused interval is not caught up: the next batch comes one interval after resuming.
  private resume(runId: number): void {
    const run = this.run;
    if (run?.id !== runId || run.state !== 'paused') return;
    const now = Date.now();
    run.state = 'running';
    run.runningSince = now;
    run.nextAt = now + run.settings.intervalMs;
    this.deps.post({ type: 'status', runId, state: 'running' });
    this.schedule(run);
  }

  private schedule(run: Run): void {
    run.timer = setTimeout(() => this.tick(run), Math.max(0, run.nextAt - Date.now()));
  }

  private tick(run: Run): void {
    // A timer of a replaced or paused run does nothing.
    if (this.run !== run || run.state !== 'running') return;

    try {
      const data = run.generator.generate(run.settings.updatesPerBatch);
      applyBatch(run.aggregates, data);
      run.batches += 1;
      run.updates += data.length / STRIDE;
    } catch (error) {
      this.stop();
      this.fail(run.id, 'run', `The producer stopped: ${describe(error)}`);
      return;
    }

    const now = Date.now();
    this.deps.post({
      type: 'snapshot',
      runId: run.id,
      instruments: run.aggregates.map((a) => ({ ...a })),
      stats: {
        batches: run.batches,
        updates: run.updates,
        activeMs: run.activeMs + (now - run.runningSince),
      },
    });

    run.nextAt += run.settings.intervalMs;
    if (run.nextAt <= now) run.nextAt = now + run.settings.intervalMs;
    this.schedule(run);
  }

  // Frees the current run: timer and Rust memory.
  private stop(): void {
    if (!this.run) return;
    clearTimeout(this.run.timer);
    this.run.generator.free();
    this.run = null;
  }

  private fail(runId: number | null, phase: 'init' | 'run', message: string): void {
    this.deps.post({ type: 'error', runId, phase, message });
  }
}

// A safe integer, so it reaches Rust's u64 without BigInt.
function randomSeed(): number {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
