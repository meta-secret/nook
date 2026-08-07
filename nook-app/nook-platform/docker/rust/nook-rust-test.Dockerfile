# syntax=docker/dockerfile:1.4

# Per-crate COPY+RUN so a single crate edit reuses earlier nextest --no-run layers.
# rust-platform's bulk COPY cannot do that — any source change busts every RUN.
FROM builder-core-deps AS nook-rust-test

WORKDIR /meta-secret/nook/nook-app/nook-platform

COPY nook-app/nook-platform/Cargo.toml nook-app/nook-platform/Cargo.lock ./
COPY nook-app/nook-platform/.cargo .cargo
COPY nook-app/nook-platform/.config .config
COPY nook-app/nook-platform/clippy.toml clippy.toml

COPY nook-app/nook-platform/nook-app-common nook-app-common
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    touch nook-app-common/src/i18n.rs \
    && cargo nextest run -p nook-app-common --profile ci --no-run \
    && nook-sccache-report focused-native-test-app-common

COPY nook-app/nook-platform/nook-auth2 nook-auth2
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo nextest run -p nook-auth2 --profile ci --no-run \
    && nook-sccache-report focused-native-test-auth2

COPY nook-app/nook-platform/nook-replication nook-replication
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo nextest run -p nook-replication --profile ci --no-run \
    && nook-sccache-report focused-native-test-replication

COPY nook-app/nook-platform/nook-event-log nook-event-log
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo nextest run -p nook-event-log --profile ci --no-run \
    && nook-sccache-report focused-native-test-event-log

COPY nook-app/nook-platform/nook-companion-core nook-companion-core
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo nextest run -p nook-companion-core --profile ci --no-run \
    && nook-sccache-report focused-native-test-companion-core

COPY nook-app/nook-platform/nook-core nook-core
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo nextest run -p nook-core --profile ci --no-run \
    && nook-sccache-report focused-native-test-core

COPY nook-app/nook-platform/nook-companion-wasm nook-companion-wasm
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo nextest run -p nook-companion-wasm --profile ci --no-run \
    && nook-sccache-report focused-native-test-compile

# The full checkout is runtime input only and cannot invalidate the compile layers above.
WORKDIR /meta-secret/nook
COPY . .

RUN test -f nook-app/Taskfile.yml \
    && git init -q \
    && git config user.email nook@local \
    && git config user.name nook \
    && git add -A \
    && git commit -q -m "nook-rust-test source snapshot" >/dev/null
