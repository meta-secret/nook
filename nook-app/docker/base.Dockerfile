# syntax=docker/dockerfile:1.4

# Separate Rust/WASM and web bases. They build in parallel and share only the pinned Node binary;
# the final web image must not inherit Cargo target/ or the Rust toolchain.

# Global ARGs used ONLY by the FROM lines below. A pre-FROM ARG is not visible inside any stage's
# RUN/ENV — to use one there you must re-declare it in that stage. Only args that parameterize a
# base image live here; CLI-version args are declared in the stage that consumes them.
ARG RUST_VERSION=1.96
ARG DEBIAN_RELEASE=trixie
# Pin floating registry tags by digest. `cargo-chef:latest-rust-*` and unpinned
# `rust`/`node` tags move under us and rewrite the rust-base digest, which orphans
# every downstream cargo-chef cook layer in the hosted GHA cache and forces PRs to
# redownload crates on an otherwise unchanged Cargo.lock.
ARG CARGO_CHEF_IMAGE=lukemathwalker/cargo-chef:latest-rust-1.96-trixie@sha256:3a1dd6010466c1cf591607a75c6e144ba9f099e7f3790d595c6a611a9c78f387
ARG RUST_IMAGE=rust:1.96-trixie@sha256:1f0dbad1df66647807e6952d1db85d0b2bda7606cb2139d82517e4f009967376
ARG NODE_IMAGE=node:24-trixie-slim@sha256:ae91dcc111a68c9d2d81ff2a17bda61be126426176fde6fe7d08ab13b7f50573

FROM ${CARGO_CHEF_IMAGE} AS cargo-chef

# Node is copied into the Rust base for wasm-bindgen Node tests and into the web base for Playwright
# workers. Using the standalone binary keeps npm/npx out of the sealed images.
FROM ${NODE_IMAGE} AS playwright-node

# --- Rust/WASM branch -------------------------------------------------------
FROM ${RUST_IMAGE} AS rust-base

# Pinned CLI versions, declared once here because they are used only inside this stage's RUNs
# (a pre-FROM ARG would not be visible in RUN). Override with --build-arg / bake args.
ARG TASK_VERSION=3.42.1
ARG WASM_PACK_VERSION=0.15.0
ARG LLVM_COV_VERSION=0.8.7
ARG SCCACHE_VERSION=0.16.0
ARG SCCACHE_SHA256=aec995a83ad3dff3d14b6314e08858b7b73d35ca85a5bcf3d3a9ec07dee35588
ARG SCCACHE_S3_MODE=external
ARG SCCACHE_ENDPOINT=https://sccache.dev.nokey.sh
ARG SCCACHE_BUCKET=nook-sccache
# Binaryen (wasm-opt): pinned to a modern release so wasm-pack uses a correct, local wasm-opt.
# Debian's binaryen is too old (corrupts externref tables -> table.grow crash); baking it here also
# avoids wasm-pack downloading it from GitHub at build time (flaky, rate-limited).
ARG BINARYEN_VERSION=122

# Cargo uses the default <workspace>/target (i.e. /meta-secret/nook/nook-app/target). The heavy
# target directory remains in the Rust lineage and local BuildKit cache, but is not inherited by
# the slim web image.
ENV CARGO_INCREMENTAL=0
ENV CARGO_NET_RETRY=10
ENV RUSTC_WRAPPER=/usr/local/bin/nook-sccache
ENV NOOK_SCCACHE_S3_MODE=${SCCACHE_S3_MODE}
ENV SCCACHE_ENDPOINT=${SCCACHE_ENDPOINT}
ENV SCCACHE_BUCKET=${SCCACHE_BUCKET}
ENV SCCACHE_REGION=auto
ENV SCCACHE_S3_USE_SSL=true
ENV SCCACHE_IGNORE_SERVER_IO_ERROR=1
# Every BuildKit RUN gets its own filesystem namespace. A Unix socket therefore keeps the
# short-lived local sccache daemons isolated even while their S3 storage is shared.
ENV SCCACHE_SERVER_UDS=/tmp/nook-sccache.sock

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

RUN curl -fsSL \
      "https://github.com/mozilla/sccache/releases/download/v${SCCACHE_VERSION}/sccache-v${SCCACHE_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
      -o /tmp/sccache.tar.gz \
    && echo "${SCCACHE_SHA256}  /tmp/sccache.tar.gz" | sha256sum -c - \
    && tar xzf /tmp/sccache.tar.gz -C /tmp \
    && install -m 0755 \
      "/tmp/sccache-v${SCCACHE_VERSION}-x86_64-unknown-linux-musl/sccache" \
      /usr/local/bin/sccache \
    && rm -rf /tmp/sccache.tar.gz \
      "/tmp/sccache-v${SCCACHE_VERSION}-x86_64-unknown-linux-musl" \
    && sccache --version

COPY nook-app/docker/sccache-wrapper.sh /usr/local/bin/nook-sccache
COPY nook-app/docker/sccache-report.sh /usr/local/bin/nook-sccache-report
RUN chmod 0755 /usr/local/bin/nook-sccache /usr/local/bin/nook-sccache-report

COPY --from=cargo-chef /usr/local/cargo/bin/cargo-chef /usr/local/cargo/bin/cargo-chef

WORKDIR /meta-secret/nook

# Keep manifest-only dependency stages in the same Dockerfile as rust-base. Their cache keys then
# depend on a stable internal stage instead of a named-target image result whose exported identity
# can change when a sibling hosted cache scope is republished.
FROM rust-base AS chef-planner

WORKDIR /meta-secret/nook/nook-app

COPY nook-app/Cargo.toml nook-app/Cargo.lock ./
COPY nook-app/nook-auth2/Cargo.toml nook-auth2/Cargo.toml
COPY nook-app/nook-replication/Cargo.toml nook-replication/Cargo.toml
COPY nook-app/nook-event-log/Cargo.toml nook-event-log/Cargo.toml
COPY nook-app/nook-core/Cargo.toml nook-core/Cargo.toml
COPY nook-app/nook-wasm/Cargo.toml nook-wasm/Cargo.toml
RUN mkdir -p nook-auth2/src nook-replication/src nook-event-log/src nook-core/src nook-wasm/src \
    && touch nook-auth2/src/lib.rs nook-replication/src/lib.rs nook-event-log/src/lib.rs nook-core/src/lib.rs nook-wasm/src/lib.rs
RUN cargo chef prepare --recipe-path recipe.json

FROM rust-base AS builder-deps-common

WORKDIR /meta-secret/nook/nook-app

COPY nook-app/.cargo .cargo
COPY nook-app/.config .config
COPY --from=chef-planner /meta-secret/nook/nook-app/recipe.json ./recipe.json
COPY nook-app/Cargo.toml nook-app/Cargo.lock ./
COPY nook-app/nook-auth2/Cargo.toml nook-auth2/Cargo.toml
COPY nook-app/nook-replication/Cargo.toml nook-replication/Cargo.toml
COPY nook-app/nook-event-log/Cargo.toml nook-event-log/Cargo.toml
COPY nook-app/nook-core/Cargo.toml nook-core/Cargo.toml
COPY nook-app/nook-wasm/Cargo.toml nook-wasm/Cargo.toml
# Stable epoch for the hosted WASM cook lineage. Bump when reseeding
# nook-rust-wasm-deps-* so cook digests are new and Main publish must upload real
# layer blobs — index-only refs to older scopes are not enough for PR restores.
ARG NOOK_WASM_DEPS_CACHE_EPOCH=v4-self-contained-1
RUN printf '%s\n' "${NOOK_WASM_DEPS_CACHE_EPOCH}" >/etc/nook-wasm-deps-cache-epoch
RUN cargo chef cook --release --target wasm32-unknown-unknown --recipe-path recipe.json \
    && nook-sccache-report chef-wasm-release
RUN cargo chef cook --release --clippy --target wasm32-unknown-unknown --recipe-path recipe.json \
    && nook-sccache-report chef-wasm-clippy
RUN cargo fetch --locked

FROM builder-deps-common AS builder-wasm-deps

RUN mkdir -p nook-auth2/src nook-replication/src nook-event-log/src nook-core/src nook-wasm/src \
    && touch nook-auth2/src/lib.rs nook-replication/src/lib.rs nook-event-log/src/lib.rs nook-core/src/lib.rs nook-wasm/src/lib.rs
RUN cargo build --tests --release --target wasm32-unknown-unknown -p nook-wasm \
    && nook-sccache-report wasm-release-test-dependencies

FROM builder-wasm-deps AS builder-deps

RUN cargo nextest run --no-run -p nook-auth2 --profile ci \
    && nook-sccache-report native-auth-nextest-dependencies
RUN cargo nextest run --no-run -p nook-replication --profile ci \
    && nook-sccache-report native-replication-nextest-dependencies
RUN cargo nextest run --no-run -p nook-event-log --profile ci \
    && nook-sccache-report native-event-log-nextest-dependencies
RUN cargo nextest run --no-run -p nook-core --profile ci \
    && nook-sccache-report native-core-nextest-dependencies
RUN cargo clippy -p nook-auth2 --all-targets -- -D warnings \
    && nook-sccache-report native-auth-clippy-dependencies
RUN cargo clippy -p nook-replication --all-targets -- -D warnings \
    && nook-sccache-report native-replication-clippy-dependencies
RUN cargo clippy -p nook-event-log --all-targets -- -D warnings \
    && nook-sccache-report native-event-log-clippy-dependencies
RUN cargo clippy -p nook-core --all-targets -- -D warnings \
    && nook-sccache-report native-core-clippy-dependencies
RUN cargo llvm-cov nextest --no-report --profile ci -p nook-auth2 -p nook-replication -p nook-event-log -p nook-core --no-tests=pass \
    && nook-sccache-report native-coverage-dependencies

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
        zip \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash -s -- "bun-v${BUN_VERSION}"
COPY --from=playwright-node /usr/local/bin/node /usr/local/bin/node
RUN sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -b /usr/local/bin "v${TASK_VERSION}"

WORKDIR /meta-secret/nook

# Browser binaries are deliberately outside web-base. PR checks use web-base for unit tests and
# preview builds. Main/manual e2e uses Debian's Chromium and ffmpeg packages instead of Playwright's
# bundled Chromium + headless-shell download, which otherwise produces a ~1.3 GB image layer.
FROM web-base AS web-e2e-base

ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium ffmpeg xvfb \
    && rm -rf /var/lib/apt/lists/*
