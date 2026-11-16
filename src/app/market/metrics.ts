import { emptyAggregate } from './aggregator';
import type { InstrumentAggregate } from './models';

export function spreadCents(a: InstrumentAggregate): number | null {
  return a.bidCents === null || a.askCents === null ? null : a.askCents - a.bidCents;
}

// Σ price × quantity / Σ quantity.
export function vwapCents(a: InstrumentAggregate): number | null {
  return a.volume === 0 ? null : Number(a.notionalCents) / a.volume;
}

export function imbalance(a: InstrumentAggregate): number | null {
  if (a.bidQuantity === null || a.askQuantity === null) return null;
  const total = a.bidQuantity + a.askQuantity;
  return total === 0 ? null : (a.bidQuantity - a.askQuantity) / total;
}

// `currency` values are in cents.
export type MetricFormat = 'currency' | 'quantity' | 'ratio';

export interface MetricDefinition {
  readonly id: string;
  readonly header: string;
  readonly format: MetricFormat;
  readonly compute: (aggregate: InstrumentAggregate) => number | null;
}

export const METRICS = [
  { id: 'lastPrice', header: 'Last price', format: 'currency', compute: (a) => a.lastPriceCents },
  { id: 'spread', header: 'Bid–ask spread', format: 'currency', compute: spreadCents },
  { id: 'volume', header: 'Volume', format: 'quantity', compute: (a) => a.volume },
  { id: 'vwap', header: 'VWAP', format: 'currency', compute: vwapCents },
  { id: 'imbalance', header: 'Order-book imbalance', format: 'ratio', compute: imbalance },
] as const satisfies readonly MetricDefinition[];

export type MetricId = (typeof METRICS)[number]['id'];

export type MetricValues = Readonly<Record<MetricId, number | null>>;

export function computeMetrics(aggregate: InstrumentAggregate): MetricValues {
  return Object.fromEntries(METRICS.map((m) => [m.id, m.compute(aggregate)])) as MetricValues;
}

export interface InstrumentRow {
  readonly symbol: string;
  readonly metrics: MetricValues;
}

// Before the first snapshot an instrument has empty totals.
export function buildRows(
  symbols: readonly string[],
  aggregates: readonly InstrumentAggregate[],
): InstrumentRow[] {
  return symbols.map((symbol, i) => ({
    symbol,
    metrics: computeMetrics(aggregates[i] ?? emptyAggregate()),
  }));
}

export const UNAVAILABLE = '—';

export function formatMetric(value: number | null, format: MetricFormat): string {
  if (value === null) return UNAVAILABLE;
  switch (format) {
    case 'currency':
      return `$${(value / 100).toFixed(2)}`;
    case 'quantity':
      return String(value);
    case 'ratio': {
      const rounded = Math.round(value * 100) / 100;
      return `${rounded > 0 ? '+' : ''}${rounded.toFixed(2)}`;
    }
  }
}
