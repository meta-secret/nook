# syntax=docker/dockerfile:1.4

# nook-core build stages: chef recipe -> shared rust dependency cache -> native verify warm-up.
# Build context is the repo root; the Rust workspace root lives at nook-app. `nook-base` is injected by bake
# via `contexts = { nook-base = "target:nook-base" }`. `builder-deps` here is also the shared
# base for the wasm build (nook-app/nook-wasm/Dockerfile consumes it the same way).

# --- Chef planner: recipe.json generated here during docker build (not committed) ---
FROM nook-base AS chef-planner

WORKDIR /meta-secret/nook/nook-app

COPY nook-app/Cargo.toml nook-app/Cargo.lock ./
COPY nook-app/nook-core nook-core
COPY nook-app/nook-wasm nook-wasm
RUN cargo chef prepare --recipe-path recipe.json

# --- Shared rust dependency cache (chef cook + fetch once) ---
FROM nook-base AS builder-deps

WORKDIR /meta-secret/nook/nook-app

COPY nook-app/.cargo .cargo
COPY nook-app/.config .config
COPY --from=chef-planner /meta-secret/nook/nook-app/recipe.json ./recipe.json
COPY nook-app/Cargo.toml nook-app/Cargo.lock ./
COPY nook-app/nook-core/Cargo.toml nook-core/Cargo.toml
COPY nook-app/nook-wasm/Cargo.toml nook-wasm/Cargo.toml
# wasm deps via cargo-chef (the wasm build in nook-app/nook-wasm/Dockerfile reuses these). Separate RUNs so
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
# Also warm the COVERAGE-instrumented deps: cargo-llvm-cov builds with -Cinstrument-coverage +
# cfg(coverage) into its own target/llvm-cov-target dir — a distinct fingerprint AND location from
# the plain nextest/clippy builds above. Without this, builder-debug's `cargo llvm-cov nextest`
# recompiles every dependency with instrumentation. --no-report skips report merge; --no-tests=pass
# tolerates the stub crate having zero tests (nextest exits 4 otherwise). This warms the instrumented
# deps so builder-debug's real coverage step is a cache hit.
RUN cargo llvm-cov nextest --no-report --profile ci -p nook-core --no-tests=pass
RUN rm -rf nook-core/src nook-wasm/src

# --- Native verify warm-up (parallel with builder-wasm after builder-deps) ---
FROM builder-deps AS builder-debug

WORKDIR /meta-secret/nook/nook-app

COPY nook-app/Cargo.toml nook-app/Cargo.lock ./
COPY nook-app/nook-core nook-core
COPY nook-app/nook-wasm nook-wasm
COPY nook-app/.config .config
# nook-core verify, all as BUILD steps (fail the image build on any regression). This layer is
# invalidated only on a nook-core source change; deps stay warm from builder-deps, so each step
# recompiles nook-core alone.
RUN cargo clippy -p nook-core --all-targets -- -D warnings
# Coverage runs HERE, in the image build (not at task runtime): cargo-llvm-cov compiles + runs the
# nook-core tests with instrumentation and enforces the committed line floor via --fail-under-lines
# (read from nook-app/nook-core/coverage-floor.json). If coverage drops below the floor the build fails. The
# same run also bakes the coverage artifacts that PR CI copies out later; export must not rerun the
# Rust tests.
RUN FLOOR="$(jq -r '.lines_percent' nook-core/coverage-floor.json)" \
    && mkdir -p /opt/nook/coverage/nook-core \
    && cargo llvm-cov nextest --no-clean --profile ci -p nook-core --summary-only --fail-under-lines "$FLOOR" \
    && cargo llvm-cov report --summary-only > /opt/nook/coverage/nook-core/summary.txt \
    && cargo llvm-cov report --json --summary-only > /opt/nook/coverage/nook-core/summary.json \
    && cargo llvm-cov report --lcov --output-path /opt/nook/coverage/nook-core/lcov.info \
    && cp nook-core/coverage-floor.json /opt/nook/coverage/nook-core/coverage-floor.json
