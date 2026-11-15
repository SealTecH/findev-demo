#!/usr/bin/env node
// Builds the Rust producer to WebAssembly and generates its JavaScript bindings.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CRATE_DIR = join(ROOT, 'wasm', 'producer');
const CRATE_NAME = 'producer';
const TARGET = 'wasm32-unknown-unknown';
const PKG_DIR = join(ROOT, 'src', 'app', 'producer', 'wasm-pkg');
const PUBLIC_DIR = join(ROOT, 'public', 'wasm');
const WASM_FILE = `${CRATE_NAME}_bg.wasm`;

// rustup installs into ~/.cargo/bin, which is not on PATH in every shell (e.g. a fresh
// terminal on Windows, or Vercel's build step after the install step).
const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
const cargoBin = join(process.env.CARGO_HOME ?? join(homedir(), '.cargo'), 'bin');
const env = { ...process.env, [pathKey]: [cargoBin, process.env[pathKey]].join(delimiter) };

function fail(message) {
  console.error(`\n✖ build:wasm — ${message}\n`);
  process.exit(1);
}

function run(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) fail(`could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} ${args[0]} exited with code ${result.status}`);
}

/** stdout of a command, or null when the command is not installed. */
function output(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8' });
  return result.error || result.status !== 0 ? null : result.stdout.trim();
}

function lockedWasmBindgenVersion() {
  const lock = readFileSync(join(CRATE_DIR, 'Cargo.lock'), 'utf8');
  const match = /name = "wasm-bindgen"\r?\nversion = "([^"]+)"/.exec(lock);
  if (!match) fail('wasm-bindgen not found in wasm/producer/Cargo.lock');
  return match[1];
}

function kib(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}


if (!output('cargo', ['--version'], CRATE_DIR)) {
  fail(
    'Rust toolchain not found. Install it from https://rustup.rs ' +
      '(the target from wasm/producer/rust-toolchain.toml is added automatically).',
  );
}

const expected = lockedWasmBindgenVersion();
const installed = output('wasm-bindgen', ['--version'])?.replace(/^wasm-bindgen\s+/, '') ?? null;
if (installed !== expected) {
  fail(
    `wasm-bindgen CLI ${expected} is required (Cargo.lock), found ${installed ?? 'none'}.\n` +
      `  Install it with: cargo install wasm-bindgen-cli --version ${expected} --locked`,
  );
}

// Rust → wasm32.
run('cargo', ['build', '--release', '--locked', '--target', TARGET], CRATE_DIR);
const rawWasm = join(CRATE_DIR, 'target', TARGET, 'release', `${CRATE_NAME}.wasm`);

// wasm32 module → ES module glue + TypeScript declarations.
rmSync(PKG_DIR, { recursive: true, force: true });
run('wasm-bindgen', [
  '--target',
  'web',
  '--omit-default-module-path',
  '--out-dir',
  PKG_DIR,
  '--out-name',
  CRATE_NAME,
  rawWasm,
]);

// The binary goes to public/ to be served as /wasm/producer_bg.wasm.
mkdirSync(PUBLIC_DIR, { recursive: true });
const servedWasm = join(PUBLIC_DIR, WASM_FILE);
renameSync(join(PKG_DIR, WASM_FILE), servedWasm);

const bytes = readFileSync(servedWasm);
console.log(
  `\n✔ build:wasm — wasm-bindgen ${expected}\n` +
    `  ${relative(ROOT, PKG_DIR)}/  (JS glue + .d.ts)\n` +
    `  ${relative(ROOT, servedWasm)}  ${kib(bytes.length)}, ${kib(gzipSync(bytes).length)} gzip\n`,
);
