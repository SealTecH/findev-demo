// Test helper: a worker that records what the app sends and lets a test reply.
import type { Provider } from '@angular/core';

import { WASM_URL, WORKER_FACTORY } from './producer-service';
import type { MainToWorker, WorkerToMain } from './protocol';

export const TEST_WASM_URL = 'http://localhost/wasm/producer_bg.wasm';

export class FakeWorker extends EventTarget {
  readonly sent: MainToWorker[] = [];
  terminated = false;

  postMessage(message: MainToWorker): void {
    this.sent.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  // Simulates a message from the worker.
  reply(message: WorkerToMain): void {
    this.dispatchEvent(new MessageEvent('message', { data: message }));
  }

  lastSent(): MainToWorker | undefined {
    return this.sent.at(-1);
  }
}

// Providers that make ProducerService use fake workers; created workers are pushed to `workers`.
export function provideFakeWorker(workers: FakeWorker[]): Provider[] {
  return [
    { provide: WASM_URL, useValue: TEST_WASM_URL },
    {
      provide: WORKER_FACTORY,
      useValue: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      },
    },
  ];
}
