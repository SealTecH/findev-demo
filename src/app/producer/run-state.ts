import { EMPTY_STATS, type InstrumentAggregate, type RunStats } from '../market/models';
import type { WorkerToMain } from './protocol';
import { DEFAULT_SETTINGS, type ProducerSettings } from './settings';

export type RunStatus = 'initializing' | 'starting' | 'running' | 'paused' | 'error';

// Everything the UI shows about the producer and the current run.
export interface RunState {
  readonly runId: number;
  readonly settings: ProducerSettings;
  // The worker has loaded the Wasm module and accepts runs.
  readonly ready: boolean;
  readonly status: RunStatus;
  // A pause/resume command is waiting for the worker's confirmation.
  readonly pending: boolean;
  readonly error: string | null;
  readonly symbols: readonly string[];
  readonly instruments: readonly InstrumentAggregate[];
  readonly stats: RunStats;
}

export type StoreAction =
  | WorkerToMain
  // Apply / app start / retry: a new run with these settings.
  | { readonly type: 'runRequested'; readonly runId: number; readonly settings: ProducerSettings }
  | { readonly type: 'commandSent'; readonly runId: number }
  // The worker is being recreated (Retry).
  | { readonly type: 'workerRestarted' }
  // The worker crashed or could not be created.
  | { readonly type: 'workerFailed'; readonly message: string };

export const INITIAL_STATE: RunState = {
  runId: 0,
  settings: DEFAULT_SETTINGS,
  ready: false,
  status: 'initializing',
  pending: false,
  error: null,
  symbols: [],
  instruments: [],
  stats: EMPTY_STATS,
};

export function reduce(state: RunState, action: StoreAction): RunState {
  // Results of a previous run must not touch the current one.
  if (
    action.type !== 'runRequested' &&
    'runId' in action &&
    action.runId !== null &&
    action.runId !== state.runId
  ) {
    return state;
  }

  switch (action.type) {
    case 'runRequested':
      return {
        ...INITIAL_STATE,
        runId: action.runId,
        settings: action.settings,
        ready: state.ready,
        // Until the worker is ready the run waits; a broken worker stays broken until Retry.
        status: state.ready ? 'starting' : state.status === 'error' ? 'error' : 'initializing',
        error: state.ready ? null : state.error,
      };
    case 'ready':
      return { ...state, ready: true };
    case 'started':
      return { ...state, status: 'running', pending: false, symbols: action.symbols };
    case 'status':
      return { ...state, status: action.state, pending: false };
    case 'snapshot':
      return { ...state, instruments: action.instruments, stats: action.stats };
    case 'commandSent':
      return { ...state, pending: true };
    case 'error':
      return {
        ...state,
        status: 'error',
        pending: false,
        error: action.message,
        ready: action.phase === 'init' ? false : state.ready,
      };
    case 'workerRestarted':
      return { ...state, ready: false, status: 'initializing', pending: false, error: null };
    case 'workerFailed':
      return { ...state, ready: false, status: 'error', pending: false, error: action.message };
  }
}
