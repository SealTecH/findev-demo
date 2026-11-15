use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProducerError {
    InvalidInstrumentCount { value: u32, max: u32 },
    InvalidBatchSize { value: u32, max: u32 },
}

impl fmt::Display for ProducerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidInstrumentCount { value, max } => {
                write!(
                    f,
                    "instrument count must be between 1 and {max}, got {value}"
                )
            }
            Self::InvalidBatchSize { value, max } => {
                write!(f, "batch size must be between 1 and {max}, got {value}")
            }
        }
    }
}

impl std::error::Error for ProducerError {}
