# syntax=docker/dockerfile:1.4

# nook-base: shared toolchain layer for every sub-build (core, wasm, web).
# Only apt packages + pinned CLIs that change on version bumps — no repo sources.
# Consumed by the other package Dockerfiles via bake `contexts` (target:nook-base).

ARG RUST_VERSION=1.96
ARG DEBIAN_RELEASE=trixie
ARG BUN_VERSION=1.3.14
ARG TASK_VERSION=3.42.1
ARG WASM_PACK_VERSION=0.15.0
ARG LLVM_COV_VERSION=0.8.7
# Binaryen (wasm-opt): pinned to a modern release so wasm-pack uses a correct, local wasm-opt.
# Debian's binaryen is too old (corrupts externref tables -> table.grow crash); baking it here also
# avoids wasm-pack downloading it from GitHub at build time (flaky, rate-limited).
ARG BINARYEN_VERSION=122
ARG NODE_IMAGE=node:24-${DEBIAN_RELEASE}-slim

FROM lukemathwalker/cargo-chef:latest-rust-${RUST_VERSION}-${DEBIAN_RELEASE} AS cargo-chef

# Bun: package install, Vite, app scripts. Node: Playwright test-runner workers only (fork/IPC).
FROM ${NODE_IMAGE} AS playwright-node

# --- Super-base: every apt package + CLI that only changes on version bumps (no repo sources) ---
FROM rust:${RUST_VERSION}-${DEBIAN_RELEASE} AS nook-base

ARG BUN_VERSION
ARG TASK_VERSION
ARG WASM_PACK_VERSION
ARG LLVM_COV_VERSION
ARG BINARYEN_VERSION

ENV BUN_INSTALL=/usr/local/bun
ENV BUN_INSTALL_CACHE_DIR=/opt/nook/bun-install-cache
ENV PATH="${BUN_INSTALL}/bin:${PATH}"
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/nook/ms-playwright
# Cargo uses the default <workspace>/target (i.e. /meta-secret/nook/target). Source is COPY'd
# into the image at build time (no runtime bind mount), so nothing shadows it and the
# chef-cooked/warm target from the builder stages is reused by the nook-web image.
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

RUN rustup component add rustfmt clippy llvm-tools-preview \
    && rustup target add wasm32-unknown-unknown

RUN curl -fsSL "https://github.com/taiki-e/cargo-llvm-cov/releases/download/v${LLVM_COV_VERSION}/cargo-llvm-cov-x86_64-unknown-linux-gnu.tar.gz" \
    | tar xz -C /usr/local/cargo/bin

RUN curl -fsSL https://wasm-bindgen.github.io/wasm-pack/installer/init.sh | VERSION="${WASM_PACK_VERSION}" sh

# Binaryen's wasm-opt (installed to /usr/local/bin so wasm-pack finds it on PATH — no build-time download).
RUN curl -fsSL "https://github.com/WebAssembly/binaryen/releases/download/version_${BINARYEN_VERSION}/binaryen-version_${BINARYEN_VERSION}-x86_64-linux.tar.gz" \
    | tar xz -C /tmp \
    && cp -a "/tmp/binaryen-version_${BINARYEN_VERSION}/bin/." /usr/local/bin/ \
    && cp -a "/tmp/binaryen-version_${BINARYEN_VERSION}/lib/." /usr/local/lib/ 2>/dev/null || true \
    && rm -rf "/tmp/binaryen-version_${BINARYEN_VERSION}" \
    && wasm-opt --version

RUN curl -LsSf https://get.nexte.st/latest/linux | tar zxf - -C /usr/local/bin

COPY --from=cargo-chef /usr/local/cargo/bin/cargo-chef /usr/local/cargo/bin/cargo-chef

WORKDIR /meta-secret/nook
