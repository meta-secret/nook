# syntax=docker/dockerfile:1.4

# Separate Rust/WASM and web bases. They build in parallel and share only the pinned Node binary;
# the final web image must not inherit Cargo target/ or the Rust toolchain.

# Global ARGs used ONLY by the FROM lines below. A pre-FROM ARG is not visible inside any stage's
# RUN/ENV — to use one there you must re-declare it in that stage. Only args that parameterize a
# base image live here; CLI-version args are declared in the stage that consumes them.
ARG RUST_VERSION=1.96
ARG DEBIAN_RELEASE=trixie
ARG NODE_IMAGE=node:24-${DEBIAN_RELEASE}-slim

FROM lukemathwalker/cargo-chef:latest-rust-${RUST_VERSION}-${DEBIAN_RELEASE} AS cargo-chef

# Node is copied into the Rust base for wasm-bindgen Node tests and into the web base for Playwright
# workers. Using the standalone binary keeps npm/npx out of the sealed images.
FROM ${NODE_IMAGE} AS playwright-node

# --- Rust/WASM branch -------------------------------------------------------
FROM rust:${RUST_VERSION}-${DEBIAN_RELEASE} AS rust-base

# Pinned CLI versions, declared once here because they are used only inside this stage's RUNs
# (a pre-FROM ARG would not be visible in RUN). Override with --build-arg / bake args.
ARG TASK_VERSION=3.42.1
ARG WASM_PACK_VERSION=0.15.0
ARG LLVM_COV_VERSION=0.8.7
# Binaryen (wasm-opt): pinned to a modern release so wasm-pack uses a correct, local wasm-opt.
# Debian's binaryen is too old (corrupts externref tables -> table.grow crash); baking it here also
# avoids wasm-pack downloading it from GitHub at build time (flaky, rate-limited).
ARG BINARYEN_VERSION=122

# Cargo uses the default <workspace>/target (i.e. /meta-secret/nook/nook-app/target). The heavy
# target directory remains in the Rust lineage and in BuildKit/GHCR cache, but is not inherited by
# the slim web image.
ENV CARGO_INCREMENTAL=0
ENV CARGO_NET_RETRY=10

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        jq \
        mold \
    && rm -rf /var/lib/apt/lists/*

# Standalone CLIs first (version bumps only). cargo-chef last — only needed for Rust cache stages.
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

# --- Web/e2e branch ---------------------------------------------------------
FROM debian:${DEBIAN_RELEASE}-slim AS web-base

ARG BUN_VERSION=1.3.14
ARG TASK_VERSION=3.42.1

ENV BUN_INSTALL=/usr/local/bun
ENV PATH="${BUN_INSTALL}/bin:${PATH}"
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/nook/ms-playwright

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        jq \
        unzip \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash -s -- "bun-v${BUN_VERSION}"
COPY --from=playwright-node /usr/local/bin/node /usr/local/bin/node
RUN sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -b /usr/local/bin "v${TASK_VERSION}"

WORKDIR /meta-secret/nook

# Browser binaries are deliberately outside web-base. PR checks use web-base for unit tests and
# preview builds. Main/nightly e2e uses Debian's single Chromium package instead of Playwright's
# bundled Chromium + headless-shell download, which otherwise produces a ~1.3 GB image layer.
FROM web-base AS web-e2e-base

ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium xvfb \
    && rm -rf /var/lib/apt/lists/*
