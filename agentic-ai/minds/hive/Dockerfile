# syntax=docker/dockerfile:1.4

FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS bun
FROM node:24-trixie-slim@sha256:ae91dcc111a68c9d2d81ff2a17bda61be126426176fde6fe7d08ab13b7f50573 AS node
FROM lukemathwalker/cargo-chef:latest-rust-1.96-trixie@sha256:3a1dd6010466c1cf591607a75c6e144ba9f099e7f3790d595c6a611a9c78f387 AS cargo-chef
FROM rust:1.96-trixie@sha256:1f0dbad1df66647807e6952d1db85d0b2bda7606cb2139d82517e4f009967376 AS toolchain

ARG SCCACHE_VERSION=0.16.0
ARG SCCACHE_SHA256=aec995a83ad3dff3d14b6314e08858b7b73d35ca85a5bcf3d3a9ec07dee35588
ARG SCCACHE_REDIS_MODE=external
ARG SCCACHE_REDIS_ENDPOINT=rediss://redis-ovh-borg-1.bynull.link:6380

ENV CARGO_INCREMENTAL=0
ENV RUSTC_WRAPPER=/usr/local/bin/nook-sccache
ENV NOOK_SCCACHE_REDIS_MODE=${SCCACHE_REDIS_MODE}
ENV SCCACHE_REDIS_ENDPOINT=${SCCACHE_REDIS_ENDPOINT}
ENV SCCACHE_REDIS_KEY_PREFIX=nook-hive
ENV SCCACHE_IGNORE_SERVER_IO_ERROR=1
ENV SCCACHE_SERVER_UDS=/tmp/nook-hive-sccache.sock

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bubblewrap \
        ca-certificates \
        curl \
        git \
        jq \
        openssh-client \
        patch \
        python3 \
        ripgrep \
        rsync \
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

COPY --from=nook-app docker/sccache-wrapper.sh /usr/local/bin/nook-sccache
COPY --from=nook-app docker/sccache-report.sh /usr/local/bin/nook-sccache-report
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
COPY --from=cargo-chef /usr/local/cargo/bin/cargo-chef /usr/local/cargo/bin/cargo-chef

WORKDIR /build

FROM toolchain AS chef-planner
COPY Cargo.toml Cargo.lock ./
COPY lace/Cargo.toml lace/Cargo.toml
COPY hive/Cargo.toml hive/Cargo.toml
RUN mkdir -p lace/src hive/src \
    && touch lace/src/lib.rs hive/src/main.rs
RUN cargo chef prepare --recipe-path recipe.json

FROM toolchain AS fetched-dependencies
COPY Cargo.toml Cargo.lock ./
COPY lace/Cargo.toml lace/Cargo.toml
COPY hive/Cargo.toml hive/Cargo.toml
RUN mkdir -p lace/src hive/src \
    && touch lace/src/lib.rs hive/src/lib.rs hive/src/main.rs \
    && cargo fetch --locked

# Production image builds use a release-profile cargo-chef layer. Verification
# deliberately branches before this cook: Redis already supplies compiler
# objects, while waiting for a dummy cook and then compiling the real Clippy/test
# graphs serializes redundant Cargo work on every cold PR runner.
FROM fetched-dependencies AS dependencies
COPY --from=chef-planner /build/recipe.json recipe.json
RUN --mount=type=secret,id=sccache_redis_password,target=/run/secrets/sccache_redis_password,required=false \
    cargo chef cook --release --recipe-path recipe.json \
    && nook-sccache-report hive-chef-release

FROM fetched-dependencies AS source
COPY lace/src lace/src
COPY hive/src hive/src
RUN find lace/src hive/src -type f -exec touch {} +

FROM source AS check
RUN --mount=type=secret,id=sccache_redis_password,target=/run/secrets/sccache_redis_password,required=false \
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
RUN cargo fmt --all

FROM source AS test-compile

# Compile tests inside BuildKit, but export only the executable artifacts. The
# Taskfile runs them in the pinned Rust base with normal container host
# networking, so Neo4j remains reachable without loading Cargo target layers.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN --mount=type=secret,id=sccache_redis_password,target=/run/secrets/sccache_redis_password,required=false \
    mkdir -p /opt/nook/hive-tests \
    && cargo test --locked -p hive --no-run --message-format=json \
      | tee /tmp/hive-test-artifacts.jsonl \
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

FROM release-source AS builder
RUN --mount=type=secret,id=sccache_redis_password,target=/run/secrets/sccache_redis_password,required=false \
    cargo build --locked --release -p hive \
    && nook-sccache-report hive-release

FROM toolchain AS runtime

RUN groupadd --gid 1000 hive \
    && useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash hive \
    && install -d -o hive -g hive /workspace

COPY --from=builder /build/target/release/hive /usr/local/bin/hive

USER 1000:1000
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/hive"]
CMD ["worker"]
