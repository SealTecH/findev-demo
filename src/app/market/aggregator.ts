import type { InstrumentAggregate } from './models';
import { F, STRIDE } from './update-codec';

export function emptyAggregate(): InstrumentAggregate {
  return {
    lastPriceCents: null,
    bidCents: null,
    askCents: null,
    bidQuantity: null,
    askQuantity: null,
    volume: 0,
    notionalCents: 0n,
  };
}

export function createAggregates(instrumentCount: number): InstrumentAggregate[] {
  return Array.from({ length: instrumentCount }, emptyAggregate);
}

/**
 * Folds every update of a batch into the running totals, in order. Mutates `aggregates` —
 * it runs in the worker on every batch, so it allocates nothing per update.
 *
 * - every trade counts once towards volume and notional (book quantities never do);
 * - last price and the bid/ask snapshot come from the instrument's latest update.
 */
export function applyBatch(aggregates: InstrumentAggregate[], data: Int32Array): void {
  for (let offset = 0; offset < data.length; offset += STRIDE) {
    const index = data[offset + F.instrumentIndex];
    const aggregate = aggregates[index];
    if (aggregate === undefined) {
      throw new RangeError(
        `Update for instrument ${index}, but the run has ${aggregates.length} instruments.`,
      );
    }

    const price = data[offset + F.priceCents];
    const quantity = data[offset + F.tradeQuantity];
    aggregate.lastPriceCents = price;
    aggregate.volume += quantity;
    // price × quantity
    aggregate.notionalCents += BigInt(price * quantity);

    aggregate.bidCents = data[offset + F.bidCents];
    aggregate.askCents = data[offset + F.askCents];
    aggregate.bidQuantity = data[offset + F.bidQuantity];
    aggregate.askQuantity = data[offset + F.askQuantity];
  }
}
