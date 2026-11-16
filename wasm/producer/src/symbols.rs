//! Instrument symbols `TKR001`, `TKR002`, …, computed from the index.

/// Symbol of the instrument with zero-based `index`.
pub fn symbol(index: u32) -> String {
    format!("TKR{:03}", u64::from(index) + 1)
}

pub fn symbols(count: u32) -> Vec<String> {
    (0..count).map(symbol).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn symbols_are_one_based_and_zero_padded() {
        assert_eq!(symbol(0), "TKR001");
        assert_eq!(symbol(1), "TKR002");
        assert_eq!(symbol(41), "TKR042");
        assert_eq!(symbol(998), "TKR999");
        assert_eq!(symbol(999), "TKR1000");
    }

    #[test]
    fn symbols_are_unique() {
        let all = symbols(10_000);
        let unique: HashSet<&String> = all.iter().collect();
        assert_eq!(unique.len(), all.len());
    }

    #[test]
    fn symbols_are_prefix_consistent() {
        // A run with 5 instruments shows the same first rows as a run with 50.
        assert_eq!(symbols(5), symbols(50)[..5]);
        assert_eq!(symbols(3), ["TKR001", "TKR002", "TKR003"]);
    }
}
