# syntax=docker/dockerfile:1.4

ARG RUST_VERSION=1.97
ARG DEBIAN_RELEASE=trixie
ARG RUST_DIGEST=sha256:1bcff4befb740599103a2c7cb51058e14479b2e35e3a34a3f0dc4ede09927488

FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS bun
FROM node:24-trixie-slim@sha256:ae91dcc111a68c9d2d81ff2a17bda61be126426176fde6fe7d08ab13b7f50573 AS node
FROM rust:${RUST_VERSION}-${DEBIAN_RELEASE}@${RUST_DIGEST} AS toolchain

ARG SCCACHE_VERSION=0.16.0
ARG SCCACHE_SHA256=aec995a83ad3dff3d14b6314e08858b7b73d35ca85a5bcf3d3a9ec07dee35588
ARG SCCACHE_S3_MODE=external
ARG SCCACHE_ENDPOINT=https://sccache.dev.nokey.sh
ARG SCCACHE_BUCKET=nook-sccache
ARG CARGO_CHEF_VERSION=0.1.77
ARG CARGO_CHEF_SHA256=a3733ab416c3ffddd37914cd13919ca05fee1a1cf654f3016dcfe7f399d89cd1

ENV CARGO_INCREMENTAL=0
ENV RUSTC_WRAPPER=/usr/local/bin/nook-sccache
ENV NOOK_SCCACHE_S3_MODE=${SCCACHE_S3_MODE}
ENV SCCACHE_ENDPOINT=${SCCACHE_ENDPOINT}
ENV SCCACHE_BUCKET=${SCCACHE_BUCKET}
ENV SCCACHE_REGION=auto
ENV SCCACHE_S3_USE_SSL=true
ENV SCCACHE_S3_KEY_PREFIX=nook-hive
ENV SCCACHE_IGNORE_SERVER_IO_ERROR=1
ENV SCCACHE_SERVER_UDS=/tmp/nook-hive-sccache.sock

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bubblewrap \
        ca-certificates \
        curl \
        gh \
        git \
        jq \
        openssh-client \
        patch \
        python3 \
        ripgrep \
        rsync \
        xz-utils \
    && rm -rf /var/lib/apt/lists/*

RUN rustup component add clippy rustfmt

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

COPY --from=nook-app sccache-wrapper.sh /usr/local/bin/nook-sccache
COPY --from=nook-app sccache-report.sh /usr/local/bin/nook-sccache-report
RUN chmod 0755 /usr/local/bin/nook-sccache /usr/local/bin/nook-sccache-report

RUN curl -fsSL \
      https://github.com/go-task/task/releases/download/v3.42.1/task_linux_amd64.tar.gz \
      -o /tmp/task.tar.gz \
    && printf '%s  %s\n' \
      05b41f97e655f56cc8a7617106622dbfb5f647d13ec6013ff7719bc80b52746c \
      /tmp/task.tar.gz \
      | sha256sum -c - \
    && tar -xzf /tmp/task.tar.gz -C /usr/local/bin task \
    && rm -f /tmp/task.tar.gz

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
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

WORKDIR /build

FROM toolchain AS chef-planner
COPY Cargo.toml Cargo.lock ./
COPY lace/Cargo.toml lace/Cargo.toml
COPY hive/Cargo.toml hive/Cargo.toml
RUN mkdir -p lace/src hive/src \
    && touch lace/src/lib.rs hive/src/main.rs
RUN cargo chef prepare --recipe-path recipe.json

FROM bun AS console-builder
WORKDIR /console
COPY hive-console/package.json hive-console/bun.lock ./
RUN bun install --frozen-lockfile
COPY hive-console/index.html hive-console/svelte.config.js hive-console/tsconfig.json hive-console/vite.config.ts ./
COPY hive-console/src src
COPY hive-console/locales locales
RUN bun run check \
    && bun run build

FROM bun AS console-formatter
WORKDIR /console
COPY hive-console/package.json hive-console/bun.lock ./
RUN bun install --frozen-lockfile
COPY hive-console/index.html hive-console/svelte.config.js hive-console/tsconfig.json hive-console/vite.config.ts hive-console/playwright.config.ts hive-console/.prettierrc ./
COPY hive-console/src src
COPY hive-console/locales locales
COPY hive-console/e2e e2e
COPY hive-console/PRODUCT.md hive-console/DESIGN.md ./
RUN bun run format

FROM toolchain AS fetched-dependencies
COPY Cargo.toml Cargo.lock ./
COPY lace/Cargo.toml lace/Cargo.toml
COPY hive/Cargo.toml hive/Cargo.toml
RUN mkdir -p lace/src hive/src \
    && touch lace/src/lib.rs hive/src/lib.rs hive/src/main.rs \
    && cargo fetch --locked

# Production image builds use a release-profile cargo-chef layer.
FROM fetched-dependencies AS dependencies
COPY --from=chef-planner /build/recipe.json recipe.json
RUN --mount=type=secret,id=sccache_s3_access_key,target=/run/secrets/sccache_s3_access_key,required=false --mount=type=secret,id=sccache_s3_secret_key,target=/run/secrets/sccache_s3_secret_key,required=false \
    cargo chef cook --release --recipe-path recipe.json \
    && nook-sccache-report hive-chef-release

# Verification needs Cargo's real test and Clippy fingerprints, not only the
# cargo-chef package versions. Build the two manifest-only graphs independently
# so BuildKit can materialize/link them in parallel. Main publishes both layers;
# pull requests compile only Hive and Lace source on top of the matching graph.
# Redis remains the compiler-object fallback while BuildKit preserves Cargo
# metadata and linked dependencies.
FROM fetched-dependencies AS test-dependencies
RUN --mount=type=secret,id=sccache_s3_access_key,target=/run/secrets/sccache_s3_access_key,required=false --mount=type=secret,id=sccache_s3_secret_key,target=/run/secrets/sccache_s3_secret_key,required=false \
    cargo test --locked -p hive --no-run \
    && nook-sccache-report hive-test-dependencies \
    && install -D /dev/null /opt/nook/hive-test-dependencies

FROM fetched-dependencies AS clippy-dependencies
RUN --mount=type=secret,id=sccache_s3_access_key,target=/run/secrets/sccache_s3_access_key,required=false --mount=type=secret,id=sccache_s3_secret_key,target=/run/secrets/sccache_s3_secret_key,required=false \
    printf 'fn main() {}\n' > hive/src/main.rs \
    && cargo clippy --locked -p hive --all-targets -- -D warnings \
    && nook-sccache-report hive-clippy-dependencies \
    && install -D /dev/null /opt/nook/hive-clippy-dependencies

FROM clippy-dependencies AS check-source
COPY lace/src lace/src
COPY hive/src hive/src
COPY hive/tests hive/tests
RUN find lace/src hive/src hive/tests -type f -exec touch {} +

FROM check-source AS check
RUN --mount=type=secret,id=sccache_s3_access_key,target=/run/secrets/sccache_s3_access_key,required=false --mount=type=secret,id=sccache_s3_secret_key,target=/run/secrets/sccache_s3_secret_key,required=false \
    cargo fmt --all -- --check \
    && cargo clippy --locked -p hive --all-targets -- -D warnings \
    && nook-sccache-report hive-clippy \
    && install -D /dev/null /opt/nook/hive-check-passed

FROM toolchain AS formatter
COPY Cargo.toml Cargo.lock ./
COPY lace/Cargo.toml lace/Cargo.toml
COPY hive/Cargo.toml hive/Cargo.toml
COPY lace/src lace/src
COPY hive/src hive/src
COPY hive/tests hive/tests
RUN cargo fmt --all

FROM test-dependencies AS test-source
COPY lace/src lace/src
COPY hive/src hive/src
COPY hive/tests hive/tests
RUN find lace/src hive/src hive/tests -type f -exec touch {} +

FROM test-source AS test-compile

# Compile tests inside BuildKit, but export only the executable artifacts. The
# Taskfile runs them in the pinned Rust base with normal container host
# networking, so Neo4j remains reachable without loading Cargo target layers.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN --mount=type=secret,id=sccache_s3_access_key,target=/run/secrets/sccache_s3_access_key,required=false --mount=type=secret,id=sccache_s3_secret_key,target=/run/secrets/sccache_s3_secret_key,required=false \
    mkdir -p /opt/nook/hive-tests \
    && cargo test --locked -p hive --no-run --message-format=json \
      > /tmp/hive-test-artifacts.jsonl \
    && jq -r \
      'select(.reason == "compiler-artifact" and .profile.test == true and .executable != null) | .executable' \
      /tmp/hive-test-artifacts.jsonl \
      | sort -u \
      | while IFS= read -r executable; do \
          destination="/opt/nook/hive-tests/$(basename "$executable")"; \
          install -m 0755 "$executable" "$destination"; \
          strip --strip-unneeded "$destination"; \
        done \
    && test -n "$(find /opt/nook/hive-tests -type f -perm /111 -print -quit)" \
    && nook-sccache-report hive-test-compile

FROM scratch AS test-export

COPY --from=test-compile /opt/nook/hive-tests /hive-tests

FROM toolchain AS sandbox-package-check

RUN test -x "$(command -v bwrap)" \
    && bwrap --version \
    && install -D /dev/null /opt/nook/hive-sandbox-package-passed

FROM scratch AS verify-export

COPY --from=check /opt/nook/hive-check-passed /hive-check-passed
COPY --from=test-export /hive-tests /hive-tests
COPY --from=sandbox-package-check /opt/nook/hive-sandbox-package-passed /hive-sandbox-package-passed

FROM dependencies AS release-source
COPY lace/src lace/src
COPY hive/src hive/src
RUN find lace/src hive/src -type f -exec touch {} +

FROM scratch AS cache-publish

COPY --from=dependencies /build/recipe.json /hive-release-recipe.json
COPY --from=test-dependencies /opt/nook/hive-test-dependencies /hive-test-dependencies
COPY --from=clippy-dependencies /opt/nook/hive-clippy-dependencies /hive-clippy-dependencies

FROM release-source AS builder
RUN --mount=type=secret,id=sccache_s3_access_key,target=/run/secrets/sccache_s3_access_key,required=false --mount=type=secret,id=sccache_s3_secret_key,target=/run/secrets/sccache_s3_secret_key,required=false \
    cargo build --locked --release -p hive \
    && nook-sccache-report hive-release

FROM toolchain AS runtime

RUN groupadd --gid 1000 hive \
    && useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash hive \
    && install -d -o hive -g hive /workspace

COPY --from=builder /build/target/release/hive /usr/local/bin/hive
COPY --from=console-builder /console/dist /usr/local/share/hive-console
COPY hive/docker/codex-linux-sandbox-no-proc.sh /usr/local/bin/hive-codex-linux-sandbox
RUN chmod 0755 /usr/local/bin/hive-codex-linux-sandbox

USER 1000:1000
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/hive"]
CMD ["worker"]
