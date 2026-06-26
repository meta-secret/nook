# syntax=docker/dockerfile:1.4

# Multi-stage Dockerfile: cargo-chef dependency cache + Nook toolchain.
# See docker-bake.hcl for builder-*-cache targets and recipe regeneration.

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

# --- Builder debug: pre-compiled debug/test deps (pushed as builder-debug:cache in CI) ---
FROM builder-base AS builder-debug

COPY recipe.json .
COPY --from=chef-planner /workspace/Cargo.lock ./Cargo.lock
RUN cargo chef cook --tests --recipe-path recipe.json

# --- Builder wasm: pre-compiled wasm32 release deps for nook-wasm ---
FROM builder-debug AS builder-wasm

RUN rustup target add wasm32-unknown-unknown

COPY recipe.json .
COPY --from=chef-planner /workspace/Cargo.lock ./Cargo.lock
RUN cargo chef cook --release --target wasm32-unknown-unknown --recipe-path recipe.json -p nook-wasm

# --- Toolchain: final dev/CI image with Bun, Task, wasm-bindgen, and cached deps ---
FROM builder-wasm AS toolchain

COPY --from=chef-planner /workspace/Cargo.lock /opt/nook/Cargo.lock

RUN printf '%s\n' \
    '#!/bin/sh' \
    'set -e' \
    'if [ ! -f /workspace/Cargo.lock ] && [ -f /opt/nook/Cargo.lock ]; then' \
    '  cp /opt/nook/Cargo.lock /workspace/Cargo.lock' \
    'fi' \
    'exec "$@"' \
    > /usr/local/bin/nook-entrypoint.sh \
    && chmod +x /usr/local/bin/nook-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/nook-entrypoint.sh"]

ARG BUN_VERSION=1.3.14
ARG TASK_VERSION=3.42.1
ARG WASM_BINDGEN_VERSION=0.2.125
ARG BINARYEN_VERSION=122

ENV BUN_INSTALL=/usr/local/bun
ENV PATH="${BUN_INSTALL}/bin:${PATH}"

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash -s -- "bun-v${BUN_VERSION}"

RUN arch="$(dpkg --print-architecture)" \
    && curl -fsSL "https://github.com/go-task/task/releases/download/v${TASK_VERSION}/task_linux_${arch}.tar.gz" \
        | tar -xz -C /usr/local/bin task

RUN arch="$(dpkg --print-architecture)" \
    && case "${arch}" in \
        amd64) target="x86_64-unknown-linux-musl" ;; \
        arm64) target="aarch64-unknown-linux-musl" ;; \
        *) echo "Unsupported: ${arch}" >&2; exit 1 ;; \
    esac \
    && curl -fsSL "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/${WASM_BINDGEN_VERSION}/wasm-bindgen-${WASM_BINDGEN_VERSION}-${target}.tar.gz" \
        | tar -xz -C /usr/local/bin --strip-components=1 "wasm-bindgen-${WASM_BINDGEN_VERSION}-${target}/wasm-bindgen"

RUN arch="$(dpkg --print-architecture)" \
    && case "${arch}" in \
        amd64) target="x86_64-linux" ;; \
        arm64) target="aarch64-linux" ;; \
        *) echo "Unsupported: ${arch}" >&2; exit 1 ;; \
    esac \
    && curl -fsSL "https://github.com/WebAssembly/binaryen/releases/download/version_${BINARYEN_VERSION}/binaryen-version_${BINARYEN_VERSION}-${target}.tar.gz" \
        | tar -xz --strip-components=2 -C /usr/local/bin "binaryen-version_${BINARYEN_VERSION}/bin"
