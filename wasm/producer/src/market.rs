//! Market simulation: per-instrument state and the update generator.
//!
//! The generator is split into two small strategies so either can be swapped without touching
//! `Market`:
//! - [`PriceModel`] — how an instrument's quote (bid/ask and book quantities) evolves;
//! - [`InstrumentPicker`] — which instrument the next update belongs to.
//!
//! Randomness comes from `fastrand` (wyrand): one `Rng` per run, seeded once by the browser,
//! so a fixed seed reproduces a run exactly. It is compiled into the Wasm module together
//! with the price logic.

use fastrand::Rng;

use crate::config::{ProducerConfig, validate_batch_size};
use crate::error::ProducerError;
use crate::layout::{MarketUpdate, STRIDE};
use crate::symbols;

/// Mid price is kept within $1 … $100 000. Everything is `i32`: the largest intermediate
/// value, `MAX_MID_CENTS + max_step`, is ~0.5 % of `i32::MAX`, so no step can overflow.
pub const MIN_MID_CENTS: i32 = 100;
pub const MAX_MID_CENTS: i32 = 10_000_000;
/// One price step moves the mid by at most `mid / MAX_STEP_DIVISOR` (0.1 %), at least 1 cent.
pub const MAX_STEP_DIVISOR: i32 = 1_000;
pub const MAX_BOOK_QUANTITY: i32 = 2_000;
pub const MAX_TRADE_QUANTITY: i32 = 500;

/// Everything the generator remembers about one instrument between calls.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstrumentState {
    pub mid_cents: i32,
    pub max_spread_cents: i32,
}

/// Current bid/ask snapshot of an instrument.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Quote {
    pub bid_cents: i32,
    pub ask_cents: i32,
    pub bid_quantity: i32,
    pub ask_quantity: i32,
}

pub trait PriceModel {
    fn initial_state(&self, rng: &mut Rng) -> InstrumentState;
    /// Advances `state` by one step and returns the resulting quote.
    /// Must keep `1 <= bid < ask` and non-negative quantities.
    fn next_quote(&self, state: &mut InstrumentState, rng: &mut Rng) -> Quote;
}

pub trait InstrumentPicker {
    /// Returns an index in `0..instrument_count`.
    fn pick(&self, instrument_count: u32, rng: &mut Rng) -> u32;
}

/// Random walk of the mid price: each step adds a uniform integer in `−max_step..=+max_step`
/// cents, where `max_step` is 0.1 % of the current mid. A random spread is placed around the
/// mid; book quantities are drawn fresh on every update.
pub struct RandomWalk;

impl PriceModel for RandomWalk {
    fn initial_state(&self, rng: &mut Rng) -> InstrumentState {
        InstrumentState {
            mid_cents: rng.i32(2_000..=50_000), // $20 … $500
            max_spread_cents: rng.i32(1..=8),
        }
    }

    fn next_quote(&self, state: &mut InstrumentState, rng: &mut Rng) -> Quote {
        let max_step = (state.mid_cents / MAX_STEP_DIVISOR).max(1);
        let step = rng.i32(-max_step..=max_step);
        state.mid_cents = (state.mid_cents + step).clamp(MIN_MID_CENTS, MAX_MID_CENTS);

        let spread = rng.i32(1..=state.max_spread_cents);
        let bid_cents = (state.mid_cents - spread / 2).max(1);
        let ask_cents = bid_cents + spread;

        Quote {
            bid_cents,
            ask_cents,
            // 0 is a possible draw, so the imbalance denominator occasionally hits zero.
            bid_quantity: rng.i32(0..=MAX_BOOK_QUANTITY),
            ask_quantity: rng.i32(0..=MAX_BOOK_QUANTITY),
        }
    }
}

/// Every instrument is equally likely; one may appear several times in a batch.
pub struct UniformPicker;

impl InstrumentPicker for UniformPicker {
    fn pick(&self, instrument_count: u32, rng: &mut Rng) -> u32 {
        rng.u32(..instrument_count)
    }
}

pub struct Market {
    rng: Rng,
    instruments: Vec<InstrumentState>,
    symbols: Vec<String>,
    price_model: Box<dyn PriceModel>,
    picker: Box<dyn InstrumentPicker>,
}

impl Market {
    pub fn new(config: &ProducerConfig) -> Result<Self, ProducerError> {
        Self::with_strategies(config, Box::new(RandomWalk), Box::new(UniformPicker))
    }

    pub fn with_strategies(
        config: &ProducerConfig,
        price_model: Box<dyn PriceModel>,
        picker: Box<dyn InstrumentPicker>,
    ) -> Result<Self, ProducerError> {
        config.validate()?;
        let mut rng = Rng::with_seed(config.seed);
        let instruments = (0..config.instrument_count)
            .map(|_| price_model.initial_state(&mut rng))
            .collect();
        Ok(Self {
            rng,
            instruments,
            symbols: symbols::symbols(config.instrument_count),
            price_model,
            picker,
        })
    }

    pub fn symbols(&self) -> &[String] {
        &self.symbols
    }

    pub fn instrument_count(&self) -> u32 {
        self.symbols.len() as u32
    }

    pub fn instrument(&self, index: usize) -> Option<&InstrumentState> {
        self.instruments.get(index)
    }

    /// Generates one update: picks an instrument, advances only that instrument's state and
    /// simulates a trade at its bid (sell) or ask (buy).
    pub fn next_update(&mut self) -> MarketUpdate {
        let index = self.picker.pick(self.instrument_count(), &mut self.rng);
        let state = &mut self.instruments[index as usize];
        let quote = self.price_model.next_quote(state, &mut self.rng);

        let is_buy = self.rng.bool();
        let price_cents = if is_buy {
            quote.ask_cents
        } else {
            quote.bid_cents
        };
        let trade_quantity = self.rng.i32(1..=MAX_TRADE_QUANTITY);

        MarketUpdate::new(index, price_cents, trade_quantity, &quote)
    }

    /// Writes `batch_size` updates into `out` (cleared first), `STRIDE` values each.
    pub fn generate_into(
        &mut self,
        batch_size: u32,
        out: &mut Vec<i32>,
    ) -> Result<(), ProducerError> {
        validate_batch_size(batch_size)?;
        out.clear();
        out.reserve(batch_size as usize * STRIDE);
        for _ in 0..batch_size {
            self.next_update().write_to(out);
        }
        Ok(())
    }

    pub fn generate(&mut self, batch_size: u32) -> Result<Vec<i32>, ProducerError> {
        let mut out = Vec::new();
        self.generate_into(batch_size, &mut out)?;
        Ok(out)
    }
}
