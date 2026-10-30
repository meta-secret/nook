# syntax=registry.dev.nokey.sh/docker/dockerfile:1.27.0@sha256:bde3983e9c939224420ddaf6b784cc30e09b035a4dea01f581230c50809f372e

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
