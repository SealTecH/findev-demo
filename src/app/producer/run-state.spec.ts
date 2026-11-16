import { emptyAggregate } from '../market/aggregator';
import { INITIAL_STATE, reduce, type RunState, type StoreAction } from './run-state';
import { DEFAULT_SETTINGS, type ProducerSettings } from './settings';

const NEW_SETTINGS: ProducerSettings = { instrumentCount: 3, updatesPerBatch: 10, intervalMs: 50 };

function apply(state: RunState, ...actions: StoreAction[]): RunState {
  return actions.reduce(reduce, state);
}

// Run 1 running, with one snapshot received.
const RUNNING: RunState = apply(
  INITIAL_STATE,
  { type: 'runRequested', runId: 1, settings: DEFAULT_SETTINGS },
  { type: 'ready' },
  { type: 'started', runId: 1, symbols: ['TKR001'], state: 'running' },
  {
    type: 'snapshot',
    runId: 1,
    instruments: [{ ...emptyAggregate(), volume: 40 }],
    stats: { batches: 1, updates: 40, activeMs: 500 },
  },
);

describe('run state', () => {
  it('starts initializing, with defaults, unavailable values and zero totals', () => {
    expect(INITIAL_STATE).toMatchObject({
      status: 'initializing',
      settings: DEFAULT_SETTINGS,
      instruments: [],
      stats: { batches: 0, updates: 0, activeMs: 0 },
    });
  });

  it('a run requested before the worker is ready waits in initializing', () => {
    const state = reduce(INITIAL_STATE, {
      type: 'runRequested',
      runId: 1,
      settings: DEFAULT_SETTINGS,
    });
    expect(state.status).toBe('initializing');
    expect(reduce(state, { type: 'ready' }).status).toBe('initializing');
  });

  it('started → running with the run symbols; snapshots replace totals', () => {
    expect(RUNNING.status).toBe('running');
    expect(RUNNING.symbols).toEqual(['TKR001']);
    expect(RUNNING.instruments[0].volume).toBe(40);
  });

  it('a run started paused is paused', () => {
    const state = apply(
      INITIAL_STATE,
      { type: 'runRequested', runId: 1, settings: DEFAULT_SETTINGS },
      { type: 'ready' },
      { type: 'started', runId: 1, symbols: ['TKR001'], state: 'paused' },
    );
    expect(state.status).toBe('paused');
  });

  describe('applying new settings', () => {
    it('clears the previous run values and totals and keeps the worker', () => {
      const state = reduce(RUNNING, { type: 'runRequested', runId: 2, settings: NEW_SETTINGS });
      expect(state).toEqual({
        ...INITIAL_STATE,
        runId: 2,
        settings: NEW_SETTINGS,
        ready: true,
        status: 'starting',
      });
    });

    it('also leaves the paused state', () => {
      const paused = apply(RUNNING, { type: 'status', runId: 1, state: 'paused' });
      const state = reduce(paused, { type: 'runRequested', runId: 2, settings: NEW_SETTINGS });
      expect(state.status).toBe('starting');
    });
  });

  describe('results from a previous run', () => {
    const afterApply = reduce(RUNNING, { type: 'runRequested', runId: 2, settings: NEW_SETTINGS });

    it.each<StoreAction>([
      {
        type: 'snapshot',
        runId: 1,
        instruments: [{ ...emptyAggregate(), volume: 99 }],
        stats: { batches: 9, updates: 99, activeMs: 9 },
      },
      { type: 'started', runId: 1, symbols: ['OLD'], state: 'running' },
      { type: 'status', runId: 1, state: 'paused' },
      { type: 'error', runId: 1, phase: 'run', message: 'old failure' },
      { type: 'commandSent', runId: 1 },
    ])('ignores $type of run 1 (same state object)', (action) => {
      expect(reduce(afterApply, action)).toBe(afterApply);
    });
  });

  describe('pause and resume', () => {
    it('is pending until the worker confirms', () => {
      const sent = reduce(RUNNING, { type: 'commandSent', runId: 1 });
      expect(sent).toMatchObject({ status: 'running', pending: true });

      const paused = reduce(sent, { type: 'status', runId: 1, state: 'paused' });
      expect(paused).toMatchObject({ status: 'paused', pending: false });
      // Values and totals are kept while paused.
      expect(paused.instruments).toBe(RUNNING.instruments);
      expect(paused.stats).toBe(RUNNING.stats);
    });
  });

  describe('errors', () => {
    it('a run error keeps the worker usable', () => {
      const state = reduce(RUNNING, { type: 'error', runId: 1, phase: 'run', message: 'boom' });
      expect(state).toMatchObject({ status: 'error', error: 'boom', ready: true });
      expect(
        reduce(state, { type: 'runRequested', runId: 2, settings: NEW_SETTINGS }),
      ).toMatchObject({ status: 'starting', error: null });
    });

    it('an init error keeps the error until Retry, even if settings are applied', () => {
      const failed = reduce(INITIAL_STATE, {
        type: 'error',
        runId: null,
        phase: 'init',
        message: 'HTTP 404',
      });
      const applied = reduce(failed, { type: 'runRequested', runId: 1, settings: NEW_SETTINGS });
      expect(applied).toMatchObject({ status: 'error', error: 'HTTP 404', ready: false });

      const restarted = reduce(applied, { type: 'workerRestarted' });
      expect(restarted).toMatchObject({ status: 'initializing', error: null, ready: false });
    });

    it('a crashed worker becomes an error', () => {
      const state = reduce(RUNNING, { type: 'workerFailed', message: 'crashed' });
      expect(state).toMatchObject({ status: 'error', error: 'crashed', ready: false });
    });
  });
});
