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

// Adds each update of the batch to the totals (mutates `aggregates`). Each trade counts once;
// book quantities are not volume.
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
    aggregate.notionalCents += BigInt(price * quantity);

    aggregate.bidCents = data[offset + F.bidCents];
    aggregate.askCents = data[offset + F.askCents];
    aggregate.bidQuantity = data[offset + F.bidQuantity];
    aggregate.askQuantity = data[offset + F.askQuantity];
  }
}
