import { DOCUMENT } from '@angular/common';
import { computed, inject, Injectable, InjectionToken } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  catchError,
  defer,
  finalize,
  fromEvent,
  map,
  merge,
  type Observable,
  of,
  scan,
  startWith,
  Subject,
  switchMap,
  tap,
} from 'rxjs';

import { buildRows } from '../market/metrics';
import type { MainToWorker, WorkerToMain } from './protocol';
import { INITIAL_STATE, reduce, type StoreAction } from './run-state';
import { nominalRate, type ProducerSettings } from './settings';

export const WORKER_FACTORY = new InjectionToken<() => Worker>('WORKER_FACTORY', {
  providedIn: 'root',
  factory: () => () =>
    new Worker(new URL('./producer.worker', import.meta.url), { type: 'module' }),
});

export const WASM_URL = new InjectionToken<string>('WASM_URL', {
  providedIn: 'root',
  factory: () => new URL('wasm/producer_bg.wasm', inject(DOCUMENT).baseURI).href,
});

@Injectable({ providedIn: 'root' })
export class ProducerService {
  private readonly createWorker = inject(WORKER_FACTORY);
  private readonly wasmUrl = inject(WASM_URL);

  private readonly commands$ = new Subject<StoreAction>();
  private readonly restart$ = new Subject<void>();
  private worker: Worker | null = null;
  private lastRunId = 0;

  readonly state = toSignal(
    merge(
      this.commands$,
      this.restart$.pipe(
        startWith(undefined),
        switchMap(() => this.connect()),
      ),
    ).pipe(scan(reduce, INITIAL_STATE)),
    { initialValue: INITIAL_STATE },
  );

  readonly rows = computed(() => buildRows(this.state().symbols, this.state().instruments));
  readonly nominalRate = computed(() => nominalRate(this.state().settings));
  readonly actualRate = computed(() => {
    const { updates, activeMs } = this.state().stats;
    return activeMs === 0 ? null : (updates * 1_000) / activeMs;
  });

  // Starts a new run; the previous run's values and totals are cleared first, synchronously.
  apply(settings: ProducerSettings): void {
    const runId = ++this.lastRunId;
    this.commands$.next({ type: 'runRequested', runId, settings });
    // Not ready yet: the run starts when the worker reports `ready`.
    if (this.state().ready) this.post({ type: 'start', runId, settings });
  }

  pause(): void {
    this.command('running', 'pause');
  }

  resume(): void {
    this.command('paused', 'resume');
  }

  // Recreates the worker and starts a new run with the last applied settings.
  retry(): void {
    this.commands$.next({ type: 'workerRestarted' });
    this.restart$.next();
    this.apply(this.state().settings);
  }

  private command(expected: 'running' | 'paused', type: 'pause' | 'resume'): void {
    const { runId, status, pending } = this.state();
    if (status !== expected || pending) return;
    this.commands$.next({ type: 'commandSent', runId });
    this.post({ type, runId });
  }

  private connect(): Observable<StoreAction> {
    return defer(() => {
      const worker = this.createWorker();
      this.worker = worker;
      worker.postMessage({ type: 'init', wasmUrl: this.wasmUrl } satisfies MainToWorker);

      return merge(
        fromEvent<MessageEvent<WorkerToMain>>(worker, 'message').pipe(
          map((event) => event.data),
          tap((message) => {
            if (message.type === 'ready') this.startCurrentRun();
          }),
        ),
        fromEvent<ErrorEvent>(worker, 'error').pipe(
          map((event) => workerFailed(event.message || 'The producer worker crashed.')),
        ),
      ).pipe(
        finalize(() => {
          worker.terminate();
          if (this.worker === worker) this.worker = null;
        }),
      );
    }).pipe(catchError((error: unknown) => of(workerFailed(String(error)))));
  }

  private startCurrentRun(): void {
    const { runId, settings } = this.state();
    if (runId !== 0) this.post({ type: 'start', runId, settings });
  }

  private post(message: MainToWorker): void {
    this.worker?.postMessage(message);
  }
}

function workerFailed(reason: string): StoreAction {
  return { type: 'workerFailed', message: `The producer worker failed: ${reason}` };
}
