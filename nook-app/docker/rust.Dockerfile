# syntax=docker/dockerfile:1.4

# Rust/WASM lineage. Manifest-only chef and builder-core-deps stages stay in this Dockerfile so their
# cache keys depend on a stable internal stage instead of a named-target image whose exported
# identity can change when a sibling hosted cache scope is republished. The web lineage lives in
# web.Dockerfile and must not inherit Cargo target/ or the Rust toolchain.

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

COPY nook-app/docker/sccache-wrapper.sh /usr/local/bin/nook-sccache
COPY nook-app/docker/sccache-report.sh /usr/local/bin/nook-sccache-report
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

WORKDIR /meta-secret/nook/nook-app

COPY nook-app/.cargo .cargo
COPY nook-app/.config .config
COPY nook-app/Cargo.toml nook-app/Cargo.lock ./
COPY nook-app/nook-app-common/Cargo.toml nook-app-common/Cargo.toml
COPY nook-app/nook-auth2/Cargo.toml nook-auth2/Cargo.toml
COPY nook-app/nook-replication/Cargo.toml nook-replication/Cargo.toml
COPY nook-app/nook-event-log/Cargo.toml nook-event-log/Cargo.toml
COPY nook-app/nook-companion-core/Cargo.toml nook-companion-core/Cargo.toml
COPY nook-app/nook-core/Cargo.toml nook-core/Cargo.toml
COPY nook-app/nook-companion-wasm/Cargo.toml nook-companion-wasm/Cargo.toml
COPY nook-app/nook-wasm/Cargo.toml nook-wasm/Cargo.toml
RUN mkdir -p nook-app-common/src nook-auth2/src nook-replication/src nook-event-log/src nook-companion-core/src nook-core/src nook-companion-wasm/src nook-wasm/src \
    && touch nook-app-common/src/lib.rs nook-auth2/src/lib.rs nook-replication/src/lib.rs nook-event-log/src/lib.rs nook-companion-core/src/lib.rs nook-core/src/lib.rs nook-companion-wasm/src/lib.rs nook-wasm/src/lib.rs
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

# Keep focused source stages in this Dockerfile so their builder-core-deps parent identity is portable
# across disposable BuildKit daemons. Named Bake target contexts do not preserve that identity.
FROM builder-core-deps AS nook-rust-test

WORKDIR /meta-secret/nook

COPY nook-app/Cargo.toml nook-app/Cargo.lock nook-app/
COPY nook-app/.cargo nook-app/.cargo
COPY nook-app/.config nook-app/.config
COPY nook-app/nook-app-common nook-app/nook-app-common
COPY nook-app/nook-auth2 nook-app/nook-auth2
COPY nook-app/nook-replication nook-app/nook-replication
COPY nook-app/nook-event-log nook-app/nook-event-log
COPY nook-app/nook-companion-core nook-app/nook-companion-core
COPY nook-app/nook-core nook-app/nook-core
COPY nook-app/nook-companion-wasm nook-app/nook-companion-wasm
COPY nook-app/nook-wasm nook-app/nook-wasm

RUN find \
      nook-app/nook-app-common/src \
      nook-app/nook-auth2/src \
      nook-app/nook-replication/src \
      nook-app/nook-event-log/src \
      nook-app/nook-companion-core/src \
      nook-app/nook-core/src \
      -type f -name '*.rs' -exec touch {} +

RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cd nook-app \
    && cargo nextest run \
      -p nook-app-common \
      -p nook-companion-core \
      -p nook-companion-wasm \
      -p nook-core \
      -p nook-auth2 \
      -p nook-replication \
      -p nook-event-log \
      --profile ci \
      --no-run \
    && nook-sccache-report focused-native-test-compile

# The full checkout is runtime input only and cannot invalidate the compile vertex above.
COPY . .

RUN test -f nook-app/Taskfile.yml \
    && git init -q \
    && git config user.email nook@local \
    && git config user.name nook \
    && git add -A \
    && git commit -q -m "nook-rust-test source snapshot" >/dev/null

FROM builder-core-deps AS nook-rust-lint

WORKDIR /meta-secret/nook

COPY nook-app/Cargo.toml nook-app/Cargo.lock nook-app/
COPY nook-app/.cargo nook-app/.cargo
COPY nook-app/.config nook-app/.config
COPY nook-app/nook-app-common nook-app/nook-app-common
COPY nook-app/nook-auth2 nook-app/nook-auth2
COPY nook-app/nook-replication nook-app/nook-replication
COPY nook-app/nook-event-log nook-app/nook-event-log
COPY nook-app/nook-companion-core nook-app/nook-companion-core
COPY nook-app/nook-core nook-app/nook-core
COPY nook-app/nook-companion-wasm nook-app/nook-companion-wasm
COPY nook-app/nook-wasm nook-app/nook-wasm

RUN find nook-app -type f -name '*.rs' -exec touch {} +

RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cd nook-app \
    && cargo clippy \
      -p nook-app-common \
      -p nook-companion-core \
      -p nook-core \
      -p nook-auth2 \
      -p nook-replication \
      -p nook-event-log \
      --all-targets -- -D warnings \
    && cargo clippy --release --target wasm32-unknown-unknown \
      -p nook-wasm -p nook-companion-wasm -- -D warnings \
    && nook-sccache-report focused-rust-lint-compile

COPY . .

RUN test -f nook-app/Taskfile.yml \
    && git init -q \
    && git config user.email nook@local \
    && git config user.name nook \
    && git add -A \
    && git commit -q -m "nook-rust-lint source snapshot" >/dev/null

FROM builder-core-deps AS nook-rust-coverage

WORKDIR /meta-secret/nook

COPY nook-app/Cargo.toml nook-app/Cargo.lock nook-app/
COPY nook-app/.cargo nook-app/.cargo
COPY nook-app/.config nook-app/.config
COPY nook-app/nook-app-common nook-app/nook-app-common
COPY nook-app/nook-auth2 nook-app/nook-auth2
COPY nook-app/nook-replication nook-app/nook-replication
COPY nook-app/nook-event-log nook-app/nook-event-log
COPY nook-app/nook-companion-core nook-app/nook-companion-core
COPY nook-app/nook-core nook-app/nook-core

RUN find nook-app -type f -name '*.rs' -exec touch {} +

RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cd nook-app \
    && cargo llvm-cov nextest --no-clean --profile ci \
      -p nook-app-common \
      -p nook-companion-core \
      -p nook-core \
      -p nook-auth2 \
      -p nook-replication \
      -p nook-event-log \
      --summary-only \
    && nook-sccache-report focused-rust-coverage-compile

COPY . .

RUN test -f nook-app/Taskfile.yml \
    && git init -q \
    && git config user.email nook@local \
    && git config user.name nook \
    && git add -A \
    && git commit -q -m "nook-rust-coverage source snapshot" >/dev/null

# --- Rust ecosystem gates ---
# Same Dockerfile as rust-base, but separate Bake images/stages so product builds
# do not inherit deny/audit/fuzz/dylint or a second nightly toolchain.

FROM rust-base AS rust-ecosystem-policy-tools

ARG CARGO_DENY_VERSION=0.20.2
ARG CARGO_DENY_SHA256=9f12ed4c49936e09b48bf862b595cde2fe64fcbd9d74dfacac6131ca824c8d5f
ARG CARGO_AUDIT_VERSION=0.22.1
ARG CARGO_AUDIT_SHA256=c32506f338bdcdaef5a17fb9f33abb6ecf9561324cfd34237fd335f9283a1eab

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL \
      "https://github.com/EmbarkStudios/cargo-deny/releases/download/${CARGO_DENY_VERSION}/cargo-deny-${CARGO_DENY_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
      -o /tmp/cargo-deny.tgz \
    && echo "${CARGO_DENY_SHA256}  /tmp/cargo-deny.tgz" | sha256sum -c - \
    && tar xzf /tmp/cargo-deny.tgz -C /tmp \
    && install -m 0755 \
      "/tmp/cargo-deny-${CARGO_DENY_VERSION}-x86_64-unknown-linux-musl/cargo-deny" \
      /usr/local/cargo/bin/cargo-deny \
    && rm -rf /tmp/cargo-deny.tgz \
      "/tmp/cargo-deny-${CARGO_DENY_VERSION}-x86_64-unknown-linux-musl" \
    && curl -fsSL \
      "https://github.com/rustsec/rustsec/releases/download/cargo-audit%2Fv${CARGO_AUDIT_VERSION}/cargo-audit-x86_64-unknown-linux-musl-v${CARGO_AUDIT_VERSION}.tgz" \
      -o /tmp/cargo-audit.tgz \
    && echo "${CARGO_AUDIT_SHA256}  /tmp/cargo-audit.tgz" | sha256sum -c - \
    && tar xzf /tmp/cargo-audit.tgz -C /tmp \
    && install -m 0755 \
      "/tmp/cargo-audit-x86_64-unknown-linux-musl-v${CARGO_AUDIT_VERSION}/cargo-audit" \
      /usr/local/cargo/bin/cargo-audit \
    && rm -rf /tmp/cargo-audit.tgz \
      "/tmp/cargo-audit-x86_64-unknown-linux-musl-v${CARGO_AUDIT_VERSION}" \
    && cargo-deny --version \
    && cargo-audit --version

FROM rust-ecosystem-policy-tools AS rust-dependency-policy

WORKDIR /meta-secret/nook
COPY . .
RUN set -eux; \
    for manifest in \
      nook-app/Cargo.toml \
      fuzz/Cargo.toml \
      preflight/Cargo.toml \
      agentic-ai/minds/Cargo.toml; do \
      cargo-deny --manifest-path "$manifest" check; \
    done; \
    for workspace in nook-app fuzz preflight agentic-ai/minds; do \
      (cd "$workspace" && cargo-audit audit); \
    done

FROM rust-base AS rust-ecosystem-nightly

ARG DYLINT_NIGHTLY=nightly-2026-04-16
ARG CARGO_FUZZ_VERSION=0.13.2
ARG CARGO_FUZZ_SHA256=b5b704018b63e0f151c17a057ac53b5111e1db545d1b9f72fee79f08a545931c
ARG CARGO_DYLINT_VERSION=6.0.1

# cargo-fuzz has a usable release binary. cargo-dylint release binaries bake a
# CI-only driver path, so install the pinned crates once into this image layer.
RUN rustup toolchain install "${DYLINT_NIGHTLY}" \
      --component clippy,llvm-tools-preview,rustc-dev \
    && curl -fsSL \
      "https://github.com/rust-fuzz/cargo-fuzz/releases/download/${CARGO_FUZZ_VERSION}/cargo-fuzz-${CARGO_FUZZ_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
      -o /tmp/cargo-fuzz.tgz \
    && echo "${CARGO_FUZZ_SHA256}  /tmp/cargo-fuzz.tgz" | sha256sum -c - \
    && tar xzf /tmp/cargo-fuzz.tgz -C /tmp \
    && install -m 0755 /tmp/cargo-fuzz /usr/local/cargo/bin/cargo-fuzz \
    && rm -rf /tmp/cargo-fuzz.tgz /tmp/cargo-fuzz \
    && cargo install cargo-dylint dylint-link \
      --version "${CARGO_DYLINT_VERSION}" --locked \
    && cargo fuzz --version \
    && cargo dylint --version

FROM rust-ecosystem-nightly AS rust-fuzz-smoke

ARG FUZZ_SECONDS=20
ARG DYLINT_NIGHTLY=nightly-2026-04-16

WORKDIR /meta-secret/nook
COPY nook-app/Cargo.toml nook-app/Cargo.lock nook-app/
COPY nook-app/.cargo nook-app/.cargo
COPY nook-app/.config nook-app/.config
COPY nook-app/nook-app-common nook-app/nook-app-common
COPY nook-app/nook-auth2 nook-app/nook-auth2
COPY nook-app/nook-replication nook-app/nook-replication
COPY nook-app/nook-event-log nook-app/nook-event-log
COPY nook-app/nook-companion-core nook-app/nook-companion-core
COPY nook-app/nook-core nook-app/nook-core
COPY nook-app/nook-companion-wasm nook-app/nook-companion-wasm
COPY nook-app/nook-wasm nook-app/nook-wasm
COPY fuzz fuzz

ENV RUSTUP_TOOLCHAIN=${DYLINT_NIGHTLY}
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    set -eux; \
    cd nook-app; \
    cargo clippy --manifest-path ../fuzz/Cargo.toml \
      --locked --target x86_64-unknown-linux-gnu --all-targets -- -D warnings; \
    cargo metadata --manifest-path ../fuzz/Cargo.toml \
      --locked --format-version 1 --no-deps >/dev/null; \
    cargo fuzz run --fuzz-dir ../fuzz \
      --target x86_64-unknown-linux-gnu \
      wire-parsers -- -max_total_time="${FUZZ_SECONDS}"; \
    nook-sccache-report rust-fuzz-smoke

FROM rust-ecosystem-nightly AS rust-dylint

ARG DYLINT_NIGHTLY=nightly-2026-04-16

WORKDIR /meta-secret/nook
COPY nook-app/Cargo.toml nook-app/Cargo.lock nook-app/
COPY nook-app/.cargo nook-app/.cargo
COPY nook-app/.config nook-app/.config
COPY nook-app/nook-app-common nook-app/nook-app-common
COPY nook-app/nook-auth2 nook-app/nook-auth2
COPY nook-app/nook-replication nook-app/nook-replication
COPY nook-app/nook-event-log nook-app/nook-event-log
COPY nook-app/nook-companion-core nook-app/nook-companion-core
COPY nook-app/nook-core nook-app/nook-core
COPY nook-app/nook-companion-wasm nook-app/nook-companion-wasm
COPY nook-app/nook-wasm nook-app/nook-wasm

ENV RUSTUP_TOOLCHAIN=${DYLINT_NIGHTLY}
ENV RUSTFLAGS="-D warnings"
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cd nook-app \
    && cargo dylint --all -- --all-targets \
    && nook-sccache-report rust-dylint

FROM builder-core-deps AS rust-ecosystem-deterministic

WORKDIR /meta-secret/nook
COPY nook-app/Cargo.toml nook-app/Cargo.lock nook-app/
COPY nook-app/.cargo nook-app/.cargo
COPY nook-app/.config nook-app/.config
COPY nook-app/nook-app-common nook-app/nook-app-common
COPY nook-app/nook-auth2 nook-app/nook-auth2
COPY nook-app/nook-replication nook-app/nook-replication
COPY nook-app/nook-event-log nook-app/nook-event-log
COPY nook-app/nook-companion-core nook-app/nook-companion-core
COPY nook-app/nook-core nook-app/nook-core
COPY nook-app/nook-companion-wasm nook-app/nook-companion-wasm
COPY nook-app/nook-wasm nook-app/nook-wasm
COPY nook-app/.insta.yaml nook-app/.insta.yaml

RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    set -eux; \
    cd nook-app; \
    INSTA_UPDATE=no cargo test --locked -p nook-replication; \
    RUSTFLAGS='--cfg loom' cargo test --locked -p nook-replication loom_tests --release; \
    nook-sccache-report rust-ecosystem-deterministic
