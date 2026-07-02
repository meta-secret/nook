# syntax=docker/dockerfile:1.4

# nook-wasm build stage: wasm32 clippy + release build + wasm-pack bundle.
# LINEAR CHAIN: FROM builder-debug (native warm-up), so this stage inherits the native target/
# in place and adds the wasm32 target/ + generated JS/wasm bundle to the SAME image lineage.
# No COPY --from of target/ anywhere — the whole toolchain is one continuous image, which keeps
# the BuildKit cache chain intact (a warm rebuild is a pure cache hit, no recompile) and avoids
# re-materializing multi-GB target/ layers. `builder-debug` is injected by bake via
# `contexts = { builder-debug = "target:builder-debug" }`.

FROM builder-debug AS builder-wasm

# Separate RUNs so each layer caches independently.
RUN cargo clippy --release --target wasm32-unknown-unknown -p nook-wasm -- -D warnings
RUN cargo build --release --target wasm32-unknown-unknown -p nook-wasm
# --out-dir is relative to the crate dir (nook-wasm/), so "../nook-web/..." lands the JS/wasm bundle
# in the web source tree where Vite imports it. target/ stays in-tree for reuse.
RUN wasm-pack build nook-wasm --target web --out-dir ../nook-web/src/lib/nook-wasm --out-name nook_wasm
