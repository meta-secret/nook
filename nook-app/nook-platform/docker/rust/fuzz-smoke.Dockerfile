# syntax=docker/dockerfile:1.4

FROM rust-ecosystem-nightly AS rust-fuzz-smoke

ARG FUZZ_SECONDS=20
ARG DYLINT_NIGHTLY=nightly-2026-04-16

WORKDIR /meta-secret/nook
COPY nook-app/nook-platform/ nook-app/nook-platform/

WORKDIR /meta-secret/nook/nook-app/nook-platform
ENV RUSTUP_TOOLCHAIN=${DYLINT_NIGHTLY}

RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo clippy --manifest-path fuzz/Cargo.toml \
      --locked --target x86_64-unknown-linux-gnu --all-targets -- -D warnings

RUN cargo metadata --manifest-path fuzz/Cargo.toml \
      --locked --format-version 1 --no-deps >/dev/null

RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo fuzz run --fuzz-dir fuzz \
      --target x86_64-unknown-linux-gnu \
      wire-parsers -- -max_total_time="${FUZZ_SECONDS}" \
    && nook-sccache-report rust-fuzz-smoke
