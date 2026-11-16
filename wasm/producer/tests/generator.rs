//! Generator tests through the core API that the Wasm layer wraps.

use std::collections::HashSet;

use producer::config::{MAX_BATCH_SIZE, MAX_INSTRUMENTS, ProducerConfig};
use producer::error::ProducerError;
use producer::layout::{MarketUpdate, STRIDE};
use producer::market::{MAX_BOOK_QUANTITY, MAX_STEP_DIVISOR, MAX_TRADE_QUANTITY, Market};

fn market(instrument_count: u32, seed: u64) -> Market {
    Market::new(&ProducerConfig {
        instrument_count,
        seed,
    })
    .expect("valid config")
}

fn decode(data: &[i32]) -> Vec<MarketUpdate> {
    let (records, rest) = data.as_chunks::<STRIDE>();
    assert!(rest.is_empty(), "batch is a whole number of records");
    records
        .iter()
        .map(|record| MarketUpdate::from_record(record))
        .collect()
}

/// `batches × batch_size` updates from a fresh market.
fn updates(instrument_count: u32, seed: u64, batches: usize, batch_size: u32) -> Vec<MarketUpdate> {
    let mut m = market(instrument_count, seed);
    (0..batches)
        .flat_map(|_| decode(&m.generate(batch_size).expect("valid batch size")))
        .collect()
}

#[test]
fn batches_have_the_requested_size() {
    let mut m = market(5, 1);
    for batch_size in [1, 100, 1_000] {
        let data = m.generate(batch_size).unwrap();
        assert_eq!(data.len(), batch_size as usize * STRIDE);
    }
}

#[test]
fn invalid_batch_sizes_are_rejected() {
    let mut m = market(5, 1);
    assert_eq!(
        m.generate(0),
        Err(ProducerError::InvalidBatchSize {
            value: 0,
            max: MAX_BATCH_SIZE
        })
    );
    assert!(m.generate(MAX_BATCH_SIZE + 1).is_err());
}

#[test]
fn invalid_instrument_counts_are_rejected() {
    for instrument_count in [0, MAX_INSTRUMENTS + 1] {
        let result = Market::new(&ProducerConfig {
            instrument_count,
            seed: 1,
        });
        assert!(matches!(
            result,
            Err(ProducerError::InvalidInstrumentCount { .. })
        ));
    }
}

#[test]
fn generated_values_are_valid() {
    for instrument_count in [1, 5, 50] {
        for u in updates(instrument_count, 2024, 100, 1_000) {
            assert!(u.instrument_index < instrument_count, "{u:?}");
            assert!(u.price_cents > 0, "{u:?}");
            assert!(u.bid_cents >= 1, "{u:?}");
            assert!(u.bid_cents < u.ask_cents, "{u:?}");
            assert!(
                u.price_cents == u.bid_cents || u.price_cents == u.ask_cents,
                "trade price must be the bid or the ask: {u:?}"
            );
            assert!(
                (1..=MAX_TRADE_QUANTITY).contains(&u.trade_quantity),
                "{u:?}"
            );
            assert!((0..=MAX_BOOK_QUANTITY).contains(&u.bid_quantity), "{u:?}");
            assert!((0..=MAX_BOOK_QUANTITY).contains(&u.ask_quantity), "{u:?}");
        }
    }
}

#[test]
fn both_trade_sides_and_empty_book_sides_occur() {
    let all = updates(5, 77, 100, 1_000);
    assert!(all.iter().any(|u| u.price_cents == u.ask_cents), "no buys");
    assert!(all.iter().any(|u| u.price_cents == u.bid_cents), "no sells");
    assert!(
        all.iter()
            .any(|u| u.bid_quantity == 0 || u.ask_quantity == 0),
        "an empty book side should occasionally occur (zero imbalance denominator)"
    );
}

#[test]
fn state_is_retained_between_calls() {
    // Two calls of 50 must continue exactly where one call of 100 would: nothing is reset.
    let mut split = market(5, 99);
    let mut joined = split.generate(50).unwrap();
    joined.extend(split.generate(50).unwrap());

    let mut single = market(5, 99);
    assert_eq!(joined, single.generate(100).unwrap());
}

#[test]
fn prices_evolve_from_previous_values() {
    let all = updates(1, 314, 10, 1_000);
    let mid = |u: &MarketUpdate| f64::from(u.bid_cents + u.ask_cents) / 2.0;

    let mut changed = 0;
    for pair in all.windows(2) {
        let (prev, next) = (mid(&pair[0]), mid(&pair[1]));
        // ≤ 0.1 % per step, plus a cent for rounding the bid/ask midpoint.
        let max_step = prev / f64::from(MAX_STEP_DIVISOR) + 1.0;
        assert!(
            (next - prev).abs() <= max_step,
            "jump from {prev} to {next} is not a random-walk step"
        );
        if (next - prev).abs() > f64::EPSILON {
            changed += 1;
        }
    }
    assert!(changed > all.len() / 2, "prices should actually move");
}

#[test]
fn same_seed_is_deterministic_and_seeds_differ() {
    assert_eq!(updates(10, 5, 3, 500), updates(10, 5, 3, 500));
    assert_ne!(updates(10, 5, 3, 500), updates(10, 6, 3, 500));
}

#[test]
fn every_instrument_receives_updates() {
    let seen: HashSet<u32> = updates(50, 8, 10, 1_000)
        .iter()
        .map(|u| u.instrument_index)
        .collect();
    assert_eq!(seen.len(), 50);
}

#[test]
fn an_update_changes_only_the_picked_instrument() {
    let mut m = market(10, 123);
    for _ in 0..1_000 {
        let before: Vec<_> = (0..10).map(|i| m.instrument(i).unwrap().clone()).collect();
        let update = m.next_update();
        for (i, state) in before.iter().enumerate() {
            if i != update.instrument_index as usize {
                assert_eq!(
                    m.instrument(i).unwrap(),
                    state,
                    "instrument {i} must not change"
                );
            }
        }
    }
}

#[test]
fn symbols_match_the_instrument_count() {
    for instrument_count in [1, 5, 50] {
        let m = market(instrument_count, 1);
        assert_eq!(m.instrument_count(), instrument_count);
        let unique: HashSet<&String> = m.symbols().iter().collect();
        assert_eq!(unique.len(), instrument_count as usize);
    }
}

#[test]
fn symbols_do_not_depend_on_the_seed() {
    assert_eq!(market(20, 1).symbols(), market(20, 2).symbols());
}

#[test]
fn zero_is_a_valid_seed() {
    let all = updates(5, 0, 1, 1_000);
    assert_eq!(all.len(), 1_000);
    let distinct_prices: HashSet<i32> = all.iter().map(|u| u.price_cents).collect();
    assert!(
        distinct_prices.len() > 10,
        "seed 0 must still produce varied data"
    );
}
