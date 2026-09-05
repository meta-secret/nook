# syntax=registry.dev.nokey.sh/docker/dockerfile:1.4

# Product Rust/WASM lineage. Dependencies and source leaves stay in this
# Dockerfile so cache keys use stable internal stages across fresh builders.
# rust-platform overlays real platform sources on cooked builder-core-deps (one directory COPY).
# Focused nook-rust-* leaves and ecosystem deterministic extend internal stages.
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
ARG RUST_DIGEST=sha256:3382bd20aa942806c533e9a73cd000474fb3ef173f71e684cc9b942675781769
ARG RUST_IMAGE=registry.dev.nokey.sh/library/rust:${RUST_VERSION}-${DEBIAN_RELEASE}@${RUST_DIGEST}

FROM ${RUST_IMAGE} AS rust-base

# Pinned CLI versions, declared once here because they are used only inside this stage's RUNs
# (a pre-FROM ARG would not be visible in RUN). Override with --build-arg / bake args.
ARG TASK_VERSION=3.52.0
ARG WASM_PACK_VERSION=0.15.0
ARG LLVM_COV_VERSION=0.8.7
ARG SCCACHE_VERSION=0.17.0
ARG SCCACHE_SHA256=67c4a96dd237c1f518f6b36083f270f9976d516f1e57fce891755ea782e50006
ARG SCCACHE_S3_MODE=external
ARG SCCACHE_ENDPOINT=https://sccache.dev.nokey.sh
ARG SCCACHE_BUCKET=nook-sccache
# Binaryen (wasm-opt): pinned to a modern release so wasm-pack uses a correct, local wasm-opt.
# Debian's binaryen is too old (corrupts externref tables -> table.grow crash); baking it here also
# avoids wasm-pack downloading it from GitHub at build time (flaky, rate-limited).
ARG BINARYEN_VERSION=131
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
COPY nook-app/nook-platform/nook-authenticator-domain/Cargo.toml nook-authenticator-domain/Cargo.toml
COPY nook-app/nook-platform/nook-auth2/Cargo.toml nook-auth2/Cargo.toml
COPY nook-app/nook-platform/nook-replication/Cargo.toml nook-replication/Cargo.toml
COPY nook-app/nook-platform/nook-event-log/Cargo.toml nook-event-log/Cargo.toml
COPY nook-app/nook-platform/nook-companion-core/Cargo.toml nook-companion-core/Cargo.toml
COPY nook-app/nook-platform/nook-core/Cargo.toml nook-core/Cargo.toml
COPY nook-app/nook-platform/nook-companion-wasm/Cargo.toml nook-companion-wasm/Cargo.toml
COPY nook-app/nook-platform/nook-wasm/Cargo.toml nook-wasm/Cargo.toml
RUN mkdir -p \
      nook-app-common/src \
      nook-authenticator-domain/src \
      nook-auth2/src \
      nook-replication/src \
      nook-event-log/src \
      nook-companion-core/src \
      nook-core/src \
      nook-companion-wasm/src \
      nook-wasm/src \
    && touch \
      nook-app-common/src/lib.rs \
      nook-authenticator-domain/src/lib.rs \
      nook-auth2/src/lib.rs \
      nook-replication/src/lib.rs \
      nook-event-log/src/lib.rs \
      nook-companion-core/src/lib.rs \
      nook-core/src/lib.rs \
      nook-companion-wasm/src/lib.rs \
      nook-wasm/src/lib.rs
RUN cargo chef prepare --recipe-path recipe.json
RUN --network=default cargo fetch --locked
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
    cargo nextest run --no-run -p nook-authenticator-domain -p nook-auth2 --profile ci \
    && nook-sccache-report native-auth-nextest-dependencies
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo nextest run --no-run -p nook-replication --profile ci \
    && nook-sccache-report native-replication-nextest-dependencies
# Loom selects an additional dev-dependency graph through cfg(loom). Warm that
# release graph while this stage still contains manifest-only dummy sources.
# Fresh PRs can then restore both Cargo target metadata and compiler objects from
# Main instead of merely replaying rustc through sccache in the source leaf.
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    RUSTFLAGS='--cfg loom' cargo test --locked --release \
      -p nook-replication --no-run \
    && nook-sccache-report native-replication-loom-release-dependencies
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
    cargo clippy -p nook-authenticator-domain -p nook-auth2 --all-targets -- -D warnings \
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
    cargo llvm-cov nextest --no-report --profile ci -p nook-app-common -p nook-authenticator-domain -p nook-auth2 -p nook-replication -p nook-event-log -p nook-companion-core -p nook-core --no-tests=pass \
    && nook-sccache-report native-coverage-dependencies

FROM builder-wasm-deps AS wasm-coverage-toolchain
ARG WASM_COVERAGE_NIGHTLY=nightly-2026-04-16
RUN rustup toolchain install "${WASM_COVERAGE_NIGHTLY}" --component llvm-tools-preview \
    && rustup target add --toolchain "${WASM_COVERAGE_NIGHTLY}" wasm32-unknown-unknown

# Node verification dependencies must remain independent of product source. This stage is included
# in the portable WASM dependency cache, so a fresh ARC node restores the nightly coverage graph,
# browser OS packages, Bun, Chromium, and chromedriver before any real Rust source is copied.
FROM wasm-coverage-toolchain AS builder-wasm-node-deps

ARG WASM_COVERAGE_NIGHTLY=nightly-2026-04-16
ARG BUN_VERSION=1.3.14
ARG PLAYWRIGHT_VERSION=1.55.0
ARG PLAYWRIGHT_CHROMIUM_VERSION=140.0.7339.16
ARG PLAYWRIGHT_CHROMEDRIVER_SHA256=f40639ecc590adea9583a15066afd8e2e3e84173435dc4e31d9b01afcc41bd66
ENV BUN_INSTALL=/usr/local/bun PATH="/usr/local/bun/bin:${PATH}" PLAYWRIGHT_BROWSERS_PATH=/opt/nook/ms-playwright CHROMEDRIVER=/usr/local/bin/chromedriver

RUN apt-get update \
    && apt-get install -y --no-install-recommends clang unzip \
    && rm -rf /var/lib/apt/lists/* \
    && clang --version

RUN curl -fsSL https://bun.sh/install | bash -s -- "bun-v${BUN_VERSION}" \
    && bunx playwright@${PLAYWRIGHT_VERSION} install-deps chromium \
    && mkdir -p "$PLAYWRIGHT_BROWSERS_PATH" \
    && bunx playwright@${PLAYWRIGHT_VERSION} install chromium \
    && chromium="$(find "$PLAYWRIGHT_BROWSERS_PATH" -type f -name headless_shell -print -quit)" \
    && test -x "$chromium" && ln -s "$chromium" /usr/local/bin/google-chrome \
    && curl -fsSL "https://storage.googleapis.com/chrome-for-testing-public/${PLAYWRIGHT_CHROMIUM_VERSION}/linux64/chromedriver-linux64.zip" -o /tmp/chromedriver.zip \
    && echo "${PLAYWRIGHT_CHROMEDRIVER_SHA256}  /tmp/chromedriver.zip" | sha256sum -c - \
    && unzip -q /tmp/chromedriver.zip -d /tmp/chromedriver \
    && install -m 0755 /tmp/chromedriver/chromedriver-linux64/chromedriver "$CHROMEDRIVER" \
    && rm -rf /tmp/chromedriver /tmp/chromedriver.zip \
    && "$CHROMEDRIVER" --version

# Export cargo-llvm-cov's host and wasm external-test environments, then compile both instrumented
# graphs against dummy roots. Ordinary cargo --no-run never tries to merge absent profraw.
RUN cargo +"${WASM_COVERAGE_NIGHTLY}" llvm-cov clean --workspace \
    && eval "$(CARGO_TARGET_DIR=target/llvm-cov-target cargo +"${WASM_COVERAGE_NIGHTLY}" llvm-cov show-env --sh)" \
    && CARGO_TARGET_DIR=target/llvm-cov-target cargo +"${WASM_COVERAGE_NIGHTLY}" test --release -p nook-wasm --no-run
RUN eval "$(CARGO_TARGET_DIR=target/llvm-cov-target cargo +"${WASM_COVERAGE_NIGHTLY}" llvm-cov show-env --sh --target wasm32-unknown-unknown)" \
    && CARGO_TARGET_DIR=target/llvm-cov-target CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER=true CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS="-Zno-profiler-runtime -Clink-args=--no-gc-sections --cfg=wasm_bindgen_unstable_test_coverage" cargo +"${WASM_COVERAGE_NIGHTLY}" test --target wasm32-unknown-unknown --release -p nook-wasm --features browser-wasm-tests --no-run
# Source overlay for bulk native leaves. Keep this after cook so builder-*-deps stay
# manifest-stable; platform tree edits invalidate only this stage and its consumers.
FROM builder-core-deps AS rust-platform

WORKDIR /meta-secret/nook
COPY nook-app/nook-platform/ nook-app/nook-platform/

# -----------------------------------------------------------------------------

# Native source verification extends the self-contained dependency stages above.
FROM builder-core-deps AS builder-debug

WORKDIR /meta-secret/nook/nook-app/nook-platform

COPY nook-app/nook-platform/Cargo.toml nook-app/nook-platform/Cargo.lock ./
COPY nook-app/nook-platform/.config .config
COPY nook-app/nook-platform/clippy.toml clippy.toml

# Source-sensitive verification layers are ordered by Rust dependency edge. A nook-core-only change
# can reuse the common/auth clippy and coverage-test layers; a nook-wasm-only change can reuse both.
COPY nook-app/nook-platform/nook-app-common nook-app-common
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    touch nook-app-common/src/i18n.rs \
    && cargo clippy -p nook-app-common --all-targets -- -D warnings \
    && nook-sccache-report native-app-common-clippy
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo llvm-cov nextest --no-clean --profile ci -p nook-app-common \
    && nook-sccache-report native-app-common-coverage

COPY nook-app/nook-platform/nook-authenticator-domain nook-authenticator-domain
COPY nook-app/nook-platform/nook-auth2 nook-auth2
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo clippy -p nook-authenticator-domain -p nook-auth2 --all-targets -- -D warnings \
    && nook-sccache-report native-auth-clippy
# --no-clean keeps the manifest-keyed instrumented dependencies warmed above. cargo-llvm-cov does
# not allow --no-clean with --no-report, so this first source-level run emits its interim report;
# the nook-core run below then extends the same coverage session and enforces the combined floor.
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo llvm-cov nextest --no-clean --profile ci -p nook-authenticator-domain -p nook-auth2 \
    && cargo test --locked -p nook-auth2 --doc \
    && nook-sccache-report native-auth-coverage

COPY nook-app/nook-platform/nook-replication nook-replication
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo clippy -p nook-replication --all-targets -- -D warnings \
    && nook-sccache-report native-replication-clippy
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo llvm-cov nextest --no-clean --profile ci -p nook-replication \
    && nook-sccache-report native-replication-coverage

COPY nook-app/nook-platform/nook-event-log nook-event-log
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo clippy -p nook-event-log --all-targets -- -D warnings \
    && nook-sccache-report native-event-log-clippy
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo llvm-cov nextest --no-clean --profile ci -p nook-event-log \
    && nook-sccache-report native-event-log-coverage

COPY nook-app/nook-platform/nook-companion-core nook-companion-core
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo clippy -p nook-companion-core --all-targets -- -D warnings \
    && nook-sccache-report native-companion-core-clippy
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo llvm-cov nextest --no-clean --profile ci -p nook-companion-core \
    && cargo test --locked -p nook-companion-core --doc \
    && nook-sccache-report native-companion-core-coverage

COPY nook-app/nook-platform/nook-core nook-core
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo clippy -p nook-core --all-targets -- -D warnings \
    && nook-sccache-report native-core-clippy
# Coverage runs HERE, in the image build (not at task runtime): cargo-llvm-cov first runs
# nook-app-common, nook-authenticator-domain, nook-auth2, nook-replication,
# nook-event-log, and nook-companion-core above,
# then runs nook-core with --no-clean
# so the final report combines all portable crates while preserving cacheable dependency coverage.
# The same run also bakes the coverage artifacts that PR CI copies out later;
# export must not rerun the Rust tests.
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    mkdir -p /opt/nook/coverage/nook-core \
    && cargo llvm-cov nextest --no-clean --profile ci -p nook-core --summary-only > /tmp/nook-core-coverage-summary.txt \
    && coverage_status=0 \
    && for package in nook-app-common nook-authenticator-domain nook-auth2 nook-replication nook-event-log nook-companion-core nook-core; do \
         floor="$(jq -r --arg package "$package" '.package_lines_percent[$package]' nook-core/coverage-floor.json)"; cargo llvm-cov report -p "$package" --summary-only --fail-under-lines "$floor" || coverage_status=1; \
       done \
    && test "$coverage_status" -eq 0 \
    && cargo llvm-cov report -p nook-core -p nook-app-common -p nook-authenticator-domain -p nook-auth2 -p nook-replication -p nook-event-log -p nook-companion-core --summary-only > /opt/nook/coverage/nook-core/summary.txt \
    && cargo llvm-cov report -p nook-core -p nook-app-common -p nook-authenticator-domain -p nook-auth2 -p nook-replication -p nook-event-log -p nook-companion-core --json --summary-only > /opt/nook/coverage/nook-core/summary.json \
    && cargo llvm-cov report -p nook-core -p nook-app-common -p nook-authenticator-domain -p nook-auth2 -p nook-replication -p nook-event-log -p nook-companion-core --lcov --output-path /opt/nook/coverage/nook-core/lcov.info \
    && cp nook-core/coverage-floor.json /opt/nook/coverage/nook-core/coverage-floor.json \
    && nook-sccache-report native-core-coverage

COPY nook-app/nook-platform/nook-companion-wasm nook-companion-wasm
COPY nook-app/nook-platform/nook-wasm nook-wasm

# Export only the small, already-computed coverage payload. This target deliberately branches
# before the WASM/web production stages so a PR fallback never materializes the multi-GB app image.
FROM scratch AS coverage-export

COPY --from=builder-debug /opt/nook/coverage/nook-core/ /

# -----------------------------------------------------------------------------

# Per-crate COPY+RUN so a single crate edit reuses earlier nextest --no-run layers.
# rust-platform's bulk COPY cannot do that — any source change busts every RUN.
FROM builder-core-deps AS nook-rust-test

WORKDIR /meta-secret/nook/nook-app/nook-platform

COPY nook-app/nook-platform/Cargo.toml nook-app/nook-platform/Cargo.lock ./
COPY nook-app/nook-platform/.cargo .cargo
COPY nook-app/nook-platform/.config .config
COPY nook-app/nook-platform/clippy.toml clippy.toml

COPY nook-app/nook-platform/nook-app-common nook-app-common
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    touch nook-app-common/src/i18n.rs \
    && cargo nextest run -p nook-app-common --profile ci --no-run \
    && nook-sccache-report focused-native-test-app-common

COPY nook-app/nook-platform/nook-authenticator-domain nook-authenticator-domain
COPY nook-app/nook-platform/nook-auth2 nook-auth2
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo nextest run -p nook-authenticator-domain -p nook-auth2 --profile ci --no-run \
    && nook-sccache-report focused-native-test-auth2

COPY nook-app/nook-platform/nook-replication nook-replication
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo nextest run -p nook-replication --profile ci --no-run \
    && nook-sccache-report focused-native-test-replication

COPY nook-app/nook-platform/nook-event-log nook-event-log
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo nextest run -p nook-event-log --profile ci --no-run \
    && nook-sccache-report focused-native-test-event-log

COPY nook-app/nook-platform/nook-companion-core nook-companion-core
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo nextest run -p nook-companion-core --profile ci --no-run \
    && nook-sccache-report focused-native-test-companion-core

COPY nook-app/nook-platform/nook-core nook-core
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo nextest run -p nook-core --profile ci --no-run \
    && nook-sccache-report focused-native-test-core

COPY nook-app/nook-platform/nook-companion-wasm nook-companion-wasm
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo nextest run -p nook-companion-wasm --profile ci --no-run \
    && nook-sccache-report focused-native-test-compile

# The full checkout is runtime input only and cannot invalidate the compile layers above.
WORKDIR /meta-secret/nook
COPY . .

RUN test -f nook-app/Taskfile.yml \
    && git init -q \
    && git config user.email nook@local \
    && git config user.name nook \
    && git add -A \
    && git commit -q -m "nook-rust-test source snapshot" >/dev/null

# -----------------------------------------------------------------------------

# Per-crate COPY+RUN so a single crate edit reuses earlier clippy layers.
# rust-platform's bulk COPY cannot do that — any source change busts every RUN.
FROM builder-core-deps AS nook-rust-lint

WORKDIR /meta-secret/nook/nook-app/nook-platform

COPY nook-app/nook-platform/Cargo.toml nook-app/nook-platform/Cargo.lock ./
COPY nook-app/nook-platform/.cargo .cargo
COPY nook-app/nook-platform/.config .config
COPY nook-app/nook-platform/clippy.toml clippy.toml

COPY nook-app/nook-platform/nook-app-common nook-app-common
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    touch nook-app-common/src/i18n.rs \
    && cargo clippy -p nook-app-common --all-targets -- -D warnings \
    && nook-sccache-report focused-rust-lint-app-common

COPY nook-app/nook-platform/nook-authenticator-domain nook-authenticator-domain
COPY nook-app/nook-platform/nook-auth2 nook-auth2
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo clippy -p nook-authenticator-domain -p nook-auth2 --all-targets -- -D warnings \
    && nook-sccache-report focused-rust-lint-auth2

COPY nook-app/nook-platform/nook-replication nook-replication
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo clippy -p nook-replication --all-targets -- -D warnings \
    && nook-sccache-report focused-rust-lint-replication

COPY nook-app/nook-platform/nook-event-log nook-event-log
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo clippy -p nook-event-log --all-targets -- -D warnings \
    && nook-sccache-report focused-rust-lint-event-log

COPY nook-app/nook-platform/nook-companion-core nook-companion-core
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo clippy -p nook-companion-core --all-targets -- -D warnings \
    && nook-sccache-report focused-rust-lint-companion-core

COPY nook-app/nook-platform/nook-core nook-core
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo clippy -p nook-core --all-targets -- -D warnings \
    && nook-sccache-report focused-rust-lint-core

COPY nook-app/nook-platform/nook-companion-wasm nook-companion-wasm
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo clippy --release --target wasm32-unknown-unknown \
      -p nook-companion-wasm -- -D warnings \
    && nook-sccache-report focused-rust-lint-companion-wasm

COPY nook-app/nook-platform/nook-wasm nook-wasm
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo clippy --release --target wasm32-unknown-unknown \
      -p nook-wasm -- -D warnings \
    && nook-sccache-report focused-rust-lint-compile

# The full checkout is runtime input only and cannot invalidate the compile layers above.
WORKDIR /meta-secret/nook
COPY . .

RUN test -f nook-app/Taskfile.yml \
    && git init -q \
    && git config user.email nook@local \
    && git config user.name nook \
    && git add -A \
    && git commit -q -m "nook-rust-lint source snapshot" >/dev/null

# -----------------------------------------------------------------------------

# Per-crate COPY+RUN so a single crate edit reuses earlier coverage layers.
# rust-platform's bulk COPY cannot do that — any source change busts every RUN.
FROM builder-core-deps AS nook-rust-coverage

WORKDIR /meta-secret/nook/nook-app/nook-platform

COPY nook-app/nook-platform/Cargo.toml nook-app/nook-platform/Cargo.lock ./
COPY nook-app/nook-platform/.cargo .cargo
COPY nook-app/nook-platform/.config .config
COPY nook-app/nook-platform/clippy.toml clippy.toml

COPY nook-app/nook-platform/nook-app-common nook-app-common
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    touch nook-app-common/src/i18n.rs \
    && cargo llvm-cov nextest --no-clean --profile ci -p nook-app-common --summary-only \
    && nook-sccache-report focused-rust-coverage-app-common

COPY nook-app/nook-platform/nook-authenticator-domain nook-authenticator-domain
COPY nook-app/nook-platform/nook-auth2 nook-auth2
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo llvm-cov nextest --no-clean --profile ci -p nook-authenticator-domain -p nook-auth2 --summary-only \
    && nook-sccache-report focused-rust-coverage-auth2

COPY nook-app/nook-platform/nook-replication nook-replication
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo llvm-cov nextest --no-clean --profile ci -p nook-replication --summary-only \
    && nook-sccache-report focused-rust-coverage-replication

COPY nook-app/nook-platform/nook-event-log nook-event-log
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo llvm-cov nextest --no-clean --profile ci -p nook-event-log --summary-only \
    && nook-sccache-report focused-rust-coverage-event-log

COPY nook-app/nook-platform/nook-companion-core nook-companion-core
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo llvm-cov nextest --no-clean --profile ci -p nook-companion-core --summary-only \
    && nook-sccache-report focused-rust-coverage-companion-core

COPY nook-app/nook-platform/nook-core nook-core
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo llvm-cov nextest --no-clean --profile ci -p nook-core --summary-only \
    && nook-sccache-report focused-rust-coverage-compile

# The full checkout is runtime input only and cannot invalidate the compile layers above.
WORKDIR /meta-secret/nook
COPY . .

RUN test -f nook-app/Taskfile.yml \
    && git init -q \
    && git config user.email nook@local \
    && git config user.name nook \
    && git add -A \
    && git commit -q -m "nook-rust-coverage source snapshot" >/dev/null

# -----------------------------------------------------------------------------

# Mounted development builds must keep Cargo artifacts outside `/meta-secret/nook`: the source
# bind mount replaces that whole tree. This image is keyed only by Cargo manifests/lockfile, so
# ordinary Rust source edits reuse the compiled dependency graph instead of rebuilding it.
FROM builder-wasm-deps AS nook-rust-fast

RUN mkdir -p /opt/nook \
    && mv /meta-secret/nook/nook-app/nook-platform/target /opt/nook/cargo-target

ENV CARGO_TARGET_DIR=/opt/nook/cargo-target
WORKDIR /meta-secret/nook

# nook-wasm source stage shared by sibling clippy, package-export, and release-test branches. The
# exported package does not wait for clippy or Node tests; the later join still gates those paths.

FROM builder-wasm-deps AS builder-wasm-source

ARG WASM_BUILD_MODE=dev

COPY nook-app/nook-platform/Cargo.toml nook-app/nook-platform/Cargo.lock ./
COPY nook-app/nook-platform/.config .config
COPY nook-app/nook-platform/clippy.toml clippy.toml

# Per-crate COPY+RUN so a later crate edit reuses earlier wasm32 compile layers.
# Compile the WASM package roots separately after each COPY, matching wasm-pack's
# package-by-package `cargo build --lib` feature graphs. A joint Cargo invocation
# unifies features across the roots and makes the second wasm-pack call rebuild.
# Sibling clippy/package/test stages still join from this snapshot.
COPY nook-app/nook-platform/nook-app-common nook-app-common
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    touch nook-app-common/src/i18n.rs \
    && cargo build --lib --release --target wasm32-unknown-unknown -p nook-wasm \
    && cargo build --lib --release --target wasm32-unknown-unknown -p nook-companion-wasm \
    && nook-sccache-report wasm-source-app-common

COPY nook-app/nook-platform/nook-authenticator-domain nook-authenticator-domain
COPY nook-app/nook-platform/nook-auth2 nook-auth2
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --lib --release --target wasm32-unknown-unknown -p nook-wasm \
    && cargo build --lib --release --target wasm32-unknown-unknown -p nook-companion-wasm \
    && nook-sccache-report wasm-source-auth

COPY nook-app/nook-platform/nook-replication nook-replication
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --lib --release --target wasm32-unknown-unknown -p nook-wasm \
    && cargo build --lib --release --target wasm32-unknown-unknown -p nook-companion-wasm \
    && nook-sccache-report wasm-source-replication

COPY nook-app/nook-platform/nook-event-log nook-event-log
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --lib --release --target wasm32-unknown-unknown -p nook-wasm \
    && cargo build --lib --release --target wasm32-unknown-unknown -p nook-companion-wasm \
    && nook-sccache-report wasm-source-event-log

COPY nook-app/nook-platform/nook-companion-core nook-companion-core
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --lib --release --target wasm32-unknown-unknown -p nook-wasm \
    && cargo build --lib --release --target wasm32-unknown-unknown -p nook-companion-wasm \
    && nook-sccache-report wasm-source-companion-core

COPY nook-app/nook-platform/nook-core nook-core
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --lib --release --target wasm32-unknown-unknown -p nook-wasm \
    && cargo build --lib --release --target wasm32-unknown-unknown -p nook-companion-wasm \
    && nook-sccache-report wasm-source-core

COPY nook-app/nook-platform/nook-companion-wasm nook-companion-wasm
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --lib --release --target wasm32-unknown-unknown -p nook-wasm \
    && cargo build --lib --release --target wasm32-unknown-unknown -p nook-companion-wasm \
    && nook-sccache-report wasm-source-companion-wasm

COPY nook-app/nook-platform/nook-wasm nook-wasm
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --lib --release --target wasm32-unknown-unknown -p nook-wasm \
    && cargo build --lib --release --target wasm32-unknown-unknown -p nook-companion-wasm \
    && nook-sccache-report wasm-source-wasm

# Clippy, package export, and release-test compilation are siblings from the shared source snapshot.
# wasm-pack build uses `cargo build --lib`, while wasm-pack test uses `cargo build --tests` and
# therefore a different Cargo feature/unit graph (dev-dependencies). Compiling that test graph here
# in parallel with the export path prevents the Node-test join from rebuilding workspace crates.
FROM builder-wasm-source AS builder-wasm-clippy

RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo clippy --release --target wasm32-unknown-unknown \
      -p nook-wasm -p nook-companion-wasm \
      -- -D warnings \
    && nook-sccache-report wasm-clippy \
    && install -D /dev/null /opt/nook/wasm-clippy-passed

FROM builder-wasm-source AS builder-wasm-build

# Emit the vault-app WASM package and the tiny companion package into the shared web source tree.
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    case "$WASM_BUILD_MODE" in \
      prod) wasm_opt_flag="" && stamp_mode="optimized" ;; \
      dev) wasm_opt_flag="--no-opt" && stamp_mode="no-opt" ;; \
      *) echo "Unsupported WASM_BUILD_MODE=$WASM_BUILD_MODE (expected dev or prod)" >&2; exit 1 ;; \
    esac \
    && wasm-pack build nook-wasm --target web \
         --out-dir "/meta-secret/nook/nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm" \
         --out-name nook_wasm $wasm_opt_flag \
    && wasm-pack build nook-companion-wasm --target web \
         --out-dir "/meta-secret/nook/nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm" \
         --out-name nook_companion_wasm $wasm_opt_flag \
    && ( current="$(find Cargo.toml Cargo.lock \
           nook-wasm/Cargo.toml nook-wasm/src \
           nook-companion-wasm/Cargo.toml nook-companion-wasm/src \
           nook-companion-core/Cargo.toml nook-companion-core/src \
           nook-app-common/Cargo.toml nook-app-common/src nook-app-common/locales \
           nook-core/Cargo.toml nook-core/src \
           nook-authenticator-domain/Cargo.toml nook-authenticator-domain/src \
           nook-auth2/Cargo.toml nook-auth2/src \
           nook-replication/Cargo.toml nook-replication/src \
           nook-event-log/Cargo.toml nook-event-log/src \
           \( -name '*.rs' -o -name '*.json' -o -name 'Cargo.toml' -o -name 'Cargo.lock' \) -print0 \
         | LC_ALL=C sort -z \
         | xargs -0 sha256sum \
         | sha256sum \
         | cut -d' ' -f1)" \
         && echo "$current $stamp_mode" > ../nook-web/nook-web-shared/src/vault-app/lib/nook-wasm/.wasm-source-sha256 \
         && echo "$current $stamp_mode" > ../nook-web/nook-web-shared/src/extension/nook-companion-wasm/.wasm-source-sha256 \
         && echo "$stamp_mode" > ../nook-web/nook-web-shared/src/vault-app/lib/nook-wasm/nook-wasm-build-mode \
         && mkdir -p /opt/nook/wasm-handoff \
         && cp -a ../nook-web/nook-web-shared/src/vault-app/lib/nook-wasm/. /opt/nook/wasm-handoff/ \
         && mkdir -p /opt/nook/wasm-handoff/nook-companion-wasm \
         && cp -a ../nook-web/nook-web-shared/src/extension/nook-companion-wasm/. \
              /opt/nook/wasm-handoff/nook-companion-wasm/ ) \
    && nook-sccache-report wasm-build

FROM builder-wasm-source AS builder-wasm-tests
# Match both wasm-pack test compile steps: `cargo build --tests` uses CARGO_BUILD_TARGET, while the
# later `cargo test` invocation passes `--target`. Warm both so the Node-test join stays Fresh.
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    CARGO_BUILD_TARGET=wasm32-unknown-unknown cargo build --tests --release -p nook-wasm -p nook-companion-wasm \
    && cargo test --release --target wasm32-unknown-unknown --no-run -p nook-wasm -p nook-companion-wasm \
    && nook-sccache-report wasm-release-tests

FROM builder-wasm-node-deps AS builder-wasm-handoff

ARG WASM_COVERAGE_NIGHTLY=nightly-2026-04-16

# Join the real source and normal release-test artifacts only after every Node-specific dependency.
COPY --from=builder-wasm-tests /meta-secret/nook/nook-app/nook-platform/ /meta-secret/nook/nook-app/nook-platform/

COPY --from=builder-wasm-clippy /opt/nook/wasm-clippy-passed /opt/nook/wasm-clippy-passed
COPY --from=builder-wasm-build \
    /meta-secret/nook/nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm \
    /meta-secret/nook/nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm
COPY --from=builder-wasm-build \
    /meta-secret/nook/nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm \
    /meta-secret/nook/nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm
COPY --from=builder-wasm-build /opt/nook/wasm-handoff /opt/nook/wasm-handoff

RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    RUSTC_WRAPPER= cargo +"${WASM_COVERAGE_NIGHTLY}" llvm-cov test --no-clean --release -p nook-wasm \
    && CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER=true CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS="-Zno-profiler-runtime -Clink-args=--no-gc-sections --cfg=wasm_bindgen_unstable_test_coverage" RUSTC_WRAPPER= cargo +"${WASM_COVERAGE_NIGHTLY}" llvm-cov test --no-clean --target wasm32-unknown-unknown --release -p nook-wasm --features browser-wasm-tests \
    && nook-sccache-report wasm-node-test-and-coverage

FROM builder-wasm-handoff AS builder-wasm
RUN echo "nook-wasm declared coverage tests: native=82 browser=147" && wasm-pack test --node --release nook-wasm \
    && wasm-pack test --node --release nook-companion-wasm \
    && runner="$(find /root/.cache/.wasm-pack -type f -name wasm-bindgen-test-runner -print -quit)" \
    && test -x "$runner" \
    && companion_floor="$(jq -r '.package_lines_percent["nook-companion-wasm"]' nook-core/coverage-floor.json)" \
    && nook_wasm_floor="$(jq -r '.package_lines_percent["nook-wasm"]' nook-core/coverage-floor.json)" \
    && CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER="$runner" CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS="-Zno-profiler-runtime -Clink-args=--no-gc-sections --cfg=wasm_bindgen_unstable_test_coverage" RUSTC_WRAPPER= cargo +"${WASM_COVERAGE_NIGHTLY}" llvm-cov test --no-clean --target wasm32-unknown-unknown --release -p nook-companion-wasm --fail-under-lines "$companion_floor" \
    && WASM_BINDGEN_TEST_TIMEOUT=60 CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER="$runner" CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS="-Zno-profiler-runtime -Clink-args=--no-gc-sections --cfg=wasm_bindgen_unstable_test_coverage" RUSTC_WRAPPER= cargo +"${WASM_COVERAGE_NIGHTLY}" llvm-cov test --no-clean --target wasm32-unknown-unknown --release -p nook-wasm --features browser-wasm-tests --fail-under-lines "$nook_wasm_floor" \
    && touch /opt/nook/wasm-coverage-passed

FROM scratch AS wasm-export

# Nest the companion package under the vault WASM handoff so the existing CI artifact path still
# carries both packages without changing upload destinations.
COPY --from=builder-wasm-build /opt/nook/wasm-handoff /nook-wasm

# Focused web/type-check tasks need the generated WASM packages, but not wasm clippy, wasm-pack
# tests, native coverage, or a production web build. Preserve the normal web-artifact shape with
# an intentionally empty coverage directory.
FROM builder-wasm-build AS focused-web-artifacts-source

RUN mkdir -p /opt/nook/empty-coverage

FROM scratch AS focused-web-artifacts

COPY --from=focused-web-artifacts-source /opt/nook/wasm-handoff /nook-wasm
COPY --from=focused-web-artifacts-source /opt/nook/empty-coverage /coverage

# Formatting is an independent validation leaf so `task format` can still load nook-rust and fix
# unformatted source. Normal `task setup` includes this target in its parallel prepare group.
FROM builder-debug AS rust-format-check

RUN cargo fmt --all -- --check

# Tiny host-export boundary for the web phase. `task setup` exports this scratch target to a
# temporary host directory, then gives only that directory to the final web build as a named
# context. The web solve never consumes or materializes the multi-GB builder-wasm snapshot.
FROM scratch AS web-artifacts

COPY --from=builder-wasm-handoff /opt/nook/wasm-handoff /nook-wasm
COPY --from=builder-debug /opt/nook/coverage /coverage
COPY --from=builder-wasm /opt/nook/wasm-coverage-passed /coverage/wasm-coverage-passed

# On-demand sealed Rust image for explicit `task rust:*`, `task wasm:*`, and Rust formatting
# commands. Normal setup/CI does not load this multi-GB image into Docker's runtime image store.
FROM builder-wasm-handoff AS nook-rust

WORKDIR /meta-secret/nook

COPY . .

RUN test -f nook-app/Taskfile.yml \
    && git init -q \
    && git config user.email nook@local \
    && git config user.name nook \
    && git add -A \
    && git commit -q -m "nook-rust source snapshot" >/dev/null

# Browser tooling is already present because hosted nook-wasm coverage exercises browser suites.
FROM builder-wasm AS nook-rust-browser
COPY --from=nook-rust /meta-secret/nook /meta-secret/nook

# -----------------------------------------------------------------------------

FROM rust-platform AS rust-ecosystem-deterministic

WORKDIR /meta-secret/nook/nook-app/nook-platform

RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    set -eux; \
    INSTA_UPDATE=no cargo test --locked -p nook-replication; \
    RUSTFLAGS='--cfg loom' cargo test --locked -p nook-replication loom_tests --release; \
    nook-sccache-report rust-ecosystem-deterministic

# -----------------------------------------------------------------------------

# Kani's compiler is not compatible with the ordinary rustc sccache wrapper.
# Keep its pinned toolchain source-free, then cache the complete proof solve in
# the dedicated mode=max BuildKit scope owned by the rust-kani Bake target.
FROM rust-base AS rust-kani-toolchain

ARG KANI_VERSION=0.67.0

RUN RUSTC_WRAPPER= cargo +stable install --locked \
      --version "${KANI_VERSION}" kani-verifier \
    && RUSTC_WRAPPER= cargo kani setup

FROM rust-kani-toolchain AS rust-kani

WORKDIR /meta-secret/nook
COPY nook-app/nook-platform/ nook-app/nook-platform/

WORKDIR /meta-secret/nook/nook-app/nook-platform
RUN RUSTC_WRAPPER= cargo kani --package nook-replication
