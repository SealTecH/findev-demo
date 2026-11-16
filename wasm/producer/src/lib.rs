//! Simulated market-data producer.

pub mod config;
pub mod error;
pub mod layout;
pub mod market;
pub mod symbols;

use wasm_bindgen::prelude::*;

use crate::config::ProducerConfig;
use crate::layout::UPDATE_FIELDS;
use crate::market::Market;

/// One producer run: per-instrument state plus the random stream.
#[wasm_bindgen]
pub struct Producer {
    market: Market,
}

#[wasm_bindgen]
impl Producer {
    /// `config` is a plain object: `{ instrumentCount: number, seed?: number }`.
    #[wasm_bindgen(constructor)]
    pub fn new(config: JsValue) -> Result<Producer, JsError> {
        let config: ProducerConfig = serde_wasm_bindgen::from_value(config)
            .map_err(|e| JsError::new(&format!("invalid producer config: {e}")))?;
        let market = Market::new(&config)?;
        Ok(Self { market })
    }

    /// Instrument symbols, indexed like `instrumentIndex` in the updates.
    pub fn symbols(&self) -> Vec<String> {
        self.market.symbols().to_vec()
    }

    /// Generates `batch_size` updates as a flat `Int32Array` (`batch_size × STRIDE`).
    pub fn generate(&mut self, batch_size: u32) -> Result<Vec<i32>, JsError> {
        Ok(self.market.generate(batch_size)?)
    }
}

/// Field names of one update record, in order — the contract with the TypeScript decoder.
#[wasm_bindgen(js_name = updateLayout)]
pub fn update_layout() -> Vec<String> {
    UPDATE_FIELDS
        .iter()
        .map(|&field| field.to_owned())
        .collect()
}
