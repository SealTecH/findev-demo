use crate::market::Quote;

pub const UPDATE_FIELDS: [&str; 7] = [
    "instrumentIndex",
    "priceCents",
    "tradeQuantity",
    "bidCents",
    "askCents",
    "bidQuantity",
    "askQuantity",
];

pub const STRIDE: usize = UPDATE_FIELDS.len();

/// One simulated trade plus the instrument's current bid/ask snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MarketUpdate {
    pub instrument_index: u32,
    pub price_cents: i32,
    pub trade_quantity: i32,
    pub bid_cents: i32,
    pub ask_cents: i32,
    pub bid_quantity: i32,
    pub ask_quantity: i32,
}

impl MarketUpdate {
    pub fn new(
        instrument_index: u32,
        price_cents: i32,
        trade_quantity: i32,
        quote: &Quote,
    ) -> Self {
        Self {
            instrument_index,
            price_cents,
            trade_quantity,
            bid_cents: quote.bid_cents,
            ask_cents: quote.ask_cents,
            bid_quantity: quote.bid_quantity,
            ask_quantity: quote.ask_quantity,
        }
    }

    /// Encodes the update in `UPDATE_FIELDS` order.
    pub fn to_record(&self) -> [i32; STRIDE] {
        [
            // At most MAX_INSTRUMENTS, so it fits.
            i32::try_from(self.instrument_index).expect("instrument index fits in i32"),
            self.price_cents,
            self.trade_quantity,
            self.bid_cents,
            self.ask_cents,
            self.bid_quantity,
            self.ask_quantity,
        ]
    }

    /// Decodes one record. Used by tests.
    pub fn from_record(record: &[i32]) -> Self {
        assert_eq!(record.len(), STRIDE, "a record has exactly {STRIDE} fields");
        Self {
            instrument_index: u32::try_from(record[0]).expect("instrument index is non-negative"),
            price_cents: record[1],
            trade_quantity: record[2],
            bid_cents: record[3],
            ask_cents: record[4],
            bid_quantity: record[5],
            ask_quantity: record[6],
        }
    }

    pub fn write_to(&self, out: &mut Vec<i32>) {
        out.extend_from_slice(&self.to_record());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> MarketUpdate {
        MarketUpdate {
            instrument_index: 3,
            price_cents: 10_200,
            trade_quantity: 30,
            bid_cents: 10_196,
            ask_cents: 10_200,
            bid_quantity: 600,
            ask_quantity: 400,
        }
    }

    fn field(name: &str) -> usize {
        UPDATE_FIELDS
            .iter()
            .position(|&f| f == name)
            .unwrap_or_else(|| panic!("no field {name}"))
    }

    #[test]
    fn record_round_trips() {
        let update = sample();
        assert_eq!(MarketUpdate::from_record(&update.to_record()), update);
    }

    #[test]
    fn record_positions_match_field_names() {
        let record = sample().to_record();
        assert_eq!(record[field("instrumentIndex")], 3);
        assert_eq!(record[field("priceCents")], 10_200);
        assert_eq!(record[field("tradeQuantity")], 30);
        assert_eq!(record[field("bidCents")], 10_196);
        assert_eq!(record[field("askCents")], 10_200);
        assert_eq!(record[field("bidQuantity")], 600);
        assert_eq!(record[field("askQuantity")], 400);
    }

    #[test]
    fn field_names_are_unique() {
        let mut names = UPDATE_FIELDS.to_vec();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), STRIDE);
    }

    #[test]
    fn write_to_appends_one_record() {
        let mut out = vec![-1];
        sample().write_to(&mut out);
        assert_eq!(out.len(), 1 + STRIDE);
        assert_eq!(out[1..], sample().to_record());
    }
}
