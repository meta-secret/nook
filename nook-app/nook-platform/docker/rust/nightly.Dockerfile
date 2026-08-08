# syntax=docker/dockerfile:1.4

FROM rust-base AS rust-ecosystem-nightly

ARG DYLINT_NIGHTLY=nightly-2026-04-16
ARG CARGO_FUZZ_VERSION=0.13.2
ARG CARGO_FUZZ_SHA256=b5b704018b63e0f151c17a057ac53b5111e1db545d1b9f72fee79f08a545931c
ARG CARGO_DYLINT_VERSION=6.0.1

# cargo-fuzz has a usable release binary. cargo-dylint release binaries bake a
# CI-only driver path, so install the pinned crates once into this image layer.
RUN rustup toolchain install "${DYLINT_NIGHTLY}" \
      --component clippy,llvm-tools-preview,rustc-dev

RUN curl -fsSL \
      "https://github.com/rust-fuzz/cargo-fuzz/releases/download/${CARGO_FUZZ_VERSION}/cargo-fuzz-${CARGO_FUZZ_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
      -o /tmp/cargo-fuzz.tgz \
    && echo "${CARGO_FUZZ_SHA256}  /tmp/cargo-fuzz.tgz" | sha256sum -c - \
    && tar xzf /tmp/cargo-fuzz.tgz -C /tmp \
    && install -m 0755 /tmp/cargo-fuzz /usr/local/cargo/bin/cargo-fuzz \
    && rm -rf /tmp/cargo-fuzz.tgz /tmp/cargo-fuzz \
    && cargo fuzz --version

RUN cargo install cargo-dylint dylint-link \
      --version "${CARGO_DYLINT_VERSION}" --locked \
    && cargo dylint --version
