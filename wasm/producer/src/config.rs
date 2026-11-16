use serde::Deserialize;

use crate::error::ProducerError;

/// Technical limits; the UI allows 1–50 instruments and 1–1000 updates.
pub const MAX_INSTRUMENTS: u32 = 10_000;
pub const MAX_BATCH_SIZE: u32 = 100_000;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProducerConfig {
    pub instrument_count: u32,
    #[serde(default)]
    pub seed: u64,
}

impl ProducerConfig {
    pub fn validate(&self) -> Result<(), ProducerError> {
        if (1..=MAX_INSTRUMENTS).contains(&self.instrument_count) {
            Ok(())
        } else {
            Err(ProducerError::InvalidInstrumentCount {
                value: self.instrument_count,
                max: MAX_INSTRUMENTS,
            })
        }
    }
}

pub fn validate_batch_size(batch_size: u32) -> Result<(), ProducerError> {
    if (1..=MAX_BATCH_SIZE).contains(&batch_size) {
        Ok(())
    } else {
        Err(ProducerError::InvalidBatchSize {
            value: batch_size,
            max: MAX_BATCH_SIZE,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(instrument_count: u32) -> ProducerConfig {
        ProducerConfig {
            instrument_count,
            seed: 1,
        }
    }

    #[test]
    fn accepts_instrument_counts_within_the_symbol_space() {
        for count in [1, 5, 50, MAX_INSTRUMENTS] {
            assert_eq!(config(count).validate(), Ok(()));
        }
    }

    #[test]
    fn rejects_zero_and_too_many_instruments() {
        for count in [0, MAX_INSTRUMENTS + 1] {
            assert_eq!(
                config(count).validate(),
                Err(ProducerError::InvalidInstrumentCount {
                    value: count,
                    max: MAX_INSTRUMENTS
                })
            );
        }
    }

    #[test]
    fn validates_batch_size_bounds() {
        assert!(validate_batch_size(1).is_ok());
        assert!(validate_batch_size(MAX_BATCH_SIZE).is_ok());
        assert!(validate_batch_size(0).is_err());
        assert!(validate_batch_size(MAX_BATCH_SIZE + 1).is_err());
    }

    #[test]
    fn error_messages_are_readable() {
        let message = config(0).validate().unwrap_err().to_string();
        assert_eq!(
            message,
            "instrument count must be between 1 and 10000, got 0"
        );
    }
}
