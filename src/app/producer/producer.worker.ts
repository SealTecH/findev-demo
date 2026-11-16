/// <reference lib="webworker" />

import { ProducerEngine } from './producer-engine';
import type { MainToWorker } from './protocol';
import { loadWasmProducer } from './wasm-producer';

async function loadWasm(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} responded with HTTP ${response.status}`);
  return loadWasmProducer(response);
}

const engine = new ProducerEngine({ loadWasm, post: (message) => postMessage(message) });

addEventListener('message', ({ data }: MessageEvent<MainToWorker>) => void engine.handle(data));
