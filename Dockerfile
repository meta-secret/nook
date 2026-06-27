# syntax=docker/dockerfile:1.4

# Multi-stage Dockerfile: cargo-chef dependency cache + Nook toolchain.
# See docker-bake.hcl — always linux/amd64; pull ghcr.io/.../toolchain:latest before build.

ARG RUST_VERSION=1.96

# --- Chef planner: generate cargo-chef recipe (used by generate-recipe bake target) ---
FROM lukemathwalker/cargo-chef:latest-rust-${RUST_VERSION}-bookworm AS chef-planner

WORKDIR /workspace
COPY Cargo.toml Cargo.toml
COPY nook-core/Cargo.toml nook-core/Cargo.toml
COPY nook-wasm/Cargo.toml nook-wasm/Cargo.toml
COPY nook-core/src nook-core/src
COPY nook-core/locales nook-core/locales
COPY nook-core/tests nook-core/tests
COPY nook-core/fixtures nook-core/fixtures
COPY nook-core/examples nook-core/examples
COPY nook-wasm/src nook-wasm/src
COPY Cargo.lock* ./
RUN if [ ! -f Cargo.lock ]; then cargo generate-lockfile; fi
RUN cargo chef prepare --recipe-path recipe.json

FROM scratch AS recipe-output
COPY --from=chef-planner /workspace/recipe.json /recipe.json
COPY --from=chef-planner /workspace/Cargo.lock /Cargo.lock

# --- Builder base: Rust tooling without pre-compiled deps ---
FROM rust:${RUST_VERSION}-bookworm AS builder-base

RUN apt-get update \
    && apt-get install -y --no-install-recommends mold \
    && rm -rf /var/lib/apt/lists/*

RUN rustup component add rustfmt clippy

COPY --from=chef-planner /usr/local/cargo/bin/cargo-chef /usr/local/cargo/bin/cargo-chef

WORKDIR /workspace

# Outside /workspace so the repo bind mount never hides compiled artifacts.
# Set before any cargo/chef invocation so fingerprints stay on this path.
ENV CARGO_TARGET_DIR=/opt/nook/target

# Registry cache-to exports image layers only — not BuildKit cache mounts.
ENV CARGO_INCREMENTAL=0
# crates.io HTTP/2 flakes in CI; disable multiplexing and retry downloads.
ENV CARGO_HTTP_MULTIPLEXING=false
ENV CARGO_NET_RETRY=10

# --- Builder debug: pre-compiled debug/all-target deps + workspace warm-up ---
FROM builder-base AS builder-debug

COPY recipe.json .
COPY --from=chef-planner /workspace/Cargo.lock ./Cargo.lock
# build + clippy cooks: clippy uses a different driver; without --clippy deps recompile on every source change.
RUN cargo chef cook --all-targets --recipe-path recipe.json \
    && cargo chef cook --clippy --all-targets --recipe-path recipe.json

COPY Cargo.toml Cargo.toml
COPY nook-core/Cargo.toml nook-core/Cargo.toml
COPY nook-wasm/Cargo.toml nook-wasm/Cargo.toml
COPY nook-core/src nook-core/src
COPY nook-core/locales nook-core/locales
COPY nook-core/tests nook-core/tests
COPY nook-core/fixtures nook-core/fixtures
COPY nook-core/examples nook-core/examples
COPY nook-wasm/src nook-wasm/src
RUN cargo clippy -p nook-core --all-targets -- -D warnings \
    && cargo test -p nook-core --no-run \
    && cargo build -p nook-core

# --- Builder wasm: pre-compiled wasm32 release deps for nook-wasm ---
FROM builder-debug AS builder-wasm

RUN rustup target add wasm32-unknown-unknown

COPY recipe.json .
COPY --from=chef-planner /workspace/Cargo.lock ./Cargo.lock
RUN cargo chef cook --release --target wasm32-unknown-unknown --recipe-path recipe.json \
    && cargo chef cook --release --clippy --target wasm32-unknown-unknown --recipe-path recipe.json
RUN cargo clippy --release --target wasm32-unknown-unknown -p nook-wasm -- -D warnings \
    && cargo build --release --target wasm32-unknown-unknown -p nook-wasm

# --- Toolchain: final dev/CI image with Bun, Task, wasm-pack, and cached deps ---
FROM builder-wasm AS toolchain

COPY --from=chef-planner /workspace/Cargo.lock /opt/nook/Cargo.lock

ARG BUN_VERSION=1.3.14
ARG TASK_VERSION=3.42.1
ARG WASM_PACK_VERSION=0.15.0
ARG WASM_BINDGEN_VERSION=0.2.125
ARG BINARYEN_VERSION=122

ENV BUN_INSTALL=/usr/local/bun
ENV BUN_INSTALL_CACHE_DIR=/opt/nook/bun-install-cache
ENV PATH="${BUN_INSTALL}/bin:${PATH}"
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/nook/ms-playwright
ENV CARGO_TARGET_DIR=/opt/nook/target

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash -s -- "bun-v${BUN_VERSION}"

# Toolchain is always linux/amd64 (Mac dev runs the image via --platform linux/amd64).
RUN curl -fsSL "https://github.com/go-task/task/releases/download/v${TASK_VERSION}/task_linux_amd64.tar.gz" \
        | tar -xz -C /usr/local/bin task \
    && curl -fsSL "https://github.com/rustwasm/wasm-pack/releases/download/v${WASM_PACK_VERSION}/wasm-pack-v${WASM_PACK_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
        | tar -xz --strip-components=1 -C /usr/local/bin "wasm-pack-v${WASM_PACK_VERSION}-x86_64-unknown-linux-musl/wasm-pack" \
    && curl -fsSL "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/${WASM_BINDGEN_VERSION}/wasm-bindgen-${WASM_BINDGEN_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
        | tar -xz -C /usr/local/bin --strip-components=1 "wasm-bindgen-${WASM_BINDGEN_VERSION}-x86_64-unknown-linux-musl/wasm-bindgen" \
    && curl -fsSL "https://github.com/WebAssembly/binaryen/releases/download/version_${BINARYEN_VERSION}/binaryen-version_${BINARYEN_VERSION}-x86_64-linux.tar.gz" \
        | tar -xz --strip-components=2 -C /usr/local/bin "binaryen-version_${BINARYEN_VERSION}/bin"

COPY nook-web/package.json nook-web/bun.lock ./nook-web/
RUN mkdir -p "$BUN_INSTALL_CACHE_DIR" \
    && cd nook-web && bun install --frozen-lockfile

RUN mkdir -p "$PLAYWRIGHT_BROWSERS_PATH" \
    && cd nook-web \
    && bunx playwright install --with-deps chromium

# Baked wasm pkg for entrypoint seeding (cached until wasm/core sources change).
WORKDIR /workspace
COPY recipe.json Cargo.toml ./
COPY --from=chef-planner /workspace/Cargo.lock ./Cargo.lock
COPY nook-core/Cargo.toml nook-core/Cargo.toml
COPY nook-wasm/Cargo.toml nook-wasm/Cargo.toml
COPY nook-core/src nook-core/src
COPY nook-core/locales nook-core/locales
COPY nook-wasm/src nook-wasm/src
RUN wasm-pack build nook-wasm --target web --out-dir /opt/nook/nook-wasm-pkg --out-name nook_wasm

# Entrypoint last so script edits do not invalidate Playwright, bun, or wasm layers.
COPY docker-entrypoint.sh /usr/local/bin/nook-entrypoint.sh
RUN chmod +x /usr/local/bin/nook-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/nook-entrypoint.sh"]
