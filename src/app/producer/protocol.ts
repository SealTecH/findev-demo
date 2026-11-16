// Messages between the main thread and the worker. Run messages carry `runId`, so messages
// of an old run are ignored on both sides.

import type { InstrumentAggregate, RunStats } from '../market/models';
import type { ProducerSettings } from './settings';

export type MainToWorker =
  // Load the Wasm module, once per worker.
  | { readonly type: 'init'; readonly wasmUrl: string }
  // Replace the current run and reset the totals.
  | {
      readonly type: 'start';
      readonly runId: number;
      readonly settings: ProducerSettings;
      readonly paused: boolean;
    }
  | { readonly type: 'pause'; readonly runId: number }
  | { readonly type: 'resume'; readonly runId: number };

export type ProducerState = 'running' | 'paused';

export type WorkerToMain =
  | { readonly type: 'ready' }
  // Sent once per run, before its first snapshot.
  | {
      readonly type: 'started';
      readonly runId: number;
      readonly symbols: readonly string[];
      readonly state: ProducerState;
    }
  | { readonly type: 'status'; readonly runId: number; readonly state: ProducerState }
  | {
      readonly type: 'snapshot';
      readonly runId: number;
      readonly instruments: readonly InstrumentAggregate[];
      readonly stats: RunStats;
    }
  | {
      readonly type: 'error';
      // `null` when loading the Wasm module fails.
      readonly runId: number | null;
      readonly phase: 'init' | 'run';
      readonly message: string;
    };

// Compile error if a `switch` misses a message type.
export function assertNever(value: never): never {
  throw new Error(`Unexpected message: ${JSON.stringify(value)}`);
}
