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
COPY nook-wasm/src nook-wasm/src
COPY Cargo.lock* ./
RUN if [ ! -f Cargo.lock ]; then cargo generate-lockfile; fi
RUN cargo chef prepare --recipe-path recipe.json

FROM scratch AS recipe-output
COPY --from=chef-planner /workspace/recipe.json /recipe.json
COPY --from=chef-planner /workspace/Cargo.lock /Cargo.lock

# --- Builder base: Rust tooling without pre-compiled deps ---
FROM rust:${RUST_VERSION}-bookworm AS builder-base

RUN rustup component add rustfmt clippy

COPY --from=chef-planner /usr/local/cargo/bin/cargo-chef /usr/local/cargo/bin/cargo-chef

WORKDIR /workspace

# Registry cache-to exports image layers only — not BuildKit cache mounts.
ENV CARGO_INCREMENTAL=0
# crates.io HTTP/2 flakes in CI; disable multiplexing and retry downloads.
ENV CARGO_HTTP_MULTIPLEXING=false
ENV CARGO_NET_RETRY=10

# --- Builder debug: pre-compiled debug/all-target deps + workspace warm-up ---
FROM builder-base AS builder-debug

COPY recipe.json .
COPY --from=chef-planner /workspace/Cargo.lock ./Cargo.lock
RUN cargo chef cook --all-targets --recipe-path recipe.json

COPY Cargo.toml Cargo.toml
COPY nook-core/Cargo.toml nook-core/Cargo.toml
COPY nook-wasm/Cargo.toml nook-wasm/Cargo.toml
COPY nook-core/src nook-core/src
COPY nook-wasm/src nook-wasm/src
RUN cargo clippy -p nook-core --all-targets -- -D warnings \
    && cargo test -p nook-core --no-run \
    && cargo build -p nook-core

# --- Builder wasm: pre-compiled wasm32 release deps for nook-wasm ---
FROM builder-debug AS builder-wasm

RUN rustup target add wasm32-unknown-unknown

COPY recipe.json .
COPY --from=chef-planner /workspace/Cargo.lock ./Cargo.lock
RUN cargo chef cook --release --target wasm32-unknown-unknown --recipe-path recipe.json -p nook-wasm
RUN cargo clippy --release --target wasm32-unknown-unknown -p nook-wasm -- -D warnings \
    && cargo build --release --target wasm32-unknown-unknown -p nook-wasm

# --- Toolchain: final dev/CI image with Bun, Task, wasm-pack, and cached deps ---
FROM builder-wasm AS toolchain

COPY --from=chef-planner /workspace/Cargo.lock /opt/nook/Cargo.lock
COPY --from=builder-wasm /workspace/target /opt/nook/target

RUN printf '%s\n' \
    '#!/bin/sh' \
    'set -e' \
    'if [ ! -f /workspace/Cargo.lock ] && [ -f /opt/nook/Cargo.lock ]; then' \
    '  cp /opt/nook/Cargo.lock /workspace/Cargo.lock' \
    'fi' \
    'if [ ! -d /workspace/target/debug/deps ] || [ -z "$(ls -A /workspace/target/debug/deps 2>/dev/null)" ]; then' \
    '  if [ -d /opt/nook/target ]; then' \
    '    mkdir -p /workspace/target' \
    '    cp -a /opt/nook/target/. /workspace/target/' \
    '  fi' \
    'fi' \
    'if [ ! -d /workspace/nook-web/node_modules ] || [ -z "$(ls -A /workspace/nook-web/node_modules 2>/dev/null)" ]; then' \
    '  if [ -d /opt/nook/nook-web-node_modules ]; then' \
    '    mkdir -p /workspace/nook-web' \
    '    cp -a /opt/nook/nook-web-node_modules/. /workspace/nook-web/node_modules/' \
    '  fi' \
    'fi' \
    'if [ -f /workspace/nook-web/package.json ]; then' \
    '  (cd /workspace/nook-web && bun install --frozen-lockfile)' \
    'fi' \
    'exec "$@"' \
    > /usr/local/bin/nook-entrypoint.sh \
    && chmod +x /usr/local/bin/nook-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/nook-entrypoint.sh"]

ARG BUN_VERSION=1.3.14
ARG TASK_VERSION=3.42.1
ARG WASM_PACK_VERSION=0.15.0
ARG WASM_BINDGEN_VERSION=0.2.125
ARG BINARYEN_VERSION=122

ENV BUN_INSTALL=/usr/local/bun
ENV PATH="${BUN_INSTALL}/bin:${PATH}"

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
RUN cd nook-web && bun install --frozen-lockfile \
    && cp -a node_modules /opt/nook/nook-web-node_modules

ENV PLAYWRIGHT_BROWSERS_PATH=/opt/nook/ms-playwright
RUN mkdir -p "$PLAYWRIGHT_BROWSERS_PATH" \
    && cd nook-web \
    && bunx playwright install --with-deps chromium
