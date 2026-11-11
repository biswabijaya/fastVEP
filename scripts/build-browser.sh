#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
cargo test -p fastvep-web export_bindings --lib
cargo build --locked -p fastvep-wasm --target wasm32-unknown-unknown --release
wasm-bindgen target/wasm32-unknown-unknown/release/fastvep_wasm.wasm --target web --out-dir frontend/public/wasm
npm ci --prefix frontend
npm run build --prefix frontend
