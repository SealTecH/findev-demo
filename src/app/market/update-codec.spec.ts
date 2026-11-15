import {
  assertLayout,
  encodeUpdates,
  F,
  type MarketUpdate,
  STRIDE,
  UPDATE_FIELDS,
} from './update-codec';

const update: MarketUpdate = {
  instrumentIndex: 2,
  priceCents: 10_200,
  tradeQuantity: 30,
  bidCents: 10_196,
  askCents: 10_200,
  bidQuantity: 600,
  askQuantity: 400,
};

describe('update codec', () => {
  it('has one offset per field, in declaration order', () => {
    expect(STRIDE).toBe(7);
    expect(UPDATE_FIELDS.map((field) => F[field])).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('packs updates record after record, fields at their offsets', () => {
    const data = encodeUpdates([update, { ...update, priceCents: 9_999 }]);

    expect(data).toHaveLength(2 * STRIDE);
    expect(data[F.instrumentIndex]).toBe(2);
    expect(data[F.askQuantity]).toBe(400);
    expect(data[STRIDE + F.priceCents]).toBe(9_999);
  });

  it('accepts the layout reported by Wasm when it matches', () => {
    expect(() => assertLayout([...UPDATE_FIELDS])).not.toThrow();
  });

  it.each([
    ['a swapped pair', ['priceCents', 'instrumentIndex', ...UPDATE_FIELDS.slice(2)]],
    ['a missing field', UPDATE_FIELDS.slice(0, -1)],
    ['an extra field', [...UPDATE_FIELDS, 'timestamp']],
  ])('rejects %s with a readable error', (_, layout) => {
    expect(() => assertLayout(layout)).toThrow(/does not match the TypeScript decoder/);
  });
});
