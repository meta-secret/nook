# syntax=registry.dev.nokey.sh/docker/dockerfile:1.27.0@sha256:bde3983e9c939224420ddaf6b784cc30e09b035a4dea01f581230c50809f372e

# Rust foundation and product lineage. Dependencies and source leaves stay in
# this base Dockerfile so cache keys use stable internal stages across fresh
# builders.
# rust-platform overlays real platform sources on cooked builder-core-deps (one directory COPY).
# Focused nook-rust-* leaves and ecosystem deterministic extend internal stages.
# Other ecosystem gates live under ecosystem/ and consume rust-base through Bake.
# The web lineage lives under nook-web/docker and must not inherit Cargo target/ or the Rust toolchain.

# Pin floating registry tags by digest. Unpinned `rust` tags move under us and rewrite the
# rust-base digest, which orphans every downstream cargo-chef cook layer in the hosted GHA cache
# and forces PRs to redownload crates on an otherwise unchanged Cargo.lock.
FROM registry.dev.nokey.sh/library/rust:1.97-trixie@sha256:3382bd20aa942806c533e9a73cd000474fb3ef173f71e684cc9b942675781769 AS rust-base

# Pinned tool and service configuration is image-owned and cannot be overridden
# by an external build argument.
ENV TASK_VERSION=3.52.0
ENV WASM_PACK_VERSION=0.15.0
ENV LLVM_COV_VERSION=0.8.7
ENV SCCACHE_VERSION=0.17.0
ENV SCCACHE_SHA256=67c4a96dd237c1f518f6b36083f270f9976d516f1e57fce891755ea782e50006
ENV SCCACHE_S3_MODE=external
ENV SCCACHE_S3_RW_MODE=READ_WRITE
ENV SCCACHE_ENDPOINT=https://sccache.dev.nokey.sh
ENV SCCACHE_BUCKET=nook-sccache
# Binaryen (wasm-opt): pinned to a modern release so wasm-pack uses a correct, local wasm-opt.
# Debian's binaryen is too old (corrupts externref tables -> table.grow crash); baking it here also
# avoids wasm-pack downloading it from GitHub at build time (flaky, rate-limited).
ENV BINARYEN_VERSION=131
# Node binary only — required for wasm-pack test --node. Pin version + sha256 so rust-base does
# not track a floating Node image digest. npm/npx are intentionally omitted.
ENV NODE_VERSION=24.19.0
ENV NODE_SHA256=f625d97cd707df4ff96254916fbc5ff014f09c09effe5a1e0ca8f6d41a8789d4
# cargo-chef binary only — pin the musl release tarball instead of copying from a full
# Rust-based helper image just to obtain one CLI.
ENV CARGO_CHEF_VERSION=0.1.77
ENV CARGO_CHEF_SHA256=a3733ab416c3ffddd37914cd13919ca05fee1a1cf654f3016dcfe7f399d89cd1
# Cargo uses the default <workspace>/target (i.e. /meta-secret/nook/nook-app/nook-platform/target). The heavy
# target directory remains in the Rust lineage and local BuildKit cache, but is not inherited by
# the slim web image.
ENV CARGO_INCREMENTAL=0
ENV CARGO_NET_RETRY=10
ENV RUSTC_WRAPPER=/usr/local/bin/nook-sccache
ENV NOOK_SCCACHE_S3_MODE=external
ENV SCCACHE_REGION=auto
ENV SCCACHE_S3_USE_SSL=true
ENV SCCACHE_IGNORE_SERVER_IO_ERROR=1
# Keep compiler requests on the server-side sccache path. Client-side mode can
# leave concurrent remote storage requests waiting indefinitely; server-side
# statistics remain authoritative for publication verification.
ENV SCCACHE_CLIENT_SIDE=0
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
COPY nook-app/nook-platform/nook-wasm-composition-tests/Cargo.toml nook-wasm-composition-tests/Cargo.toml
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
      nook-wasm-composition-tests/src \
    && touch \
      nook-app-common/src/lib.rs \
      nook-authenticator-domain/src/lib.rs \
      nook-auth2/src/lib.rs \
      nook-replication/src/lib.rs \
      nook-event-log/src/lib.rs \
      nook-companion-core/src/lib.rs \
      nook-core/src/lib.rs \
      nook-companion-wasm/src/lib.rs \
      nook-wasm/src/lib.rs \
      nook-wasm-composition-tests/src/lib.rs
RUN cargo chef prepare --recipe-path recipe.json
RUN --network=default cargo fetch --locked
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo chef cook --release --target wasm32-unknown-unknown --recipe-path recipe.json \
    && nook-sccache-report chef-wasm-release
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo chef cook --release --clippy --target wasm32-unknown-unknown --recipe-path recipe.json \
    && nook-sccache-report chef-wasm-clippy
FROM chef-deps AS builder-wasm-deps
# Test compilation belongs to builder-wasm-tests, independent of PR static checks.

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
    cargo nextest run --no-run -p nook-wasm-composition-tests --profile ci \
    && nook-sccache-report native-composition-nextest-dependencies
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
ENV WASM_COVERAGE_NIGHTLY=nightly-2026-04-16
RUN rustup toolchain install "${WASM_COVERAGE_NIGHTLY}" --component llvm-tools-preview \
    && rustup target add --toolchain "${WASM_COVERAGE_NIGHTLY}" wasm32-unknown-unknown

# Node verification dependencies must remain independent of product source. This stage is included
# in the portable WASM dependency cache, so a fresh ARC node restores the nightly coverage graph,
# browser OS packages, Bun, Chromium, and chromedriver before any real Rust source is copied.
FROM wasm-coverage-toolchain AS builder-wasm-node-deps

ENV BUN_VERSION=1.3.14
ENV PLAYWRIGHT_VERSION=1.55.0
ENV PLAYWRIGHT_CHROMIUM_VERSION=140.0.7339.16
ENV PLAYWRIGHT_CHROMEDRIVER_SHA256=f40639ecc590adea9583a15066afd8e2e3e84173435dc4e31d9b01afcc41bd66
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
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo +"${WASM_COVERAGE_NIGHTLY}" llvm-cov clean --workspace \
    && eval "$(CARGO_TARGET_DIR=target/llvm-cov-target cargo +"${WASM_COVERAGE_NIGHTLY}" llvm-cov show-env --sh)" \
    && CARGO_TARGET_DIR=target/llvm-cov-target cargo +"${WASM_COVERAGE_NIGHTLY}" test --release -p nook-wasm --no-run
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    eval "$(CARGO_TARGET_DIR=target/llvm-cov-target cargo +"${WASM_COVERAGE_NIGHTLY}" llvm-cov show-env --sh --target wasm32-unknown-unknown)" \
    && CARGO_TARGET_DIR=target/llvm-cov-target CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER=true CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS="-Zno-profiler-runtime -Clink-args=--no-gc-sections --cfg=wasm_bindgen_unstable_test_coverage" cargo +"${WASM_COVERAGE_NIGHTLY}" test --target wasm32-unknown-unknown --release -p nook-wasm --features browser-wasm-tests --no-run
# Source overlay for bulk native leaves. Keep this after cook so builder-*-deps stay
# manifest-stable; platform tree edits invalidate only this stage and its consumers.
FROM builder-core-deps AS rust-platform

WORKDIR /meta-secret/nook
COPY nook-app/nook-platform/ nook-app/nook-platform/

# -----------------------------------------------------------------------------

# Clean dummy workspace coverage before the independent source/test DAG.
FROM builder-core-deps AS builder-native-source-base
RUN CARGO_LLVM_COV_DENY_WARNINGS=1 cargo llvm-cov clean --workspace

FROM builder-native-source-base AS builder-native-common-source
COPY --exclude=.cortex --exclude=docs --exclude=README* --exclude=docker-bake.hcl --exclude=Dockerfile* --exclude=coverage-floor.json nook-app/nook-platform/nook-app-common/ nook-app-common/
RUN find nook-app-common -type f -name '*.rs' -exec touch {} +

FROM builder-native-source-base AS builder-native-authenticator-source
COPY --exclude=.cortex --exclude=docs --exclude=README* --exclude=docker-bake.hcl --exclude=Dockerfile* --exclude=coverage-floor.json nook-app/nook-platform/nook-authenticator-domain/ nook-authenticator-domain/
RUN find nook-authenticator-domain -type f -name '*.rs' -exec touch {} +

FROM builder-native-source-base AS builder-native-replication-source
COPY --exclude=.cortex --exclude=docs --exclude=README* --exclude=docker-bake.hcl --exclude=Dockerfile* --exclude=coverage-floor.json nook-app/nook-platform/nook-replication/ nook-replication/
RUN find nook-replication -type f -name '*.rs' -exec touch {} +

FROM builder-native-common-source AS builder-native-auth2-source
COPY --from=builder-native-authenticator-source /meta-secret/nook/nook-app/nook-platform/nook-authenticator-domain/ nook-authenticator-domain/
COPY --exclude=.cortex --exclude=docs --exclude=README* --exclude=docker-bake.hcl --exclude=Dockerfile* --exclude=coverage-floor.json nook-app/nook-platform/nook-auth2/ nook-auth2/
RUN find nook-authenticator-domain nook-auth2 -type f -name '*.rs' -exec touch {} +

FROM builder-native-auth2-source AS builder-native-event-log-source
COPY --from=builder-native-replication-source /meta-secret/nook/nook-app/nook-platform/nook-replication/ nook-replication/
COPY --exclude=.cortex --exclude=docs --exclude=README* --exclude=docker-bake.hcl --exclude=Dockerfile* --exclude=coverage-floor.json nook-app/nook-platform/nook-event-log/ nook-event-log/
RUN find nook-replication nook-event-log -type f -name '*.rs' -exec touch {} +

FROM builder-native-event-log-source AS builder-native-companion-source
COPY --exclude=.cortex --exclude=docs --exclude=README* --exclude=docker-bake.hcl --exclude=Dockerfile* --exclude=coverage-floor.json nook-app/nook-platform/nook-companion-core/ nook-companion-core/
RUN find nook-companion-core -type f -name '*.rs' -exec touch {} +

FROM builder-native-companion-source AS builder-native-core-source
COPY --exclude=.cortex --exclude=docs --exclude=README* --exclude=docker-bake.hcl --exclude=Dockerfile* --exclude=coverage-floor.json nook-app/nook-platform/nook-core/ nook-core/
RUN find nook-core -type f -name '*.rs' -exec touch {} +

# Test results retain unique raw profiles, JUnit and executable coverage maps.
FROM builder-native-common-source AS builder-native-common-test
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo clippy --quiet --offline --locked --all-targets -p nook-app-common -- -D warnings \
    && cargo build --quiet --offline --locked -p nook-app-common \
    && LLVM_PROFILE_FILE_NAME='nook-app-common-%p-%m.profraw' cargo llvm-cov nextest --locked --no-report --profile ci -p nook-app-common \
    && nook-sccache-report native-app-common-coverage \
    && mkdir -p /opt/nook/native-test-artifacts/nook-app-common/profiles /opt/nook/native-test-artifacts/nook-app-common/objects \
    && cp target/llvm-cov-target/nook-app-common-*.profraw /opt/nook/native-test-artifacts/nook-app-common/profiles/ \
    && cp target/llvm-cov-target/nextest/ci/junit.xml /opt/nook/native-test-artifacts/nook-app-common/junit.xml \
    && find target/llvm-cov-target/debug -type f -perm /111 -exec cp --parents -t /opt/nook/native-test-artifacts/nook-app-common/objects/ {} + \
    && test -n "$(find /opt/nook/native-test-artifacts/nook-app-common/objects -type f -perm /111 -name 'nook_app_common-*' -print -quit)" \
    && find /opt/nook/native-test-artifacts/nook-app-common/profiles /opt/nook/native-test-artifacts/nook-app-common/objects -type f -printf '%p\t%s\n' > /opt/nook/native-test-artifacts/nook-app-common/artifact-files.tsv

FROM builder-native-authenticator-source AS builder-native-authenticator-test
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo clippy --quiet --offline --locked --all-targets -p nook-authenticator-domain -- -D warnings \
    && cargo build --quiet --offline --locked -p nook-authenticator-domain \
    && LLVM_PROFILE_FILE_NAME='nook-authenticator-domain-%p-%m.profraw' cargo llvm-cov nextest --locked --no-report --profile ci -p nook-authenticator-domain \
    && nook-sccache-report native-authenticator-domain-coverage \
    && mkdir -p /opt/nook/native-test-artifacts/nook-authenticator-domain/profiles /opt/nook/native-test-artifacts/nook-authenticator-domain/objects \
    && cp target/llvm-cov-target/nook-authenticator-domain-*.profraw /opt/nook/native-test-artifacts/nook-authenticator-domain/profiles/ \
    && cp target/llvm-cov-target/nextest/ci/junit.xml /opt/nook/native-test-artifacts/nook-authenticator-domain/junit.xml \
    && find target/llvm-cov-target/debug -type f -perm /111 -exec cp --parents -t /opt/nook/native-test-artifacts/nook-authenticator-domain/objects/ {} + \
    && test -n "$(find /opt/nook/native-test-artifacts/nook-authenticator-domain/objects -type f -perm /111 -name 'nook_authenticator_domain-*' -print -quit)" \
    && find /opt/nook/native-test-artifacts/nook-authenticator-domain/profiles /opt/nook/native-test-artifacts/nook-authenticator-domain/objects -type f -printf '%p\t%s\n' > /opt/nook/native-test-artifacts/nook-authenticator-domain/artifact-files.tsv

FROM builder-native-replication-source AS builder-native-replication-test
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo clippy --quiet --offline --locked --all-targets -p nook-replication -- -D warnings \
    && cargo build --quiet --offline --locked -p nook-replication \
    && INSTA_UPDATE=no LLVM_PROFILE_FILE_NAME='nook-replication-%p-%m.profraw' cargo llvm-cov nextest --locked --no-report --profile ci -p nook-replication \
    && nook-sccache-report native-replication-coverage \
    && mkdir -p /opt/nook/native-test-artifacts/nook-replication/profiles /opt/nook/native-test-artifacts/nook-replication/objects \
    && cp target/llvm-cov-target/nook-replication-*.profraw /opt/nook/native-test-artifacts/nook-replication/profiles/ \
    && cp target/llvm-cov-target/nextest/ci/junit.xml /opt/nook/native-test-artifacts/nook-replication/junit.xml \
    && find target/llvm-cov-target/debug -type f -perm /111 -exec cp --parents -t /opt/nook/native-test-artifacts/nook-replication/objects/ {} + \
    && test -n "$(find /opt/nook/native-test-artifacts/nook-replication/objects -type f -perm /111 -name 'nook_replication-*' -print -quit)" \
    && find /opt/nook/native-test-artifacts/nook-replication/profiles /opt/nook/native-test-artifacts/nook-replication/objects -type f -printf '%p\t%s\n' > /opt/nook/native-test-artifacts/nook-replication/artifact-files.tsv

FROM builder-native-auth2-source AS builder-native-auth2-test
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo clippy --quiet --offline --locked --all-targets -p nook-auth2 -- -D warnings \
    && cargo build --quiet --offline --locked -p nook-auth2 \
    && LLVM_PROFILE_FILE_NAME='nook-auth2-%p-%m.profraw' cargo llvm-cov nextest --locked --no-report --profile ci -p nook-auth2 \
    && cargo test --locked -p nook-auth2 --doc \
    && nook-sccache-report native-auth2-coverage \
    && mkdir -p /opt/nook/native-test-artifacts/nook-auth2/profiles /opt/nook/native-test-artifacts/nook-auth2/objects \
    && cp target/llvm-cov-target/nook-auth2-*.profraw /opt/nook/native-test-artifacts/nook-auth2/profiles/ \
    && cp target/llvm-cov-target/nextest/ci/junit.xml /opt/nook/native-test-artifacts/nook-auth2/junit.xml \
    && find target/llvm-cov-target/debug -type f -perm /111 -exec cp --parents -t /opt/nook/native-test-artifacts/nook-auth2/objects/ {} + \
    && test -n "$(find /opt/nook/native-test-artifacts/nook-auth2/objects -type f -perm /111 -name 'nook_auth2-*' -print -quit)" \
    && find /opt/nook/native-test-artifacts/nook-auth2/profiles /opt/nook/native-test-artifacts/nook-auth2/objects -type f -printf '%p\t%s\n' > /opt/nook/native-test-artifacts/nook-auth2/artifact-files.tsv

FROM builder-native-event-log-source AS builder-native-event-log-test
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo clippy --quiet --offline --locked --all-targets -p nook-event-log -- -D warnings \
    && cargo build --quiet --offline --locked -p nook-event-log \
    && LLVM_PROFILE_FILE_NAME='nook-event-log-%p-%m.profraw' cargo llvm-cov nextest --locked --no-report --profile ci -p nook-event-log \
    && nook-sccache-report native-event-log-coverage \
    && mkdir -p /opt/nook/native-test-artifacts/nook-event-log/profiles /opt/nook/native-test-artifacts/nook-event-log/objects \
    && cp target/llvm-cov-target/nook-event-log-*.profraw /opt/nook/native-test-artifacts/nook-event-log/profiles/ \
    && cp target/llvm-cov-target/nextest/ci/junit.xml /opt/nook/native-test-artifacts/nook-event-log/junit.xml \
    && find target/llvm-cov-target/debug -type f -perm /111 -exec cp --parents -t /opt/nook/native-test-artifacts/nook-event-log/objects/ {} + \
    && test -n "$(find /opt/nook/native-test-artifacts/nook-event-log/objects -type f -perm /111 -name 'nook_event_log-*' -print -quit)" \
    && find /opt/nook/native-test-artifacts/nook-event-log/profiles /opt/nook/native-test-artifacts/nook-event-log/objects -type f -printf '%p\t%s\n' > /opt/nook/native-test-artifacts/nook-event-log/artifact-files.tsv

FROM builder-native-companion-source AS builder-native-companion-test
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo clippy --quiet --offline --locked --all-targets -p nook-companion-core -- -D warnings \
    && cargo build --quiet --offline --locked -p nook-companion-core \
    && LLVM_PROFILE_FILE_NAME='nook-companion-core-%p-%m.profraw' cargo llvm-cov nextest --locked --no-report --profile ci -p nook-companion-core \
    && cargo test --locked -p nook-companion-core --doc \
    && nook-sccache-report native-companion-core-coverage \
    && mkdir -p /opt/nook/native-test-artifacts/nook-companion-core/profiles /opt/nook/native-test-artifacts/nook-companion-core/objects \
    && cp target/llvm-cov-target/nook-companion-core-*.profraw /opt/nook/native-test-artifacts/nook-companion-core/profiles/ \
    && cp target/llvm-cov-target/nextest/ci/junit.xml /opt/nook/native-test-artifacts/nook-companion-core/junit.xml \
    && find target/llvm-cov-target/debug -type f -perm /111 -exec cp --parents -t /opt/nook/native-test-artifacts/nook-companion-core/objects/ {} + \
    && test -n "$(find /opt/nook/native-test-artifacts/nook-companion-core/objects -type f -perm /111 -name 'nook_companion_core-*' -print -quit)" \
    && find /opt/nook/native-test-artifacts/nook-companion-core/profiles /opt/nook/native-test-artifacts/nook-companion-core/objects -type f -printf '%p\t%s\n' > /opt/nook/native-test-artifacts/nook-companion-core/artifact-files.tsv

FROM builder-native-core-source AS builder-native-core-test
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo clippy --quiet --offline --locked --all-targets -p nook-core -- -D warnings \
    && cargo build --quiet --offline --locked -p nook-core \
    && LLVM_PROFILE_FILE_NAME='nook-core-%p-%m.profraw' cargo llvm-cov nextest --locked --no-report --profile ci -p nook-core \
    && nook-sccache-report native-core-coverage \
    && mkdir -p /opt/nook/native-test-artifacts/nook-core/profiles /opt/nook/native-test-artifacts/nook-core/objects \
    && cp target/llvm-cov-target/nook-core-*.profraw /opt/nook/native-test-artifacts/nook-core/profiles/ \
    && cp target/llvm-cov-target/nextest/ci/junit.xml /opt/nook/native-test-artifacts/nook-core/junit.xml \
    && find target/llvm-cov-target/debug -type f -perm /111 -exec cp --parents -t /opt/nook/native-test-artifacts/nook-core/objects/ {} + \
    && test -n "$(find /opt/nook/native-test-artifacts/nook-core/objects -type f -perm /111 -name 'nook_core-*' -print -quit)" \
    && find /opt/nook/native-test-artifacts/nook-core/profiles /opt/nook/native-test-artifacts/nook-core/objects -type f -printf '%p\t%s\n' > /opt/nook/native-test-artifacts/nook-core/artifact-files.tsv

# LLVM merges every leaf's real profiles and namespaced executable maps using
# the same absolute sources/toolchain/flags, including downstream contributions.
FROM builder-native-core-source AS builder-debug
COPY --from=builder-native-common-test /opt/nook/native-test-artifacts/nook-app-common/profiles/*.profraw target/llvm-cov-target/
COPY --from=builder-native-common-test /opt/nook/native-test-artifacts/nook-app-common/objects/ target/llvm-cov-target/debug/native-tests/nook-app-common/
COPY --from=builder-native-authenticator-test /opt/nook/native-test-artifacts/nook-authenticator-domain/profiles/*.profraw target/llvm-cov-target/
COPY --from=builder-native-authenticator-test /opt/nook/native-test-artifacts/nook-authenticator-domain/objects/ target/llvm-cov-target/debug/native-tests/nook-authenticator-domain/
COPY --from=builder-native-replication-test /opt/nook/native-test-artifacts/nook-replication/profiles/*.profraw target/llvm-cov-target/
COPY --from=builder-native-replication-test /opt/nook/native-test-artifacts/nook-replication/objects/ target/llvm-cov-target/debug/native-tests/nook-replication/
COPY --from=builder-native-auth2-test /opt/nook/native-test-artifacts/nook-auth2/profiles/*.profraw target/llvm-cov-target/
COPY --from=builder-native-auth2-test /opt/nook/native-test-artifacts/nook-auth2/objects/ target/llvm-cov-target/debug/native-tests/nook-auth2/
COPY --from=builder-native-event-log-test /opt/nook/native-test-artifacts/nook-event-log/profiles/*.profraw target/llvm-cov-target/
COPY --from=builder-native-event-log-test /opt/nook/native-test-artifacts/nook-event-log/objects/ target/llvm-cov-target/debug/native-tests/nook-event-log/
COPY --from=builder-native-companion-test /opt/nook/native-test-artifacts/nook-companion-core/profiles/*.profraw target/llvm-cov-target/
COPY --from=builder-native-companion-test /opt/nook/native-test-artifacts/nook-companion-core/objects/ target/llvm-cov-target/debug/native-tests/nook-companion-core/
COPY --from=builder-native-core-test /opt/nook/native-test-artifacts/nook-core/profiles/*.profraw target/llvm-cov-target/
COPY --from=builder-native-core-test /opt/nook/native-test-artifacts/nook-core/objects/ target/llvm-cov-target/debug/native-tests/nook-core/
# Threshold-only edits reach this gate without invalidating any test result.
COPY nook-app/nook-platform/nook-core/coverage-floor.json nook-core/coverage-floor.json
RUN mkdir -p /opt/nook/coverage/nook-core \
    && coverage_status=0 \
    && for package in nook-app-common nook-authenticator-domain nook-auth2 nook-replication nook-event-log nook-companion-core nook-core; do \
         floor="$(jq -er --arg package "$package" '.package_lines_percent[$package] | numbers' nook-core/coverage-floor.json)" \
           && cargo llvm-cov report --failure-mode any -p "$package" --summary-only --fail-under-lines "$floor" || coverage_status=1; \
       done \
    && test "$coverage_status" -eq 0 \
    && cargo llvm-cov report --failure-mode any -p nook-core -p nook-app-common -p nook-authenticator-domain -p nook-auth2 -p nook-replication -p nook-event-log -p nook-companion-core --summary-only > /opt/nook/coverage/nook-core/summary.txt \
    && cargo llvm-cov report --failure-mode any -p nook-core -p nook-app-common -p nook-authenticator-domain -p nook-auth2 -p nook-replication -p nook-event-log -p nook-companion-core --json --summary-only > /opt/nook/coverage/nook-core/summary.json \
    && cargo llvm-cov report --failure-mode any -p nook-core -p nook-app-common -p nook-authenticator-domain -p nook-auth2 -p nook-replication -p nook-event-log -p nook-companion-core --lcov --output-path /opt/nook/coverage/nook-core/lcov.info \
    && cp nook-core/coverage-floor.json /opt/nook/coverage/nook-core/coverage-floor.json \
    && rm -rf target/llvm-cov-target

COPY nook-app/nook-platform/nook-companion-wasm nook-companion-wasm
COPY nook-app/nook-platform/nook-wasm nook-wasm
COPY nook-app/nook-platform/nook-wasm-composition-tests nook-wasm-composition-tests

# Retain only the small, already-computed coverage payload as a BuildKit target.
# PR verification uses it cache-only and never materializes a report artifact.
FROM scratch AS coverage-export
COPY --from=builder-debug /opt/nook/coverage/nook-core/ /

# Optional compact proof: JUnit and measured paths/sizes of real LLVM inputs.
FROM scratch AS native-test-evidence
COPY --from=builder-debug /opt/nook/coverage /coverage
COPY --from=builder-native-common-test --parents /opt/nook/native-test-artifacts/./nook-app-common/junit.xml /opt/nook/native-test-artifacts/./nook-app-common/artifact-files.tsv /native-tests/
COPY --from=builder-native-authenticator-test --parents /opt/nook/native-test-artifacts/./nook-authenticator-domain/junit.xml /opt/nook/native-test-artifacts/./nook-authenticator-domain/artifact-files.tsv /native-tests/
COPY --from=builder-native-replication-test --parents /opt/nook/native-test-artifacts/./nook-replication/junit.xml /opt/nook/native-test-artifacts/./nook-replication/artifact-files.tsv /native-tests/
COPY --from=builder-native-auth2-test --parents /opt/nook/native-test-artifacts/./nook-auth2/junit.xml /opt/nook/native-test-artifacts/./nook-auth2/artifact-files.tsv /native-tests/
COPY --from=builder-native-event-log-test --parents /opt/nook/native-test-artifacts/./nook-event-log/junit.xml /opt/nook/native-test-artifacts/./nook-event-log/artifact-files.tsv /native-tests/
COPY --from=builder-native-companion-test --parents /opt/nook/native-test-artifacts/./nook-companion-core/junit.xml /opt/nook/native-test-artifacts/./nook-companion-core/artifact-files.tsv /native-tests/
COPY --from=builder-native-core-test --parents /opt/nook/native-test-artifacts/./nook-core/junit.xml /opt/nook/native-test-artifacts/./nook-core/artifact-files.tsv /native-tests/

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
COPY nook-app/nook-platform/nook-wasm nook-wasm
COPY nook-app/nook-platform/nook-wasm-composition-tests nook-wasm-composition-tests
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo nextest run -p nook-companion-wasm -p nook-wasm-composition-tests --profile ci --no-run \
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

# Keep the source-free dependency graph common, but make package compiler leaves siblings. A package
# edit must not invalidate the other package's source COPY/RUN layer or its output stamp.
FROM builder-wasm-deps AS builder-wasm-source-base

ARG WASM_BUILD_MODE=dev

COPY nook-app/nook-platform/Cargo.toml nook-app/nook-platform/Cargo.lock ./
COPY nook-app/nook-platform/.config .config
COPY nook-app/nook-platform/clippy.toml clippy.toml
COPY nook-app/nook-platform/nook-app-common nook-app-common
COPY nook-app/nook-platform/nook-authenticator-domain nook-authenticator-domain
COPY nook-app/nook-platform/nook-auth2 nook-auth2
COPY nook-app/nook-platform/nook-replication nook-replication
COPY nook-app/nook-platform/nook-event-log nook-event-log
COPY nook-app/nook-platform/nook-companion-core nook-companion-core
COPY nook-app/nook-platform/nook-core nook-core

# Clippy and release-test branches require both package roots, while package export leaves remain
# independent below. Dummy roots inherited from builder-wasm-deps satisfy the other workspace member.
FROM builder-wasm-source-base AS builder-wasm-source
COPY nook-app/nook-platform/nook-companion-wasm nook-companion-wasm
COPY nook-app/nook-platform/nook-wasm nook-wasm

FROM builder-wasm-source-base AS builder-nook-wasm-source
COPY nook-app/nook-platform/nook-wasm nook-wasm
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    touch nook-app-common/src/i18n.rs \
    && cargo build --lib --release --target wasm32-unknown-unknown -p nook-wasm \
    && nook-sccache-report wasm-source-nook-wasm
FROM builder-wasm-source-base AS builder-companion-wasm-source
COPY nook-app/nook-platform/nook-companion-wasm nook-companion-wasm
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --lib --release --target wasm32-unknown-unknown -p nook-companion-wasm \
    && nook-sccache-report wasm-source-companion-wasm
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
FROM builder-nook-wasm-source AS builder-nook-wasm-build

# Emit nook-wasm independently; the companion package has its own source and compiler leaf below.
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --lib --release --target wasm32-unknown-unknown -p nook-wasm \
    && nook-sccache-report wasm-build-nook-wasm

# Keep wasm-pack's packaging-only compiler probes in a separate, mount-free vertex.
RUN case "$WASM_BUILD_MODE" in \
      prod) wasm_opt_flag="" && stamp_mode="optimized" ;; \
      dev) wasm_opt_flag="--no-opt" && stamp_mode="no-opt" ;; \
      *) echo "Unsupported WASM_BUILD_MODE=$WASM_BUILD_MODE (expected dev or prod)" >&2; exit 1 ;; \
    esac \
    && mkdir -p ../nook-web/nook-web-shared/src/vault-app/lib/nook-wasm \
    && RUSTC_WRAPPER= wasm-pack build nook-wasm --target web \
         --out-dir "/meta-secret/nook/nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm" \
         --out-name nook_wasm $wasm_opt_flag \
    && ( current="$(find Cargo.toml Cargo.lock \
           nook-wasm/Cargo.toml nook-wasm/src \
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
         && echo "$stamp_mode" > ../nook-web/nook-web-shared/src/vault-app/lib/nook-wasm/nook-wasm-build-mode \
         && mkdir -p /opt/nook/wasm-handoff \
         && cp -a ../nook-web/nook-web-shared/src/vault-app/lib/nook-wasm/. /opt/nook/wasm-handoff/ )
FROM builder-companion-wasm-source AS builder-companion-wasm-build

ARG WASM_BUILD_MODE=dev

RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --lib --release --target wasm32-unknown-unknown -p nook-companion-wasm \
    && nook-sccache-report wasm-build-companion-wasm

# Match the mount-free nook-wasm packaging boundary above.
RUN case "$WASM_BUILD_MODE" in \
      prod) wasm_opt_flag="" && stamp_mode="optimized" ;; \
      dev) wasm_opt_flag="--no-opt" && stamp_mode="no-opt" ;; \
      *) echo "Unsupported WASM_BUILD_MODE=$WASM_BUILD_MODE (expected dev or prod)" >&2; exit 1 ;; \
    esac \
    && mkdir -p ../nook-web/nook-web-shared/src/extension/nook-companion-wasm \
    && RUSTC_WRAPPER= wasm-pack build nook-companion-wasm --target web \
         --out-dir "/meta-secret/nook/nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm" \
         --out-name nook_companion_wasm $wasm_opt_flag \
    && ( current="$(find Cargo.toml Cargo.lock \
           nook-companion-wasm/Cargo.toml nook-companion-wasm/src \
           nook-companion-core/Cargo.toml nook-companion-core/src \
           \( -name '*.rs' -o -name '*.json' -o -name 'Cargo.toml' -o -name 'Cargo.lock' \) -print0 \
         | LC_ALL=C sort -z \
         | xargs -0 sha256sum \
         | sha256sum \
         | cut -d' ' -f1)" \
         && echo "$current $stamp_mode" > ../nook-web/nook-web-shared/src/extension/nook-companion-wasm/.wasm-source-sha256 \
         && mkdir -p /opt/nook/wasm-handoff/nook-companion-wasm \
         && cp -a ../nook-web/nook-web-shared/src/extension/nook-companion-wasm/. \
              /opt/nook/wasm-handoff/nook-companion-wasm/ )
FROM builder-nook-wasm-build AS builder-wasm-build

COPY --from=builder-companion-wasm-build \
    /meta-secret/nook/nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm \
    /meta-secret/nook/nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm
COPY --from=builder-companion-wasm-build \
    /opt/nook/wasm-handoff/nook-companion-wasm \
    /opt/nook/wasm-handoff/nook-companion-wasm

FROM builder-wasm-source AS builder-wasm-tests
# Match both wasm-pack test compile steps: `cargo build --tests` uses CARGO_BUILD_TARGET, while the
# later `cargo test` invocation passes `--target`. Warm both so the Node-test join stays Fresh.
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    CARGO_BUILD_TARGET=wasm32-unknown-unknown cargo build --tests --release -p nook-wasm -p nook-companion-wasm \
    && cargo test --release --target wasm32-unknown-unknown --no-run -p nook-wasm -p nook-companion-wasm \
    && nook-sccache-report wasm-release-tests
FROM builder-wasm-node-deps AS builder-wasm-test-base

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
FROM builder-wasm-test-base AS builder-wasm-handoff
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo +"${WASM_COVERAGE_NIGHTLY}" llvm-cov test --no-clean --release -p nook-wasm \
    && CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER=true CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS="-Zno-profiler-runtime -Clink-args=--no-gc-sections --cfg=wasm_bindgen_unstable_test_coverage" cargo +"${WASM_COVERAGE_NIGHTLY}" llvm-cov test --no-clean --target wasm32-unknown-unknown --release -p nook-wasm --features browser-wasm-tests \
    && nook-sccache-report wasm-node-test-and-coverage
# Package siblings keep private Cargo/coverage snapshots and compiler-only secrets.
FROM builder-wasm-test-base AS builder-companion-wasm-node-compiler
COPY nook-app/nook-platform/docker/rust/base/wasm-companion-verify.sh /opt/nook/wasm-companion-verify.sh
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    bash /opt/nook/wasm-companion-verify.sh
FROM builder-wasm-handoff AS builder-nook-wasm-browser-input
COPY nook-app/nook-platform/docker/rust/base/wasm-nook-verify.sh /opt/nook/wasm-nook-verify.sh
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    bash /opt/nook/wasm-nook-verify.sh prepare
FROM builder-nook-wasm-browser-input AS builder-nook-wasm-browser-manager
RUN bash /opt/nook/wasm-nook-verify.sh manager
FROM builder-nook-wasm-browser-input AS builder-nook-wasm-browser-rest
RUN bash /opt/nook/wasm-nook-verify.sh rest
FROM builder-nook-wasm-browser-input AS builder-nook-wasm-node-compiler
COPY --from=builder-nook-wasm-browser-manager /opt/nook/wasm-browser-profiles/manager-*.profraw ./target/llvm-cov-target/
COPY --from=builder-nook-wasm-browser-rest /opt/nook/wasm-browser-profiles/rest-*.profraw ./target/llvm-cov-target/
RUN bash /opt/nook/wasm-nook-verify.sh report
FROM builder-nook-wasm-node-compiler AS builder-wasm-node-compiler
COPY --from=builder-companion-wasm-node-compiler /opt/nook/wasm-companion-verified /opt/nook/wasm-companion-verified
FROM builder-wasm-handoff AS builder-wasm
COPY --from=builder-wasm-node-compiler /opt/nook/wasm-node-tests-passed /opt/nook/wasm-node-tests-passed
COPY --from=builder-wasm-node-compiler /opt/nook/wasm-bindgen-test-runner /opt/nook/wasm-bindgen-test-runner
COPY --from=builder-wasm-node-compiler /opt/nook/wasm-coverage-passed /opt/nook/wasm-coverage-passed

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
FROM rust-base AS rust-format-check
WORKDIR /meta-secret/nook/nook-app/nook-platform
COPY nook-app/nook-platform/ ./
RUN cargo fmt --all -- --check

# Native PR targets share portable tests; retain extra composition checks.
FROM builder-debug AS pr-rust-verify
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    find nook-companion-wasm nook-wasm nook-wasm-composition-tests -type f -name '*.rs' -exec touch {} + \
    && cargo clippy --quiet --offline --locked --all-targets -p nook-companion-wasm -p nook-wasm-composition-tests -- -D warnings \
    && nook-sccache-report pr-rust-verification
FROM scratch AS pr-wasm-artifacts
COPY --from=builder-wasm-build /opt/nook/wasm-handoff /nook-wasm
COPY --from=builder-wasm-clippy /opt/nook/wasm-clippy-passed /coverage/wasm-clippy-passed

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

FROM nook-rust-browser AS wasm-browser-dev
WORKDIR /meta-secret/nook
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    CI=1 task _wasm:test:browser \
    && nook-sccache-report --require wasm-browser-dev

# -----------------------------------------------------------------------------

FROM rust-platform AS rust-ecosystem-deterministic

WORKDIR /meta-secret/nook/nook-app/nook-platform

# Only the PR caller with mandatory native coverage may omit duplicate unit tests.
ARG NATIVE_COVERAGE_PROVIDED=false
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    set -eux; \
    case "$NATIVE_COVERAGE_PROVIDED" in \
      true) INSTA_UPDATE=no cargo test --locked -p nook-replication --doc ;; \
      false) INSTA_UPDATE=no cargo test --locked -p nook-replication ;; \
      *) echo 'NATIVE_COVERAGE_PROVIDED must be true or false' >&2; exit 1 ;; \
    esac; \
    RUSTFLAGS='--cfg loom' cargo test --locked -p nook-replication loom_tests --release; \
    nook-sccache-report rust-ecosystem-deterministic

# -----------------------------------------------------------------------------

# Kani's compiler is not compatible with the ordinary rustc sccache wrapper.
# Keep its pinned toolchain source-free, then cache the complete proof solve in
# the dedicated mode=max BuildKit scope owned by the rust-kani Bake target.
FROM rust-base AS rust-kani-toolchain

ENV KANI_VERSION=0.67.0

RUN RUSTC_WRAPPER= cargo +stable install --locked \
      --version "${KANI_VERSION}" kani-verifier \
    && RUSTC_WRAPPER= cargo kani setup

FROM rust-kani-toolchain AS rust-kani

WORKDIR /meta-secret/nook
COPY nook-app/nook-platform/ nook-app/nook-platform/

WORKDIR /meta-secret/nook/nook-app/nook-platform
RUN RUSTC_WRAPPER= timeout --kill-after=10s 3m cargo kani --package nook-replication
