# syntax=docker/dockerfile:1.4

# Product Rust/WASM dependency lineage. rust-base through builder-*-deps stay in this
# Dockerfile so chef cook cache keys depend on a stable internal stage instead of a named-target
# image whose exported identity can change when a sibling hosted cache scope is republished.
# rust-platform overlays real platform sources on cooked builder-core-deps (one directory COPY).
# Focused nook-rust-* leaves and ecosystem deterministic take rust-platform via Bake named contexts.
# Other ecosystem gates live as sibling Dockerfiles in this directory.
# The web lineage lives under nook-web/docker and must not inherit Cargo target/ or the Rust toolchain.

# Global ARGs used ONLY by the FROM lines below. A pre-FROM ARG is not visible inside any stage's
# RUN/ENV — to use one there you must re-declare it in that stage. Only args that parameterize a
# base image live here; CLI-version args are declared in the stage that consumes them.
ARG RUST_VERSION=1.97
ARG DEBIAN_RELEASE=trixie
# Pin floating registry tags by digest. Unpinned `rust` tags move under us and rewrite the
# rust-base digest, which orphans every downstream cargo-chef cook layer in the hosted GHA cache
# and forces PRs to redownload crates on an otherwise unchanged Cargo.lock.
ARG RUST_DIGEST=sha256:1bcff4befb740599103a2c7cb51058e14479b2e35e3a34a3f0dc4ede09927488
ARG RUST_IMAGE=rust:${RUST_VERSION}-${DEBIAN_RELEASE}@${RUST_DIGEST}

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
# Node binary only — required for wasm-pack test --node. Pin version + sha256 so rust-base does
# not track a floating Node image digest. npm/npx are intentionally omitted.
ARG NODE_VERSION=24.19.0
ARG NODE_SHA256=f625d97cd707df4ff96254916fbc5ff014f09c09effe5a1e0ca8f6d41a8789d4
# cargo-chef binary only — pin the musl release tarball instead of copying from a full
# Rust-based helper image just to obtain one CLI.
ARG CARGO_CHEF_VERSION=0.1.77
ARG CARGO_CHEF_SHA256=a3733ab416c3ffddd37914cd13919ca05fee1a1cf654f3016dcfe7f399d89cd1

# Cargo uses the default <workspace>/target (i.e. /meta-secret/nook/nook-app/nook-platform/target). The heavy
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
        xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Standalone CLIs first (version bumps only).
RUN curl -fsSL \
      "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz" \
      -o /tmp/node.tar.gz \
    && echo "${NODE_SHA256}  /tmp/node.tar.gz" | sha256sum -c - \
    && tar xzf /tmp/node.tar.gz -C /tmp \
    && install -m 0755 \
      "/tmp/node-v${NODE_VERSION}-linux-x64/bin/node" \
      /usr/local/bin/node \
    && rm -rf /tmp/node.tar.gz "/tmp/node-v${NODE_VERSION}-linux-x64" \
    && node --version

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

COPY nook-app/nook-platform/docker/sccache-wrapper.sh /usr/local/bin/nook-sccache
COPY nook-app/nook-platform/docker/sccache-report.sh /usr/local/bin/nook-sccache-report
RUN chmod 0755 /usr/local/bin/nook-sccache /usr/local/bin/nook-sccache-report

RUN curl -fsSL \
      "https://github.com/LukeMathWalker/cargo-chef/releases/download/v${CARGO_CHEF_VERSION}/cargo-chef-x86_64-unknown-linux-musl.tar.xz" \
      -o /tmp/cargo-chef.tar.xz \
    && echo "${CARGO_CHEF_SHA256}  /tmp/cargo-chef.tar.xz" | sha256sum -c - \
    && tar -xJf /tmp/cargo-chef.tar.xz -C /tmp \
    && install -m 0755 \
      /tmp/cargo-chef-x86_64-unknown-linux-musl/cargo-chef \
      /usr/local/cargo/bin/cargo-chef \
    && rm -rf /tmp/cargo-chef.tar.xz /tmp/cargo-chef-x86_64-unknown-linux-musl \
    && cargo chef --version

WORKDIR /meta-secret/nook

# Keep manifest-only dependency stages in the same Dockerfile as rust-base. Their cache keys then
# depend on a stable internal stage instead of a named-target image result whose exported identity
# can change when a sibling hosted cache scope is republished.
FROM rust-base AS chef-deps

WORKDIR /meta-secret/nook/nook-app/nook-platform

COPY nook-app/nook-platform/.cargo .cargo
COPY nook-app/nook-platform/.config .config
COPY nook-app/nook-platform/clippy.toml clippy.toml
COPY nook-app/nook-platform/Cargo.toml nook-app/nook-platform/Cargo.lock ./
COPY nook-app/nook-platform/nook-app-common/Cargo.toml nook-app-common/Cargo.toml
COPY nook-app/nook-platform/nook-auth2/Cargo.toml nook-auth2/Cargo.toml
COPY nook-app/nook-platform/nook-replication/Cargo.toml nook-replication/Cargo.toml
COPY nook-app/nook-platform/nook-event-log/Cargo.toml nook-event-log/Cargo.toml
COPY nook-app/nook-platform/nook-companion-core/Cargo.toml nook-companion-core/Cargo.toml
COPY nook-app/nook-platform/nook-core/Cargo.toml nook-core/Cargo.toml
COPY nook-app/nook-platform/nook-companion-wasm/Cargo.toml nook-companion-wasm/Cargo.toml
COPY nook-app/nook-platform/nook-wasm/Cargo.toml nook-wasm/Cargo.toml
RUN mkdir -p \
      nook-app-common/src \
      nook-auth2/src \
      nook-replication/src \
      nook-event-log/src \
      nook-companion-core/src \
      nook-core/src \
      nook-companion-wasm/src \
      nook-wasm/src \
    && touch \
      nook-app-common/src/lib.rs \
      nook-auth2/src/lib.rs \
      nook-replication/src/lib.rs \
      nook-event-log/src/lib.rs \
      nook-companion-core/src/lib.rs \
      nook-core/src/lib.rs \
      nook-companion-wasm/src/lib.rs \
      nook-wasm/src/lib.rs
RUN cargo chef prepare --recipe-path recipe.json
# Stable epoch for the hosted WASM cook lineage. Bump when reseeding
# nook-rust-wasm-deps-* so cook digests are new and Main publish must upload real
# layer blobs — index-only refs to older scopes are not enough for PR restores.
ARG NOOK_WASM_DEPS_CACHE_EPOCH=v5-companion-wasm-1
RUN printf '%s\n' "${NOOK_WASM_DEPS_CACHE_EPOCH}" >/etc/nook-wasm-deps-cache-epoch
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo chef cook --release --target wasm32-unknown-unknown --recipe-path recipe.json \
    && nook-sccache-report chef-wasm-release
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo chef cook --release --clippy --target wasm32-unknown-unknown --recipe-path recipe.json \
    && nook-sccache-report chef-wasm-clippy
RUN cargo fetch --locked

FROM chef-deps AS builder-wasm-deps

RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --tests --release --target wasm32-unknown-unknown -p nook-wasm -p nook-companion-wasm \
    && nook-sccache-report wasm-release-test-dependencies

FROM builder-wasm-deps AS builder-core-deps

RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo nextest run --no-run -p nook-app-common --profile ci \
    && nook-sccache-report native-app-common-nextest-dependencies
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo nextest run --no-run -p nook-auth2 --profile ci \
    && nook-sccache-report native-auth-nextest-dependencies
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo nextest run --no-run -p nook-replication --profile ci \
    && nook-sccache-report native-replication-nextest-dependencies
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo nextest run --no-run -p nook-event-log --profile ci \
    && nook-sccache-report native-event-log-nextest-dependencies
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo nextest run --no-run -p nook-companion-core --profile ci \
    && nook-sccache-report native-companion-core-nextest-dependencies
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo nextest run --no-run -p nook-core --profile ci \
    && nook-sccache-report native-core-nextest-dependencies
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo clippy -p nook-app-common --all-targets -- -D warnings \
    && nook-sccache-report native-app-common-clippy-dependencies
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo clippy -p nook-auth2 --all-targets -- -D warnings \
    && nook-sccache-report native-auth-clippy-dependencies
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo clippy -p nook-replication --all-targets -- -D warnings \
    && nook-sccache-report native-replication-clippy-dependencies
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo clippy -p nook-event-log --all-targets -- -D warnings \
    && nook-sccache-report native-event-log-clippy-dependencies
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo clippy -p nook-companion-core --all-targets -- -D warnings \
    && nook-sccache-report native-companion-core-clippy-dependencies
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo clippy -p nook-core --all-targets -- -D warnings \
    && nook-sccache-report native-core-clippy-dependencies
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo llvm-cov nextest --no-report --profile ci -p nook-app-common -p nook-auth2 -p nook-replication -p nook-event-log -p nook-companion-core -p nook-core --no-tests=pass \
    && nook-sccache-report native-coverage-dependencies

# Source overlay for bulk native leaves. Keep this after cook so builder-*-deps stay
# manifest-stable; platform tree edits invalidate only this stage and its consumers.
FROM builder-core-deps AS rust-platform

WORKDIR /meta-secret/nook
COPY nook-app/nook-platform/ nook-app/nook-platform/
