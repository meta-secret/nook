# syntax=docker/dockerfile:1.4

FROM rust:1.96-bookworm AS build

WORKDIR /opt/nook/preflight
RUN rustup component add clippy rustfmt
COPY preflight/Cargo.toml preflight/Cargo.lock ./
COPY preflight/src src
COPY preflight/tests tests
RUN cargo fmt --check \
    && cargo clippy --locked --all-targets -- -D warnings \
    && cargo test --locked --no-run \
    && cargo build --locked --bin nook-preflight \
    && strip target/debug/nook-preflight

FROM build AS test

COPY . /meta-secret/nook
ENV NOOK_REPO_ROOT=/meta-secret/nook
RUN cargo test --locked

FROM scratch AS cli-export

COPY --from=build /opt/nook/preflight/target/debug/nook-preflight /nook-preflight
