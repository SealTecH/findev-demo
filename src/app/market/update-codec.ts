/**
 * Decoder for the Wasm producer's batches: a flat `Int32Array` of fixed-size records.
 *
 * `UPDATE_FIELDS` must list the fields in the same order as `UPDATE_FIELDS` in
 * `wasm/producer/src/layout.rs`. The worker compares both lists at start-up
 * (`assertLayout(updateLayout())`), so a field added on one side only fails loudly instead of
 * silently shifting columns.
 */

export const UPDATE_FIELDS = [
  'instrumentIndex',
  'priceCents',
  'tradeQuantity',
  'bidCents',
  'askCents',
  'bidQuantity',
  'askQuantity',
] as const;

export type UpdateField = (typeof UPDATE_FIELDS)[number];

// Number of `i32` values per update.
export const STRIDE = UPDATE_FIELDS.length;

// Offset of each field inside a record: `data[offset + F.priceCents]`
export const F = Object.fromEntries(UPDATE_FIELDS.map((field, i) => [field, i])) as Readonly<
  Record<UpdateField, number>
>;

export type MarketUpdate = Readonly<Record<UpdateField, number>>;

export function assertLayout(fromWasm: readonly string[]): void {
  if (fromWasm.join() !== UPDATE_FIELDS.join()) {
    throw new Error(
      'The Wasm update layout does not match the TypeScript decoder. ' +
        `Wasm: [${fromWasm.join(', ')}]; TypeScript: [${UPDATE_FIELDS.join(', ')}].`,
    );
  }
}

// for tests
export function encodeUpdates(updates: readonly MarketUpdate[]): Int32Array {
  return Int32Array.from(updates.flatMap((u) => UPDATE_FIELDS.map((field) => u[field])));
}
