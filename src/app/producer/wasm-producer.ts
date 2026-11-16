import type { WasmProducer } from './producer-engine';
import init, { Producer, updateLayout } from './wasm-pkg/producer';

// Instantiates the Wasm module from a fetch response (worker) or its bytes (tests).
export async function loadWasmProducer(source: Response | BufferSource): Promise<WasmProducer> {
  await init({ module_or_path: source });
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
