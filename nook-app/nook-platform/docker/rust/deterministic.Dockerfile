# syntax=docker/dockerfile:1.4

FROM rust-platform AS rust-ecosystem-deterministic

WORKDIR /meta-secret/nook/nook-app/nook-platform

RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    set -eux; \
    INSTA_UPDATE=no cargo test --locked -p nook-replication; \
    RUSTFLAGS='--cfg loom' cargo test --locked -p nook-replication loom_tests --release; \
    nook-sccache-report rust-ecosystem-deterministic
