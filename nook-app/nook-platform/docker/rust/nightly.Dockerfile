# syntax=registry.dev.nokey.sh/docker/dockerfile:1.27.0@sha256:bde3983e9c939224420ddaf6b784cc30e09b035a4dea01f581230c50809f372e

FROM rust-base AS rust-ecosystem-nightly

ARG DYLINT_NIGHTLY=nightly-2026-04-16
ARG CARGO_FUZZ_VERSION=0.13.2
ARG CARGO_FUZZ_SHA256=b5b704018b63e0f151c17a057ac53b5111e1db545d1b9f72fee79f08a545931c
ARG CARGO_DYLINT_VERSION=6.0.1
ARG NOOK_SCCACHE_TELEMETRY_REPLAY=disabled

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

RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo install cargo-dylint dylint-link \
      --version "${CARGO_DYLINT_VERSION}" --locked \
    && cargo dylint --version

# Keep the wrapper and reporter in this Dockerfile's own input graph. The
# rust-base named context may be restored from a separate cache lineage;
# copying the current repository files here makes their content part of the
# nightly/Dylint ancestor key and propagates the resulting image into every
# compiler vertex below without invalidating the toolchain installs above.
COPY nook-app/nook-platform/docker/sccache-wrapper.sh /usr/local/bin/nook-sccache
COPY nook-app/nook-platform/docker/sccache-report.sh /usr/local/bin/nook-sccache-report
RUN chmod 0755 /usr/local/bin/nook-sccache /usr/local/bin/nook-sccache-report

FROM rust-ecosystem-nightly AS rust-dylint-deps

ARG DYLINT_NIGHTLY=nightly-2026-04-16

WORKDIR /meta-secret/nook/nook-app/nook-platform
COPY nook-app/nook-platform/.cargo .cargo
COPY nook-app/nook-platform/.config .config
COPY nook-app/nook-platform/clippy.toml clippy.toml
COPY nook-app/nook-platform/Cargo.toml nook-app/nook-platform/Cargo.lock ./
COPY nook-app/nook-platform/nook-app-common/Cargo.toml nook-app-common/Cargo.toml
COPY nook-app/nook-platform/nook-authenticator-domain/Cargo.toml nook-authenticator-domain/Cargo.toml
COPY nook-app/nook-platform/nook-auth2/Cargo.toml nook-auth2/Cargo.toml
COPY nook-app/nook-platform/nook-replication/Cargo.toml nook-replication/Cargo.toml
COPY nook-app/nook-platform/nook-event-log/Cargo.toml nook-event-log/Cargo.toml
COPY nook-app/nook-platform/nook-companion-core/Cargo.toml nook-companion-core/Cargo.toml
COPY nook-app/nook-platform/nook-core/Cargo.toml nook-core/Cargo.toml
COPY nook-app/nook-platform/nook-companion-wasm/Cargo.toml nook-companion-wasm/Cargo.toml
COPY nook-app/nook-platform/nook-wasm/Cargo.toml nook-wasm/Cargo.toml
COPY nook-app/nook-platform/nook-wasm-composition-tests/Cargo.toml nook-wasm-composition-tests/Cargo.toml
COPY nook-app/nook-platform/dylint/nook-domain-api/Cargo.toml dylint/nook-domain-api/Cargo.toml
COPY nook-app/nook-platform/dylint/nook-domain-api/Cargo.lock dylint/nook-domain-api/Cargo.lock
RUN mkdir -p \
      nook-app-common/src \
      nook-authenticator-domain/src \
      nook-auth2/src \
      nook-replication/src \
      nook-event-log/src \
      nook-companion-core/src \
      nook-core/src \
      nook-companion-wasm/src \
      nook-wasm/src \
      nook-wasm-composition-tests/src \
      dylint/nook-domain-api/src \
    && touch \
      nook-app-common/src/lib.rs \
      nook-authenticator-domain/src/lib.rs \
      nook-auth2/src/lib.rs \
      nook-replication/src/lib.rs \
      nook-event-log/src/lib.rs \
      nook-companion-core/src/lib.rs \
      nook-core/src/lib.rs \
      nook-companion-wasm/src/lib.rs \
      nook-wasm/src/lib.rs \
      nook-wasm-composition-tests/src/lib.rs \
      dylint/nook-domain-api/src/lib.rs
ENV RUSTUP_TOOLCHAIN=${DYLINT_NIGHTLY}
RUN cargo fetch --locked \
    && cargo fetch --manifest-path dylint/nook-domain-api/Cargo.toml --locked
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --manifest-path dylint/nook-domain-api/Cargo.toml --locked

FROM rust-dylint-deps AS rust-dylint-build

ARG DYLINT_NIGHTLY=nightly-2026-04-16
ARG RUST_DYLINT_COVERAGE_FLOOR

WORKDIR /meta-secret/nook/nook-app/nook-platform
COPY nook-app/nook-platform/dylint/nook-domain-api/ dylint/nook-domain-api/
ENV RUSTUP_TOOLCHAIN=${DYLINT_NIGHTLY}
ENV RUSTFLAGS="-D warnings"
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --manifest-path dylint/nook-domain-api/Cargo.toml --locked

# Compile the product dependency graphs against manifest-only dummy crates.
# Mutable product sources are copied only after these native and WASM layers,
# so an application edit does not redownload or rebuild the full graph.
FROM rust-dylint-build AS rust-dylint-product-deps
RUN rustup target add wasm32-unknown-unknown
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo dylint --all -- --locked --all-targets \
      -p nook-app-common -p nook-authenticator-domain -p nook-auth2 \
      -p nook-replication -p nook-event-log -p nook-companion-core -p nook-core
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo dylint --all -- --locked --target wasm32-unknown-unknown --all-targets \
      -p nook-wasm -p nook-companion-wasm -p nook-wasm-composition-tests

FROM rust-dylint-build AS rust-dylint-self-test
ARG RUST_DYLINT_COVERAGE_FLOOR
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo fmt --manifest-path dylint/nook-domain-api/Cargo.toml -- --check \
    && rustfmt --edition 2024 --check dylint/nook-domain-api/ui/*.rs \
    && RUSTC_WRAPPER= RUSTFLAGS= cargo llvm-cov test -p nook_domain_api \
      --manifest-path dylint/nook-domain-api/Cargo.toml --locked --no-report \
    && toolchain_id="$(rustup show active-toolchain | cut -d' ' -f1)" \
    && test -n "$toolchain_id" \
    && lint_object="dylint/nook-domain-api/target/debug/libnook_domain_api@${toolchain_id}.so" \
    && test -f "$lint_object" \
    && ln "$lint_object" dylint/nook-domain-api/target/llvm-cov-target/debug/libnook_domain_api-c0ffee.so \
    && cargo llvm-cov report -p nook_domain_api --manifest-path dylint/nook-domain-api/Cargo.toml \
      --locked --fail-under-lines "${RUST_DYLINT_COVERAGE_FLOOR:?}" \
    && cargo clippy --manifest-path dylint/nook-domain-api/Cargo.toml --locked --all-targets -- -D warnings \
    && nook-sccache-report rust-dylint-self-test
ARG NOOK_SCCACHE_TELEMETRY_REPLAY
RUN if [ "$NOOK_SCCACHE_TELEMETRY_REPLAY" != disabled ]; then nook-sccache-report --replay rust-dylint-self-test; fi

FROM rust-dylint-product-deps AS rust-dylint-native

WORKDIR /meta-secret/nook
COPY nook-app/nook-platform/ nook-app/nook-platform/

WORKDIR /meta-secret/nook/nook-app/nook-platform
RUN find \
      nook-app-common nook-authenticator-domain nook-auth2 nook-replication \
      nook-event-log nook-companion-core nook-core nook-companion-wasm \
      nook-wasm nook-wasm-composition-tests \
      -type f -name '*.rs' -exec touch {} +
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo dylint --all -- --locked --all-targets \
      -p nook-app-common -p nook-authenticator-domain -p nook-auth2 \
      -p nook-replication -p nook-event-log -p nook-companion-core -p nook-core \
    && nook-sccache-report rust-dylint-native
ARG NOOK_SCCACHE_TELEMETRY_REPLAY
RUN if [ "$NOOK_SCCACHE_TELEMETRY_REPLAY" != disabled ]; then nook-sccache-report --replay rust-dylint-native; fi

FROM rust-dylint-native AS rust-dylint-wasm
WORKDIR /meta-secret/nook/nook-app/nook-platform
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo dylint --all -- --locked --target wasm32-unknown-unknown --all-targets \
      -p nook-wasm -p nook-companion-wasm -p nook-wasm-composition-tests \
    && nook-sccache-report rust-dylint-wasm
ARG NOOK_SCCACHE_TELEMETRY_REPLAY
RUN if [ "$NOOK_SCCACHE_TELEMETRY_REPLAY" != disabled ]; then nook-sccache-report --replay rust-dylint-wasm; fi

FROM rust-dylint-native AS rust-dylint
COPY --from=rust-dylint-self-test /meta-secret/nook/nook-app/nook-platform/dylint/nook-domain-api/Cargo.toml /tmp/dylint-self-tested.toml
COPY --from=rust-dylint-wasm /meta-secret/nook/nook-app/nook-platform/Cargo.toml /tmp/dylint-wasm-checked.toml

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
