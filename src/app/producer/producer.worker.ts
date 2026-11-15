import { ProducerEngine, type WasmProducer } from './producer-engine';
import type { MainToWorker } from './protocol';
import init, { Producer, updateLayout } from './wasm-pkg/producer';

async function loadWasm(url: string): Promise<WasmProducer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} responded with HTTP ${response.status}`);
  await init({ module_or_path: response });

  return {
    layout: updateLayout(),
    createGenerator(instrumentCount, seed) {
      const producer = new Producer({ instrumentCount, seed });
      return {
        symbols: producer.symbols(),
        generate: (batchSize) => producer.generate(batchSize),
        free: () => producer.free(),
      };
    },
  };
}

const engine = new ProducerEngine({ loadWasm, post: (message) => postMessage(message) });

addEventListener('message', ({ data }: MessageEvent<MainToWorker>) => void engine.handle(data));
