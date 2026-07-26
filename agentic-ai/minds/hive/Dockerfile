FROM docker:28.5.1-cli@sha256:9190b0613792e658a7783cf14b2d5ace5941bb68ede7276922ea36ee457d76ad AS docker-cli
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS bun
FROM node:24-trixie-slim@sha256:ae91dcc111a68c9d2d81ff2a17bda61be126426176fde6fe7d08ab13b7f50573 AS node
FROM rust:1.96.0-bookworm@sha256:5e2214abe154fe26e39f64488952e5c991eeed1d6d6da7cc8381ae83927f0cfc AS toolchain

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        jq \
        openssh-client \
        patch \
        python3 \
        ripgrep \
    && rm -rf /var/lib/apt/lists/*

RUN rustup component add clippy rustfmt

RUN curl -fsSL \
      https://github.com/go-task/task/releases/download/v3.42.1/task_linux_amd64.tar.gz \
      -o /tmp/task.tar.gz \
    && printf '%s  %s\n' \
      05b41f97e655f56cc8a7617106622dbfb5f647d13ec6013ff7719bc80b52746c \
      /tmp/task.tar.gz \
      | sha256sum -c - \
    && tar -xzf /tmp/task.tar.gz -C /usr/local/bin task \
    && rm -f /tmp/task.tar.gz

COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=node /usr/local/bin/node /usr/local/bin/node

WORKDIR /build

FROM toolchain AS source
COPY Cargo.toml Cargo.lock ./
COPY lace/Cargo.toml lace/Cargo.toml
COPY hive/Cargo.toml hive/Cargo.toml
COPY lace/src lace/src
COPY hive/src hive/src

FROM source AS check
RUN cargo fmt --all -- --check \
    && cargo clippy --locked -p hive --all-targets -- -D warnings

FROM source AS formatter
RUN cargo fmt --all

FROM check AS test-runner
CMD ["cargo", "test", "--locked", "-p", "hive"]

FROM source AS builder
RUN cargo build --locked --release -p hive

FROM toolchain

RUN groupadd --gid 1000 hive \
    && useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash hive

COPY --from=builder /build/target/release/hive /usr/local/bin/hive

USER 1000:1000
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/hive"]
CMD ["worker"]
