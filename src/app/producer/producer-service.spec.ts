import { TestBed } from '@angular/core/testing';

import { emptyAggregate } from '../market/aggregator';
import { FakeWorker, provideFakeWorker, TEST_WASM_URL } from './fake-worker';
import { ProducerService } from './producer-service';
import type { WorkerToMain } from './protocol';
import { DEFAULT_SETTINGS, type ProducerSettings } from './settings';

const NEW_SETTINGS: ProducerSettings = { instrumentCount: 3, updatesPerBatch: 10, intervalMs: 50 };

function setup() {
  const workers: FakeWorker[] = [];
  TestBed.configureTestingModule({ providers: provideFakeWorker(workers) });
  const service = TestBed.inject(ProducerService);
  return { service, workers, worker: () => workers.at(-1)! };
}

// App start: defaults applied, worker ready, run 1 started.
function running() {
  const context = setup();
  context.service.apply(DEFAULT_SETTINGS);
  context.worker().reply({ type: 'ready' });
  context.worker().reply({ type: 'started', runId: 1, symbols: ['TKR001'], state: 'running' });
  return context;
}

function snapshot(runId: number, volume: number): WorkerToMain {
  return {
    type: 'snapshot',
    runId,
    instruments: [{ ...emptyAggregate(), volume }],
    stats: { batches: 1, updates: volume, activeMs: 500 },
  };
}

describe('ProducerService', () => {
  it('creates exactly one worker and asks it to load the Wasm module', () => {
    const { workers } = setup();
    TestBed.inject(ProducerService); // e.g. another page injecting it
    expect(workers).toHaveLength(1);
    expect(workers[0].sent).toEqual([{ type: 'init', wasmUrl: TEST_WASM_URL }]);
  });

  it('starts the requested run once the worker is ready', () => {
    const { service, worker } = setup();
    service.apply(DEFAULT_SETTINGS);
    expect(worker().sent).toHaveLength(1); // only init so far
    expect(service.state().status).toBe('initializing');

    worker().reply({ type: 'ready' });
    expect(worker().lastSent()).toEqual({
      type: 'start',
      runId: 1,
      settings: DEFAULT_SETTINGS,
      paused: false,
    });
  });

  it('a run requested paused starts paused once the worker is ready', () => {
    const { service, worker } = setup();
    service.apply(DEFAULT_SETTINGS, { paused: true });
    worker().reply({ type: 'ready' });
    expect(worker().lastSent()).toEqual({
      type: 'start',
      runId: 1,
      settings: DEFAULT_SETTINGS,
      paused: true,
    });
  });

  it('restart starts a new generating run with the applied settings', () => {
    const { service, worker } = running();
    service.apply(NEW_SETTINGS, { paused: true });
    service.restart();
    expect(worker().lastSent()).toEqual({
      type: 'start',
      runId: 3,
      settings: NEW_SETTINGS,
      paused: false,
    });
    expect(service.state()).toMatchObject({ runId: 3, status: 'starting', instruments: [] });
  });

  it('shows one row per symbol with unavailable values before the first snapshot', () => {
    const { service } = running();
    expect(service.state().status).toBe('running');
    expect(service.rows()).toEqual([
      {
        symbol: 'TKR001',
        metrics: { lastPrice: null, spread: null, volume: 0, vwap: null, imbalance: null },
      },
    ]);
  });

  it('apply clears the previous run before starting a new one', () => {
    const { service, worker } = running();
    worker().reply(snapshot(1, 40));
    expect(service.rows()[0].metrics.volume).toBe(40);

    service.apply(NEW_SETTINGS);
    expect(service.state()).toMatchObject({ runId: 2, status: 'starting', instruments: [] });
    expect(worker().lastSent()).toEqual({
      type: 'start',
      runId: 2,
      settings: NEW_SETTINGS,
      paused: false,
    });
  });

  it('ignores a snapshot of the previous run that arrives after apply', () => {
    const { service, worker } = running();
    service.apply(NEW_SETTINGS);
    worker().reply(snapshot(1, 99));
    expect(service.state().instruments).toEqual([]);

    worker().reply({
      type: 'started',
      runId: 2,
      symbols: ['TKR001', 'TKR002', 'TKR003'],
      state: 'running',
    });
    worker().reply(snapshot(2, 5));
    expect(service.rows()[0].metrics.volume).toBe(5);
  });

  it('pause and resume go to the worker with the current run id', () => {
    const { service, worker } = running();
    service.pause();
    expect(worker().lastSent()).toEqual({ type: 'pause', runId: 1 });
    expect(service.state().pending).toBe(true);

    service.pause(); // ignored while pending
    expect(worker().sent.filter((m) => m.type === 'pause')).toHaveLength(1);

    worker().reply({ type: 'status', runId: 1, state: 'paused' });
    expect(service.state()).toMatchObject({ status: 'paused', pending: false });

    service.resume();
    expect(worker().lastSent()).toEqual({ type: 'resume', runId: 1 });
  });

  it('apply while paused starts generating again', () => {
    const { service, worker } = running();
    service.pause();
    worker().reply({ type: 'status', runId: 1, state: 'paused' });

    service.apply(NEW_SETTINGS);
    expect(worker().lastSent()).toEqual({
      type: 'start',
      runId: 2,
      settings: NEW_SETTINGS,
      paused: false,
    });
    worker().reply({ type: 'started', runId: 2, symbols: [], state: 'running' });
    expect(service.state().status).toBe('running');
  });

  it('reports a crashed worker as an error', () => {
    const { service, worker } = running();
    worker().dispatchEvent(new ErrorEvent('error', { message: 'out of memory' }));
    expect(service.state()).toMatchObject({
      status: 'error',
      error: 'The producer worker failed: out of memory',
    });
  });

  it('retry terminates the old worker and starts a new run on a new one', () => {
    const { service, workers } = running();
    workers[0].reply({ type: 'error', runId: null, phase: 'init', message: 'HTTP 404' });

    service.retry();
    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(workers[1].sent).toEqual([{ type: 'init', wasmUrl: TEST_WASM_URL }]);

    workers[1].reply({ type: 'ready' });
    expect(workers[1].lastSent()).toEqual({
      type: 'start',
      runId: 2,
      settings: DEFAULT_SETTINGS,
      paused: false,
    });
  });

  it('terminates the worker when the app is destroyed', () => {
    const { worker } = running();
    TestBed.resetTestingModule();
    expect(worker().terminated).toBe(true);
  });
});
