export interface InstrumentAggregate {
  lastPriceCents: number | null;
  bidCents: number | null;
  askCents: number | null;
  bidQuantity: number | null;
  askQuantity: number | null;
  volume: number;
  // priceCents × tradeQuantity.
  notionalCents: bigint;
}

export interface RunStats {
  readonly batches: number;
  readonly updates: number;
  // Time spent running, excluding pauses — for the actual update rate.
  readonly activeMs: number;
}

export const EMPTY_STATS: RunStats = { batches: 0, updates: 0, activeMs: 0 };
