# syntax=registry.dev.nokey.sh/docker/dockerfile:1.4

# Reuses the shared rust-base Bake target (pinned Rust, sccache, cargo-chef).
# Dependency cooks stay cacheable across source-only preflight edits.

FROM rust-base AS chef

ENV CARGO_TARGET_DIR=/meta-secret/preflight-target
WORKDIR /meta-secret/nook/preflight
COPY preflight/Cargo.toml preflight/Cargo.lock ./
RUN mkdir -p src \
    && printf 'fn main() {}\n' > src/main.rs \
    && printf '\n' > src/lib.rs
RUN cargo chef prepare --recipe-path recipe.json

FROM rust-base AS deps

ENV CARGO_TARGET_DIR=/meta-secret/preflight-target
WORKDIR /meta-secret/nook/preflight
COPY --from=chef /meta-secret/nook/preflight/recipe.json recipe.json
COPY preflight/Cargo.toml preflight/Cargo.lock ./
RUN mkdir -p src \
    && printf 'fn main() {}\n' > src/main.rs \
    && printf '\n' > src/lib.rs
RUN --network=default cargo fetch --locked
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo chef cook --recipe-path recipe.json \
    && cargo chef cook --tests --recipe-path recipe.json \
    && cargo chef cook --clippy --recipe-path recipe.json \
    && nook-sccache-report preflight-chef

FROM deps AS build

COPY preflight/src src
COPY preflight/tests tests
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo fmt --check \
    && cargo clippy --locked --all-targets -- -D warnings \
    && cargo test --locked --no-run \
    && cargo build --locked --bin nook-preflight \
    && strip /meta-secret/preflight-target/debug/nook-preflight \
    && nook-sccache-report preflight-build

FROM build AS test

COPY --from=repository-source / /meta-secret/nook
ENV NOOK_REPO_ROOT=/meta-secret/nook
ENV NOOK_REPOSITORY_SOURCE_CONTEXT=1
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    floor="$(jq -er '.package_lines_percent["nook-preflight"] | numbers' /meta-secret/nook/nook-app/nook-platform/nook-core/coverage-floor.json)" \
    && cargo llvm-cov test --locked -p nook-preflight --fail-under-lines "$floor" \
    && nook-sccache-report preflight-test-and-coverage

FROM scratch AS cli-export

COPY --from=build /meta-secret/preflight-target/debug/nook-preflight /nook-preflight
