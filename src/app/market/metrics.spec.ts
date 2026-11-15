import { emptyAggregate } from './aggregator';
import {
  buildRows,
  computeMetrics,
  formatMetric,
  imbalance,
  METRICS,
  spreadCents,
  UNAVAILABLE,
  vwapCents,
} from './metrics';
import type { InstrumentAggregate } from './models';

function aggregate(overrides: Partial<InstrumentAggregate>): InstrumentAggregate {
  return { ...emptyAggregate(), ...overrides };
}

/** State after the task's worked example: 10 @ $100, 30 @ $102, book 600 / 400. */
const workedExample = aggregate({
  lastPriceCents: 10_200,
  bidCents: 10_196,
  askCents: 10_200,
  bidQuantity: 600,
  askQuantity: 400,
  volume: 40,
  notionalCents: 406_000n,
});

describe('metrics', () => {
  describe('worked example', () => {
    it('computes every metric', () => {
      expect(computeMetrics(workedExample)).toEqual({
        lastPrice: 10_200,
        spread: 4,
        volume: 40,
        vwap: 10_150,
        imbalance: 0.2,
      });
    });

    it('formats them for display', () => {
      const values = computeMetrics(workedExample);
      expect(formatMetric(values.lastPrice, 'currency')).toBe('$102.00');
      expect(formatMetric(values.spread, 'currency')).toBe('$0.04');
      expect(formatMetric(values.volume, 'quantity')).toBe('40');
      expect(formatMetric(values.vwap, 'currency')).toBe('$101.50');
      expect(formatMetric(values.imbalance, 'ratio')).toBe('+0.20');
    });
  });

  describe('unavailable values', () => {
    it('before any data: every price metric is unavailable and volume is 0', () => {
      expect(computeMetrics(emptyAggregate())).toEqual({
        lastPrice: null,
        spread: null,
        volume: 0,
        vwap: null,
        imbalance: null,
      });
    });

    it('VWAP is unavailable when volume is zero', () => {
      expect(vwapCents(aggregate({ volume: 0, notionalCents: 0n }))).toBeNull();
    });

    it('imbalance is unavailable when both book sides are empty', () => {
      expect(imbalance(aggregate({ bidQuantity: 0, askQuantity: 0 }))).toBeNull();
    });

    it('spread is unavailable without a quote', () => {
      expect(spreadCents(aggregate({ bidCents: 100, askCents: null }))).toBeNull();
    });

    it('renders unavailable values as a dash', () => {
      expect(formatMetric(null, 'currency')).toBe(UNAVAILABLE);
    });
  });

  it('imbalance reaches ±1 when one side is empty', () => {
    expect(imbalance(aggregate({ bidQuantity: 500, askQuantity: 0 }))).toBe(1);
    expect(imbalance(aggregate({ bidQuantity: 0, askQuantity: 500 }))).toBe(-1);
  });

  it('VWAP keeps fractional cents until display', () => {
    // (101 × 1 + 102 × 2) / 3 = 101.666… cents
    const vwap = vwapCents(aggregate({ volume: 3, notionalCents: 305n }));
    expect(vwap).toBeCloseTo(101.6667, 4);
    expect(formatMetric(vwap, 'currency')).toBe('$1.02');
  });

  describe('formatting', () => {
    it.each([
      [-0.15, '-0.15'],
      [0, '0.00'],
      [-0.001, '0.00'],
      [1, '+1.00'],
    ])('ratio %s → %s', (value, expected) => {
      expect(formatMetric(value, 'ratio')).toBe(expected);
    });

    it('prints prices with two decimals and quantities as plain integers', () => {
      expect(formatMetric(123_456_789, 'currency')).toBe('$1234567.89');
      expect(formatMetric(1_234_567, 'quantity')).toBe('1234567');
    });
  });

  it('builds one row per symbol; instruments without data get empty metrics', () => {
    const rows = buildRows(['TKR001', 'TKR002'], [workedExample]);

    expect(rows.map((r) => r.symbol)).toEqual(['TKR001', 'TKR002']);
    expect(rows[0].metrics.vwap).toBe(10_150);
    expect(rows[1].metrics).toEqual(computeMetrics(emptyAggregate()));
  });

  it('metric ids are unique (they become table column ids)', () => {
    const ids = METRICS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
