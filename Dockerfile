# syntax=docker/dockerfile:1.4

# Multi-stage Dockerfile: infra base → web deps / shared rust deps → parallel native+wasm builders → toolchain.
# BuildKit runs builder-debug and builder-wasm in parallel after builder-deps. See docker-bake.hcl.

ARG RUST_VERSION=1.96
ARG BUN_VERSION=1.3.14
ARG TASK_VERSION=3.42.1
ARG WASM_PACK_VERSION=0.15.0
ARG NODE_IMAGE=node:22-bookworm-slim

FROM lukemathwalker/cargo-chef:latest-rust-${RUST_VERSION}-bookworm AS cargo-chef

# Playwright worker processes fork a real Node runtime (Bun cannot substitute). Bun handles all installs and app scripts.
FROM ${NODE_IMAGE} AS playwright-node

# --- Super-base: every apt package + CLI that only changes on version bumps (no repo sources) ---
FROM rust:${RUST_VERSION}-bookworm AS nook-base

ARG BUN_VERSION
ARG TASK_VERSION
ARG WASM_PACK_VERSION

ENV BUN_INSTALL=/usr/local/bun
ENV BUN_INSTALL_CACHE_DIR=/opt/nook/bun-install-cache
ENV PATH="${BUN_INSTALL}/bin:${PATH}"
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/nook/ms-playwright
ENV CARGO_TARGET_DIR=/opt/nook/target
ENV CARGO_INCREMENTAL=0
ENV CARGO_NET_RETRY=10

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        mold \
    && rm -rf /var/lib/apt/lists/*

# Standalone CLIs first (version bumps only). cargo-chef last — only needed for Rust cache stages.
RUN curl -fsSL https://bun.sh/install | bash -s -- "bun-v${BUN_VERSION}"
COPY --from=playwright-node /usr/local/bin/node /usr/local/bin/node
RUN sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -b /usr/local/bin "v${TASK_VERSION}"

RUN rustup component add rustfmt clippy \
    && rustup target add wasm32-unknown-unknown

RUN curl -fsSL https://wasm-bindgen.github.io/wasm-pack/installer/init.sh | VERSION="${WASM_PACK_VERSION}" sh

RUN curl -LsSf https://get.nexte.st/latest/linux | tar zxf - -C /usr/local/bin

COPY --from=cargo-chef /usr/local/cargo/bin/cargo-chef /usr/local/cargo/bin/cargo-chef

WORKDIR /workspace

# --- Web deps: bun install + browser binary (parallel with rust builders via toolchain-web fork) ---
FROM nook-base AS toolchain-web

COPY nook-web/package.json nook-web/bun.lock ./nook-web/
RUN mkdir -p "$BUN_INSTALL_CACHE_DIR" \
    && cd nook-web && bun install --frozen-lockfile
RUN mkdir -p "$PLAYWRIGHT_BROWSERS_PATH" \
    && cd nook-web && bunx playwright install --with-deps chromium

# --- Chef planner: recipe.json generated here during docker build (not committed) ---
FROM nook-base AS chef-planner

COPY Cargo.toml Cargo.lock ./
COPY nook-core nook-core
COPY nook-wasm nook-wasm
RUN cargo chef prepare --recipe-path recipe.json

# --- Shared rust dependency cache (chef cook + fetch once) ---
FROM nook-base AS builder-deps

COPY .cargo .cargo
COPY --from=chef-planner /workspace/recipe.json ./recipe.json
COPY Cargo.toml Cargo.lock ./
COPY nook-core/Cargo.toml nook-core/Cargo.toml
COPY nook-wasm/Cargo.toml nook-wasm/Cargo.toml
RUN cargo chef cook --all-targets --recipe-path recipe.json \
    && cargo chef cook --clippy --all-targets --recipe-path recipe.json \
    && cargo chef cook --release --target wasm32-unknown-unknown --recipe-path recipe.json \
    && cargo chef cook --release --clippy --target wasm32-unknown-unknown --recipe-path recipe.json \
    && cargo fetch --locked

# --- Native verify warm-up (parallel with builder-wasm after builder-deps) ---
FROM builder-deps AS builder-debug

COPY Cargo.toml Cargo.lock ./
COPY nook-core nook-core
COPY nook-wasm nook-wasm
COPY .config .config
RUN cargo clippy -p nook-core --all-targets -- -D warnings \
    && cargo nextest run --no-run -p nook-core --profile ci \
    && cargo build -p nook-core

# --- Wasm release build + pkg (parallel with builder-debug after builder-deps) ---
FROM builder-deps AS builder-wasm

COPY Cargo.toml Cargo.lock ./
COPY nook-core nook-core
COPY nook-wasm nook-wasm
RUN cargo clippy --release --target wasm32-unknown-unknown -p nook-wasm -- -D warnings \
    && cargo build --release --target wasm32-unknown-unknown -p nook-wasm \
    && wasm-pack build nook-wasm --target web --out-dir /opt/nook/nook-wasm-pkg --out-name nook_wasm

# --- Final dev/CI image: assemble artifacts from parallel builders ---
FROM toolchain-web AS toolchain

COPY --from=builder-deps /usr/local/cargo/registry /usr/local/cargo/registry
COPY --from=builder-debug /opt/nook/target /opt/nook/target
COPY --from=builder-wasm /opt/nook/target/wasm32-unknown-unknown /opt/nook/target/wasm32-unknown-unknown
COPY --from=builder-wasm /opt/nook/nook-wasm-pkg /opt/nook/nook-wasm-pkg

COPY Cargo.lock /opt/nook/Cargo.lock

COPY docker-entrypoint.sh /usr/local/bin/nook-entrypoint.sh
RUN chmod +x /usr/local/bin/nook-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/nook-entrypoint.sh"]
