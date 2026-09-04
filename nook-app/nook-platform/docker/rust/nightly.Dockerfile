# syntax=registry.dev.nokey.sh/docker/dockerfile:1.4

FROM rust-base AS rust-ecosystem-nightly

ARG DYLINT_NIGHTLY=nightly-2026-04-16
ARG CARGO_FUZZ_VERSION=0.13.2
ARG CARGO_FUZZ_SHA256=b5b704018b63e0f151c17a057ac53b5111e1db545d1b9f72fee79f08a545931c
ARG CARGO_DYLINT_VERSION=6.0.1

# cargo-fuzz has a usable release binary. cargo-dylint release binaries bake a
# CI-only driver path, so install the pinned crates once into this image layer.
RUN rustup toolchain install "${DYLINT_NIGHTLY}" \
      --component clippy,rustfmt,llvm-tools-preview,rustc-dev

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

FROM rust-ecosystem-nightly AS rust-dylint

ARG DYLINT_NIGHTLY=nightly-2026-04-16

WORKDIR /meta-secret/nook
COPY nook-app/nook-platform/ nook-app/nook-platform/

WORKDIR /meta-secret/nook/nook-app/nook-platform
ENV RUSTUP_TOOLCHAIN=${DYLINT_NIGHTLY}
ENV RUSTFLAGS="-D warnings"
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo fmt --manifest-path dylint/nook-domain-api/Cargo.toml -- --check \
    && rustfmt --edition 2024 --check dylint/nook-domain-api/ui/*.rs \
    && RUSTC_WRAPPER= RUSTFLAGS= cargo llvm-cov test -p nook_domain_api \
      --manifest-path dylint/nook-domain-api/Cargo.toml --locked --no-report \
    && set -- $(find target/llvm-cov-target dylint/nook-domain-api/target/llvm-cov-target -type f -name 'libnook_domain_api@*.so' -print) \
    && test "$#" -eq 1 && test -f "$1" \
    && ln "$1" "$(dirname "$1")/libnook_domain_api-c0ffee.so" \
    && cargo llvm-cov report -p nook_domain_api \
      --manifest-path dylint/nook-domain-api/Cargo.toml --locked --fail-under-lines 90 \
    && cargo clippy --manifest-path dylint/nook-domain-api/Cargo.toml --locked --all-targets -- -D warnings \
    && cargo dylint --all -- --all-targets \
    && nook-sccache-report rust-dylint

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
