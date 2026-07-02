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
COPY --from=chef-planner /meta-secret/nook/recipe.json ./recipe.json
COPY Cargo.toml Cargo.lock ./
COPY nook-core/Cargo.toml nook-core/Cargo.toml
COPY nook-wasm/Cargo.toml nook-wasm/Cargo.toml
# Separate RUNs so each cooks into its own cache layer (change one profile, only that re-cooks).
RUN cargo chef cook --all-targets --recipe-path recipe.json
RUN cargo chef cook --clippy --all-targets --recipe-path recipe.json
RUN cargo chef cook --release --target wasm32-unknown-unknown --recipe-path recipe.json
RUN cargo chef cook --release --clippy --target wasm32-unknown-unknown --recipe-path recipe.json
RUN cargo fetch --locked

# --- Native verify warm-up (parallel with builder-wasm after builder-deps) ---
FROM builder-deps AS builder-debug

COPY Cargo.toml Cargo.lock ./
COPY nook-core nook-core
COPY nook-wasm nook-wasm
COPY .config .config
# nextest --no-run first: reuse chef-cooked rustc artifacts; clippy then Checks deps instead of recompiling them.
RUN cargo nextest run --no-run -p nook-core --profile ci
RUN cargo clippy -p nook-core --all-targets -- -D warnings
RUN bash -c 'set -euo pipefail; source <(cargo llvm-cov show-env --sh); cargo nextest run --no-run -p nook-core --profile ci'
