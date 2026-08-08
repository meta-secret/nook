# syntax=docker/dockerfile:1.4

FROM rust-ecosystem-nightly AS rust-dylint

ARG DYLINT_NIGHTLY=nightly-2026-04-16

WORKDIR /meta-secret/nook
COPY nook-app/nook-platform/ nook-app/nook-platform/

WORKDIR /meta-secret/nook/nook-app/nook-platform
ENV RUSTUP_TOOLCHAIN=${DYLINT_NIGHTLY}
ENV RUSTFLAGS="-D warnings"
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo dylint --all -- --all-targets \
    && nook-sccache-report rust-dylint
