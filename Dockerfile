# syntax=docker/dockerfile:1.4

# Multi-stage Dockerfile: stable infra base → web deps / chef / rust cache → final toolchain.
# See docker-bake.hcl — always linux/amd64; pull ghcr.io/.../toolchain:latest before build.

ARG RUST_VERSION=1.96
ARG BUN_VERSION=1.3.14
ARG TASK_VERSION=3.42.1
ARG WASM_PACK_VERSION=0.15.0
ARG WASM_BINDGEN_VERSION=0.2.125
ARG BINARYEN_VERSION=122

FROM lukemathwalker/cargo-chef:latest-rust-${RUST_VERSION}-bookworm AS cargo-chef

# --- Super-base: every apt package + CLI that only changes on version bumps (no repo sources) ---
FROM rust:${RUST_VERSION}-bookworm AS nook-base

ARG BUN_VERSION
ARG TASK_VERSION
ARG WASM_PACK_VERSION
ARG WASM_BINDGEN_VERSION
ARG BINARYEN_VERSION

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
RUN sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -b /usr/local/bin "v${TASK_VERSION}"

RUN rustup component add rustfmt clippy \
    && rustup target add wasm32-unknown-unknown

RUN curl -fsSL https://wasm-bindgen.github.io/wasm-pack/installer/init.sh | VERSION="${WASM_PACK_VERSION}" sh
RUN curl -fsSL "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/${WASM_BINDGEN_VERSION}/wasm-bindgen-${WASM_BINDGEN_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
        | tar -xz -C /usr/local/bin --strip-components=1 "wasm-bindgen-${WASM_BINDGEN_VERSION}-x86_64-unknown-linux-musl/wasm-bindgen"
RUN curl -fsSL "https://github.com/WebAssembly/binaryen/releases/download/version_${BINARYEN_VERSION}/binaryen-version_${BINARYEN_VERSION}-x86_64-linux.tar.gz" \
        | tar -xz --strip-components=2 -C /usr/local/bin "binaryen-version_${BINARYEN_VERSION}/bin"

COPY --from=cargo-chef /usr/local/cargo/bin/cargo-chef /usr/local/cargo/bin/cargo-chef

WORKDIR /workspace

# --- Web deps: bun install + browser binary (OS deps already in nook-base) ---
FROM nook-base AS toolchain-web

COPY nook-web/package.json nook-web/bun.lock ./nook-web/
RUN mkdir -p "$BUN_INSTALL_CACHE_DIR" \
    && cd nook-web && bun install --frozen-lockfile
RUN mkdir -p "$PLAYWRIGHT_BROWSERS_PATH" \
    && cd nook-web && bunx playwright install --with-deps chromium

# --- Chef planner: recipe.json generated here (not committed; see docker:generate-recipe) ---
FROM nook-base AS chef-planner

COPY Cargo.toml Cargo.lock ./
COPY nook-core/Cargo.toml nook-core/Cargo.toml
COPY nook-wasm/Cargo.toml nook-wasm/Cargo.toml
COPY nook-core/src nook-core/src
COPY nook-core/locales nook-core/locales
COPY nook-core/tests nook-core/tests
COPY nook-core/fixtures nook-core/fixtures
COPY nook-core/examples nook-core/examples
COPY nook-wasm/src nook-wasm/src
RUN cargo chef prepare --recipe-path recipe.json

FROM scratch AS recipe-output
COPY --from=chef-planner /workspace/recipe.json /recipe.json
COPY --from=chef-planner /workspace/Cargo.lock /Cargo.lock

# --- Rust deps + PR warm-up (clippy, test --no-run, build) ---
FROM nook-base AS builder-debug

COPY --from=chef-planner /workspace/recipe.json ./recipe.json
COPY Cargo.toml Cargo.lock ./
COPY nook-core/Cargo.toml nook-core/Cargo.toml
COPY nook-wasm/Cargo.toml nook-wasm/Cargo.toml
RUN cargo chef cook --all-targets --recipe-path recipe.json \
    && cargo chef cook --clippy --all-targets --recipe-path recipe.json

COPY nook-core/src nook-core/src
COPY nook-core/locales nook-core/locales
COPY nook-core/tests nook-core/tests
COPY nook-core/fixtures nook-core/fixtures
COPY nook-core/examples nook-core/examples
COPY nook-wasm/src nook-wasm/src
RUN cargo clippy -p nook-core --all-targets -- -D warnings \
    && cargo test -p nook-core --no-run \
    && cargo build -p nook-core

FROM builder-debug AS builder-wasm

RUN cargo chef cook --release --target wasm32-unknown-unknown --recipe-path recipe.json \
    && cargo chef cook --release --clippy --target wasm32-unknown-unknown --recipe-path recipe.json
RUN cargo clippy --release --target wasm32-unknown-unknown -p nook-wasm -- -D warnings \
    && cargo build --release --target wasm32-unknown-unknown -p nook-wasm

# --- Final dev/CI image ---
FROM toolchain-web AS toolchain

COPY --from=builder-wasm /opt/nook/target /opt/nook/target
COPY Cargo.lock /opt/nook/Cargo.lock

COPY Cargo.toml ./
COPY nook-core/Cargo.toml nook-core/Cargo.toml
COPY nook-wasm/Cargo.toml nook-wasm/Cargo.toml
COPY nook-core/src nook-core/src
COPY nook-core/locales nook-core/locales
COPY nook-wasm/src nook-wasm/src
RUN wasm-pack build nook-wasm --target web --out-dir /opt/nook/nook-wasm-pkg --out-name nook_wasm

COPY docker-entrypoint.sh /usr/local/bin/nook-entrypoint.sh
RUN chmod +x /usr/local/bin/nook-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/nook-entrypoint.sh"]
