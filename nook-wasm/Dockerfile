# syntax=docker/dockerfile:1.4

# nook-wasm build stage: wasm32 clippy + release build + wasm-pack bundle.
# Build context is the repo root (shared Cargo workspace). `builder-deps` (the chef-cooked
# rust dependency cache from nook-core/Dockerfile) is injected by bake via
# `contexts = { builder-deps = "target:builder-deps" }`, so deps are cooked once and reused.
# Runs in parallel with builder-debug after builder-deps.

FROM builder-deps AS builder-wasm

COPY Cargo.toml Cargo.lock ./
COPY nook-core nook-core
COPY nook-wasm nook-wasm
# Separate RUNs so each layer caches independently.
RUN cargo clippy --release --target wasm32-unknown-unknown -p nook-wasm -- -D warnings
RUN cargo build --release --target wasm32-unknown-unknown -p nook-wasm
# --out-dir is relative to the crate dir (nook-wasm/), so "../nook-web/..." lands the JS/wasm bundle
# in the web source tree where Vite imports it. target/ stays in-tree for reuse.
RUN wasm-pack build nook-wasm --target web --out-dir ../nook-web/src/lib/nook-wasm --out-name nook_wasm
