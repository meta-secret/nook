# syntax=docker/dockerfile:1.4

# nook-core build stages: chef recipe -> shared rust dependency cache -> native verify warm-up.
# Build context is the repo root (shared Cargo workspace). `nook-base` is injected by bake
# via `contexts = { nook-base = "target:nook-base" }`. `builder-deps` here is also the shared
# base for the wasm build (nook-wasm/Dockerfile consumes it the same way).

# --- Chef planner: recipe.json generated here during docker build (not committed) ---
FROM nook-base AS chef-planner

COPY Cargo.toml Cargo.lock ./
COPY nook-core nook-core
COPY nook-wasm nook-wasm
RUN cargo chef prepare --recipe-path recipe.json

# --- Shared rust dependency cache (chef cook + fetch once) ---
FROM nook-base AS builder-deps

COPY .cargo .cargo
COPY .config .config
COPY --from=chef-planner /meta-secret/nook/recipe.json ./recipe.json
COPY Cargo.toml Cargo.lock ./
COPY nook-core/Cargo.toml nook-core/Cargo.toml
COPY nook-wasm/Cargo.toml nook-wasm/Cargo.toml
# wasm deps via cargo-chef (the wasm build in nook-wasm/Dockerfile reuses these). Separate RUNs so
# each cooks into its own cache layer.
RUN cargo chef cook --release --target wasm32-unknown-unknown --recipe-path recipe.json
RUN cargo chef cook --release --clippy --target wasm32-unknown-unknown --recipe-path recipe.json
RUN cargo fetch --locked
# Warm the native test- AND dev/check-profile DEPENDENCY artifacts against the REAL Cargo.lock.
# cargo-chef rewrites workspace versions to 0.0.1, so its cooked native artifacts are NOT reused by
# `cargo nextest`/`clippy` once the true lockfile is in place (see cargo-chef#305) — so we warm the
# native deps here instead of with chef. Stub in dummy crate roots so the workspace resolves,
# compile the deps, then drop the stub crate artifacts — real source then recompiles nook-core
# alone (deps stay warm). Kept as separate cache layers.
RUN mkdir -p nook-core/src nook-wasm/src
RUN echo '' > nook-core/src/lib.rs
RUN echo '' > nook-wasm/src/lib.rs
RUN cargo nextest run --no-run -p nook-core --profile ci
RUN cargo clippy -p nook-core --all-targets -- -D warnings
RUN rm -rf nook-core/src nook-wasm/src

# --- Native verify warm-up (parallel with builder-wasm after builder-deps) ---
FROM builder-deps AS builder-debug

COPY Cargo.toml Cargo.lock ./
COPY nook-core nook-core
COPY nook-wasm nook-wasm
COPY .config .config
# Compile the nook-core test/dev/coverage builds. This layer is invalidated on any nook-core
# source change; the deps are compiled once here and reused across the three steps below.
RUN cargo nextest run --no-run -p nook-core --profile ci
RUN cargo clippy -p nook-core --all-targets -- -D warnings
RUN bash -c 'set -euo pipefail; source <(cargo llvm-cov show-env --sh); cargo nextest run --no-run -p nook-core --profile ci'
