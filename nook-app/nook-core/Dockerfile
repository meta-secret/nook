# syntax=docker/dockerfile:1.4

# nook-core build stages: chef recipe -> shared rust dependency cache -> native verify warm-up.
# Build context is the repo root; the Rust workspace root lives at nook-app. `rust-base` is injected by bake
# via `contexts = { rust-base = "target:rust-base" }`. `builder-deps` here is also the shared
# base for the wasm build (nook-app/nook-wasm/Dockerfile consumes it the same way).

# --- Chef planner: recipe.json generated here during docker build (not committed) ---
FROM rust-base AS chef-planner

WORKDIR /meta-secret/nook/nook-app

COPY nook-app/Cargo.toml nook-app/Cargo.lock ./
COPY nook-app/nook-auth2/Cargo.toml nook-auth2/Cargo.toml
COPY nook-app/nook-core/Cargo.toml nook-core/Cargo.toml
COPY nook-app/nook-wasm/Cargo.toml nook-wasm/Cargo.toml
RUN mkdir -p nook-auth2/src nook-core/src nook-wasm/src \
    && touch nook-auth2/src/lib.rs nook-core/src/lib.rs nook-wasm/src/lib.rs
RUN cargo chef prepare --recipe-path recipe.json

# --- Shared rust dependency cache (chef cook + fetch once) ---
FROM rust-base AS builder-deps

WORKDIR /meta-secret/nook/nook-app

COPY nook-app/.cargo .cargo
COPY nook-app/.config .config
COPY --from=chef-planner /meta-secret/nook/nook-app/recipe.json ./recipe.json
COPY nook-app/Cargo.toml nook-app/Cargo.lock ./
COPY nook-app/nook-auth2/Cargo.toml nook-auth2/Cargo.toml
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
# compile the deps, and keep the stubs for unselected workspace packages. Real crate source is
# copied over the stubs in builder-debug in dependency order (nook-auth2 -> nook-core -> nook-wasm).
# Kept as separate cache layers.
RUN mkdir -p nook-auth2/src nook-core/src nook-wasm/src
RUN echo '' > nook-auth2/src/lib.rs
RUN echo '' > nook-core/src/lib.rs
RUN echo '' > nook-wasm/src/lib.rs
RUN cargo nextest run --no-run -p nook-auth2 --profile ci
RUN cargo nextest run --no-run -p nook-core --profile ci
RUN cargo clippy -p nook-auth2 --all-targets -- -D warnings
RUN cargo clippy -p nook-core --all-targets -- -D warnings
# Also warm the COVERAGE-instrumented deps: cargo-llvm-cov builds with -Cinstrument-coverage +
# cfg(coverage) into its own target/llvm-cov-target dir — a distinct fingerprint AND location from
# the plain nextest/clippy builds above. Without this, builder-debug's `cargo llvm-cov nextest`
# recompiles every dependency with instrumentation. --no-report skips report merge; --no-tests=pass
# tolerates the stub crate having zero tests (nextest exits 4 otherwise). This warms the instrumented
# deps so builder-debug's real coverage step is a cache hit.
RUN cargo llvm-cov nextest --no-report --profile ci -p nook-auth2 --no-tests=pass
RUN cargo llvm-cov nextest --no-report --profile ci -p nook-core --no-tests=pass
# Warm the wasm32 DEBUG/TEST-profile dependencies used by `wasm-pack test --node` in CI. The
# release-profile chef layers above cannot satisfy this separate target/wasm32-unknown-unknown/debug
# artifact set. Keeping the warm-up here, before real sources are copied, makes it manifest-keyed;
# source-only changes then rebuild the workspace crates but not the full wasm test dependency graph.
# This is last so adding/changing the WASM test warm-up does not invalidate the native warm-up layers.
RUN cargo test --target wasm32-unknown-unknown --no-run -p nook-wasm

# --- Native verify warm-up (parallel with builder-wasm after builder-deps) ---
FROM builder-deps AS builder-debug

WORKDIR /meta-secret/nook/nook-app

COPY nook-app/Cargo.toml nook-app/Cargo.lock ./
COPY nook-app/.config .config

# Source-sensitive verification layers are ordered by Rust dependency edge. A nook-core-only change
# can reuse the nook-auth2 clippy and coverage-test layers; a nook-wasm-only change can reuse both.
COPY nook-app/nook-auth2 nook-auth2
RUN cargo clippy -p nook-auth2 --all-targets -- -D warnings
RUN cargo llvm-cov nextest --profile ci -p nook-auth2 --no-report

COPY nook-app/nook-core nook-core
# Docker COPY preserves source mtimes, while the inherited target directory can
# contain newer artifacts. Touch the module that embeds locale JSON so changes
# to those non-Rust inputs always reach both the native and downstream WASM
# builds instead of reusing a stale include_str! result.
RUN touch nook-core/src/i18n.rs \
    && cargo clippy -p nook-core --all-targets -- -D warnings
# Coverage runs HERE, in the image build (not at task runtime): cargo-llvm-cov first runs nook-auth2
# above, then runs nook-core with --no-clean so the final report combines both crates while preserving
# cacheable auth coverage. The same run also bakes the coverage artifacts that PR CI copies out later;
# export must not rerun the Rust tests.
RUN FLOOR="$(jq -r '.lines_percent' nook-core/coverage-floor.json)" \
    && mkdir -p /opt/nook/coverage/nook-core \
    && cargo llvm-cov nextest --no-clean --profile ci -p nook-core --summary-only > /tmp/nook-core-coverage-summary.txt \
    && cargo llvm-cov report -p nook-core -p nook-auth2 --summary-only --fail-under-lines "$FLOOR" > /opt/nook/coverage/nook-core/summary.txt \
    && cargo llvm-cov report -p nook-core -p nook-auth2 --json --summary-only > /opt/nook/coverage/nook-core/summary.json \
    && cargo llvm-cov report -p nook-core -p nook-auth2 --lcov --output-path /opt/nook/coverage/nook-core/lcov.info \
    && cp nook-core/coverage-floor.json /opt/nook/coverage/nook-core/coverage-floor.json

COPY nook-app/nook-wasm nook-wasm

# Export only the small, already-computed coverage payload. This target deliberately branches
# before the WASM/web production stages so a PR fallback never materializes the multi-GB app image.
FROM scratch AS coverage-export

COPY --from=builder-debug /opt/nook/coverage/nook-core/ /
