# syntax=docker/dockerfile:1.4

ARG RUST_IMAGE=rust:1.96-trixie
ARG NODE_IMAGE=node:24-trixie-slim
ARG CODEX_VERSION=0.144.4

FROM ${RUST_IMAGE} AS check

WORKDIR /opt/nook/meta-agent
RUN rustup component add clippy rustfmt
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo fmt --check \
    && cargo clippy --locked --all-targets -- -D warnings \
    && cargo test --locked

FROM check AS build

RUN cargo build --locked --release

FROM ${NODE_IMAGE} AS runtime

ARG CODEX_VERSION
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        git \
        ripgrep \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global "@openai/codex@${CODEX_VERSION}" \
    && codex --version \
    && npm cache clean --force

COPY --from=build /opt/nook/meta-agent/target/release/meta-agent /usr/local/bin/meta-agent

WORKDIR /workspace
ENTRYPOINT ["meta-agent"]
CMD ["--help"]
