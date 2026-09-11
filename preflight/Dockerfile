# syntax=registry.dev.nokey.sh/docker/dockerfile:1.27.0@sha256:bde3983e9c939224420ddaf6b784cc30e09b035a4dea01f581230c50809f372e

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

# Prewarm the coverage-instrumented dependency graph against dummy crate roots.
# The final coverage run receives the complete repository as runtime input, so
# it must not clean and reconstruct third-party dependencies on every source edit.
FROM deps AS coverage-deps

RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo llvm-cov clean --workspace \
    && eval "$(CARGO_TARGET_DIR=/meta-secret/preflight-target/llvm-cov-target cargo llvm-cov show-env --sh)" \
    && CARGO_TARGET_DIR=/meta-secret/preflight-target/llvm-cov-target cargo test --locked -p nook-preflight --no-run \
    && nook-sccache-report preflight-coverage-dependencies

FROM coverage-deps AS build

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
    && cargo llvm-cov test --locked --no-clean -p nook-preflight --fail-under-lines "$floor" \
    && nook-sccache-report preflight-test-and-coverage

FROM scratch AS cli-export

COPY --from=build /meta-secret/preflight-target/debug/nook-preflight /nook-preflight

# Policy uses the same compiled preflight graph as product validation. Rust,
# including Cargo metadata discovery and formatter fixtures, stays in BuildKit.
FROM registry.dev.nokey.sh/oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS policy-bun

FROM deps AS policy-tools
COPY --from=policy-bun /usr/local/bin/bun /usr/local/bin/bun
RUN curl -fsSL https://github.com/vale-cli/vale/releases/download/v3.19.0/vale_3.19.0_Linux_64-bit.tar.gz -o /tmp/vale.tar.gz \
    && echo 'c8f9d6c8055442bc7e9c121b2498e6f0e3fb670f4665e6ee577f1897f7665cf6  /tmp/vale.tar.gz' | sha256sum -c - \
    && tar -xzf /tmp/vale.tar.gz -C /usr/local/bin vale \
    && rm /tmp/vale.tar.gz \
    && vale --version
WORKDIR /meta-secret/nook
ENV REPO_ROOT=/meta-secret/nook NOOK_REPO_ROOT=/meta-secret/nook NOOK_REPOSITORY_SOURCE_CONTEXT=1
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY agentic-ai/loom/package.json agentic-ai/loom/bun.lock ./agentic-ai/loom/
RUN bun install --cwd agentic-ai/loom --frozen-lockfile

FROM policy-tools AS policy-source
COPY --from=repository-source / /meta-secret/nook
COPY --from=repository-git /git /meta-secret/nook/.git
COPY --from=repository-git /event.json /tmp/policy-event.json
ENV GITHUB_EVENT_PATH=/tmp/policy-event.json

FROM policy-source AS loom-verify
RUN task loom:verify

FROM loom-verify AS repository-policy
RUN task preflight:format-contract \
    && task loom:cortex-audit
# The full preflight/coverage solve is shared with preflight-test, not repeated.
COPY --from=test /meta-secret/nook/preflight/Cargo.toml /tmp/preflight-verified.toml

FROM policy-source AS source-architecture
RUN cargo test --locked --manifest-path preflight/Cargo.toml --test source_file_size --test repository_languages

FROM policy-source AS typescript-state
RUN cargo test --locked --manifest-path preflight/Cargo.toml --test core_ownership typescript_

FROM policy-source AS loom-contracts
RUN cargo test --locked --manifest-path preflight/Cargo.toml --test loom_contracts --test skill_authority

FROM loom-verify AS repository-policy-untrusted
RUN task preflight:format-contract \
    && cargo test --locked --manifest-path preflight/Cargo.toml --test source_file_size --test repository_languages --test loom_contracts --test skill_authority \
    && cargo test --locked --manifest-path preflight/Cargo.toml --test core_ownership typescript_ \
    && task loom:cortex-audit
