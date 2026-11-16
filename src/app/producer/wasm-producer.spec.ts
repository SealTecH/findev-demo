import { readFileSync } from 'node:fs';

import { applyBatch, createAggregates } from '../market/aggregator';
import { STRIDE, UPDATE_FIELDS } from '../market/update-codec';
import { loadWasmProducer } from './wasm-producer';

// The real module built by `npm run build:wasm` (the `pretest` script).
const wasm = await loadWasmProducer(readFileSync('public/wasm/producer_bg.wasm'));

// A seed as large as the worker can send (Math.random × MAX_SAFE_INTEGER).
const SEED = Number.MAX_SAFE_INTEGER;

describe('Wasm producer (real module)', () => {
  it('has the update layout the TypeScript decoder expects', () => {
    expect(wasm.layout).toEqual(UPDATE_FIELDS);
  });

  it('creates a run with one symbol per instrument', () => {
    const generator = wasm.createGenerator(3, SEED);
    expect(generator.symbols).toEqual(['TKR001', 'TKR002', 'TKR003']);
    generator.free();
  });

  it('generates batches of the requested size with valid values', () => {
    const generator = wasm.createGenerator(5, SEED);
    const data = generator.generate(1_000);
    expect(data).toBeInstanceOf(Int32Array);
    expect(data.length).toBe(1_000 * STRIDE);

    for (let i = 0; i < data.length; i += STRIDE) {
      const [index, price, quantity, bid, ask, bidQuantity, askQuantity] = data.subarray(
        i,
        i + STRIDE,
      );
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(5);
      expect(bid).toBeGreaterThan(0);
      expect(ask).toBeGreaterThan(bid);
      expect([bid, ask]).toContain(price);
      expect(quantity).toBeGreaterThan(0);
      expect(bidQuantity).toBeGreaterThanOrEqual(0);
      expect(askQuantity).toBeGreaterThanOrEqual(0);
    }

    // The aggregator accepts what the generator produces.
    const aggregates = createAggregates(5);
    applyBatch(aggregates, data);
    expect(aggregates.reduce((sum, a) => sum + a.volume, 0)).toBeGreaterThan(0);
    generator.free();
  });

  it('is deterministic for a seed and keeps state between calls', () => {
    const a = wasm.createGenerator(2, SEED);
    const b = wasm.createGenerator(2, SEED);
    const first = a.generate(10);
    expect(b.generate(10)).toEqual(first);
    expect(a.generate(10)).not.toEqual(first);
    a.free();
    b.free();
  });

  it('reports invalid input as an error', () => {
    expect(() => wasm.createGenerator(0, SEED)).toThrow(/instrument count/);
    const generator = wasm.createGenerator(1, SEED);
    expect(() => generator.generate(0)).toThrow(/batch size/);
    generator.free();
  });
});
