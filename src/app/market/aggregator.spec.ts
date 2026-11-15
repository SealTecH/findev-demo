import { applyBatch, createAggregates, emptyAggregate } from './aggregator';
import { encodeUpdates, type MarketUpdate } from './update-codec';

const ALFA = 0;
const BETA = 1;

function update(overrides: Partial<MarketUpdate> & Pick<MarketUpdate, 'instrumentIndex'>) {
  return {
    priceCents: 10_000,
    tradeQuantity: 1,
    bidCents: 9_999,
    askCents: 10_000,
    bidQuantity: 100,
    askQuantity: 100,
    ...overrides,
  } satisfies MarketUpdate;
}

describe('aggregator', () => {
  it('starts every instrument empty: unavailable values, zero volume', () => {
    expect(createAggregates(2)).toEqual([emptyAggregate(), emptyAggregate()]);
    expect(emptyAggregate()).toEqual({
      lastPriceCents: null,
      bidCents: null,
      askCents: null,
      bidQuantity: null,
      askQuantity: null,
      volume: 0,
      notionalCents: 0n,
    });
  });

  it('worked example: 10 @ $100 then 30 @ $102', () => {
    const aggregates = createAggregates(1);
    applyBatch(
      aggregates,
      encodeUpdates([
        update({ instrumentIndex: ALFA, priceCents: 10_000, tradeQuantity: 10 }),
        update({
          instrumentIndex: ALFA,
          priceCents: 10_200,
          tradeQuantity: 30,
          bidCents: 10_196,
          askCents: 10_200,
          bidQuantity: 600,
          askQuantity: 400,
        }),
      ]),
    );

    expect(aggregates[ALFA]).toEqual({
      lastPriceCents: 10_200,
      bidCents: 10_196,
      askCents: 10_200,
      bidQuantity: 600,
      askQuantity: 400,
      volume: 40,
      notionalCents: 406_000n, // 100 × 10 + 102 × 30 = $4 060
    });
  });

  it('accumulates across batches without retaining history', () => {
    const aggregates = createAggregates(1);
    applyBatch(aggregates, encodeUpdates([update({ instrumentIndex: ALFA, tradeQuantity: 10 })]));
    applyBatch(aggregates, encodeUpdates([update({ instrumentIndex: ALFA, tradeQuantity: 30 })]));

    expect(aggregates[ALFA].volume).toBe(40);
    expect(aggregates[ALFA].notionalCents).toBe(400_000n);
  });

  it('isolates instruments: updates for ALFA never touch BETA', () => {
    const aggregates = createAggregates(2);
    applyBatch(
      aggregates,
      encodeUpdates([
        update({ instrumentIndex: ALFA, tradeQuantity: 5 }),
        update({ instrumentIndex: ALFA, tradeQuantity: 7 }),
      ]),
    );

    expect(aggregates[ALFA].volume).toBe(12);
    expect(aggregates[BETA]).toEqual(emptyAggregate());
  });

  it('counts every repeated update once; the latest one sets price and book', () => {
    const aggregates = createAggregates(2);
    applyBatch(
      aggregates,
      encodeUpdates([
        update({ instrumentIndex: ALFA, priceCents: 100, tradeQuantity: 1, bidQuantity: 9 }),
        update({ instrumentIndex: BETA, priceCents: 500, tradeQuantity: 2 }),
        update({ instrumentIndex: ALFA, priceCents: 300, tradeQuantity: 3, bidQuantity: 0 }),
      ]),
    );

    expect(aggregates[ALFA].volume).toBe(4);
    expect(aggregates[ALFA].notionalCents).toBe(1_000n); // 100 × 1 + 300 × 3
    expect(aggregates[ALFA].lastPriceCents).toBe(300);
    expect(aggregates[ALFA].bidQuantity).toBe(0);
    expect(aggregates[BETA].volume).toBe(2);
  });

  it('book quantities do not contribute to volume', () => {
    const aggregates = createAggregates(1);
    applyBatch(
      aggregates,
      encodeUpdates([
        update({ instrumentIndex: ALFA, tradeQuantity: 3, bidQuantity: 600, askQuantity: 400 }),
      ]),
    );
    expect(aggregates[ALFA].volume).toBe(3);
  });

  it('keeps notional exact beyond 2^53', () => {
    const aggregates = createAggregates(1);
    aggregates[ALFA].notionalCents = 2n ** 53n;
    applyBatch(
      aggregates,
      encodeUpdates([update({ instrumentIndex: ALFA, priceCents: 1, tradeQuantity: 1 })]),
    );

    // 2^53 + 1 is not representable as a double.
    expect(aggregates[ALFA].notionalCents).toBe(2n ** 53n + 1n);
  });

  it('rejects an instrument index outside the run', () => {
    expect(() =>
      applyBatch(createAggregates(2), encodeUpdates([update({ instrumentIndex: 2 })])),
    ).toThrow(/instrument 2, but the run has 2 instruments/);
  });
});
