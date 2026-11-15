#!/usr/bin/env bash
# Vercel installCommand: Rust toolchain + wasm-bindgen CLI, then npm dependencies.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRATE_DIR="$ROOT/wasm/producer"
export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
export RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup}"
export PATH="$CARGO_HOME/bin:$PATH"

if [[ "$(uname -s)-$(uname -m)" != "Linux-x86_64" ]]; then
  echo "vercel-install.sh supports Linux x86_64 only (got $(uname -s)-$(uname -m))" >&2
  exit 1
fi

# rustup
if ! command -v rustup >/dev/null 2>&1; then
  echo "› Installing rustup"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs |
    sh -s -- -y --profile minimal --default-toolchain none --no-modify-path
fi

# Toolchain + wasm32 target from rust-toolchain.toml.
echo "› Installing the Rust toolchain from wasm/producer/rust-toolchain.toml"
(cd "$CRATE_DIR" && rustup toolchain install && rustc --version)

# Prebuilt wasm-bindgen CLI matching Cargo.lock.
WB_VERSION="$(awk '/^name = "wasm-bindgen"$/ { getline; gsub(/version = |"/, ""); print; exit }' "$CRATE_DIR/Cargo.lock")"
if [[ -z "$WB_VERSION" ]]; then
  echo "wasm-bindgen version not found in Cargo.lock" >&2
  exit 1
fi
if [[ "$(wasm-bindgen --version 2>/dev/null || true)" != "wasm-bindgen $WB_VERSION" ]]; then
  echo "› Installing wasm-bindgen CLI $WB_VERSION"
  ARCHIVE="wasm-bindgen-$WB_VERSION-x86_64-unknown-linux-musl"
  curl -sSfL "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/$WB_VERSION/$ARCHIVE.tar.gz" |
    tar -xz -C "$CARGO_HOME/bin" --strip-components=1 "$ARCHIVE/wasm-bindgen"
fi
wasm-bindgen --version

# JavaScript dependencies.
npm ci
