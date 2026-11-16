/**
 * Messages between the main thread and the producer worker (discriminated unions on `type`).
 *
 * Every run-scoped message carries the `runId` of the run it belongs to. The worker ignores
 * commands for another run, and the main thread drops results from a previous run — so a
 * snapshot already queued when the user presses Apply can never overwrite the new run.
 */

import type { InstrumentAggregate, RunStats } from '../market/models';
import type { ProducerSettings } from './settings';

export type MainToWorker =
  /** Load and compile the Wasm module once per worker. */
  | { readonly type: 'init'; readonly wasmUrl: string }
  /** Replace the current run: free the old generator, reset totals, start generating or paused. */
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
  /** Sent once per run, before its first snapshot. */
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
      /** `null` for errors outside a run (loading the Wasm module). */
      readonly runId: number | null;
      readonly phase: 'init' | 'run';
      readonly message: string;
    };

/** Exhaustiveness check for `switch (message.type)`: a new message type fails to compile. */
export function assertNever(value: never): never {
  throw new Error(`Unexpected message: ${JSON.stringify(value)}`);
}
