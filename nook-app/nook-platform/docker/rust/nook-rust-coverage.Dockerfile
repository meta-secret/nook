# syntax=docker/dockerfile:1.4

# Per-crate COPY+RUN so a single crate edit reuses earlier coverage layers.
# rust-platform's bulk COPY cannot do that — any source change busts every RUN.
FROM builder-core-deps AS nook-rust-coverage

WORKDIR /meta-secret/nook/nook-app/nook-platform

COPY nook-app/nook-platform/Cargo.toml nook-app/nook-platform/Cargo.lock ./
COPY nook-app/nook-platform/.cargo .cargo
COPY nook-app/nook-platform/.config .config
COPY nook-app/nook-platform/clippy.toml clippy.toml

COPY nook-app/nook-platform/nook-app-common nook-app-common
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    touch nook-app-common/src/i18n.rs \
    && cargo llvm-cov nextest --no-clean --profile ci -p nook-app-common --summary-only \
    && nook-sccache-report focused-rust-coverage-app-common

COPY nook-app/nook-platform/nook-auth2 nook-auth2
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo llvm-cov nextest --no-clean --profile ci -p nook-auth2 --summary-only \
    && nook-sccache-report focused-rust-coverage-auth2

COPY nook-app/nook-platform/nook-replication nook-replication
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo llvm-cov nextest --no-clean --profile ci -p nook-replication --summary-only \
    && nook-sccache-report focused-rust-coverage-replication

COPY nook-app/nook-platform/nook-event-log nook-event-log
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo llvm-cov nextest --no-clean --profile ci -p nook-event-log --summary-only \
    && nook-sccache-report focused-rust-coverage-event-log

COPY nook-app/nook-platform/nook-companion-core nook-companion-core
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo llvm-cov nextest --no-clean --profile ci -p nook-companion-core --summary-only \
    && nook-sccache-report focused-rust-coverage-companion-core

COPY nook-app/nook-platform/nook-core nook-core
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo llvm-cov nextest --no-clean --profile ci -p nook-core --summary-only \
    && nook-sccache-report focused-rust-coverage-compile

# The full checkout is runtime input only and cannot invalidate the compile layers above.
WORKDIR /meta-secret/nook
COPY . .

RUN test -f nook-app/Taskfile.yml \
    && git init -q \
    && git config user.email nook@local \
    && git config user.name nook \
    && git add -A \
    && git commit -q -m "nook-rust-coverage source snapshot" >/dev/null
