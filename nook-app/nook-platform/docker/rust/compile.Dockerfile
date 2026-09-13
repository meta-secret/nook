# syntax=registry.dev.nokey.sh/docker/dockerfile:1.27.0@sha256:bde3983e9c939224420ddaf6b784cc30e09b035a4dea01f581230c50809f372e

# Compile-only product graph. The rust-base, web-base, and web-deps stages are
# supplied as named contexts by compile.docker-bake.hcl. Do not change this
# graph to inherit builder-core-deps or builder-wasm-deps: those stages compile
# tests, Clippy, and coverage as part of their dependency warm-up.

FROM rust-base AS compile-platform-manifests

WORKDIR /meta-secret/nook/nook-app/nook-platform

COPY nook-app/nook-platform/.cargo .cargo
COPY nook-app/nook-platform/.config .config
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
      nook-wasm-composition-tests/src/lib.rs
RUN --network=default cargo fetch --locked

# These sibling stages warm only ordinary library dependencies. No --tests,
# --all-targets, test runner, Clippy, coverage, or test-only package is used.
FROM compile-platform-manifests AS compile-native-dependencies

RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --locked \
      -p nook-app-common \
      -p nook-authenticator-domain \
      -p nook-auth2 \
      -p nook-replication \
      -p nook-event-log \
      -p nook-companion-core \
      -p nook-core \
    && nook-sccache-report compile-native-dependencies

FROM compile-platform-manifests AS compile-wasm-dependencies

RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --locked --release --target wasm32-unknown-unknown --lib \
      -p nook-wasm \
      -p nook-companion-wasm \
    && nook-sccache-report compile-wasm-dependencies

# Copy in dependency order so an edit in a leaf package reuses earlier native
# compile layers on the persistent ARC BuildKit worker.
FROM compile-native-dependencies AS compile-native-source

COPY nook-app/nook-platform/nook-app-common nook-app-common
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --locked -p nook-app-common

COPY nook-app/nook-platform/nook-authenticator-domain nook-authenticator-domain
COPY nook-app/nook-platform/nook-auth2 nook-auth2
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --locked -p nook-authenticator-domain -p nook-auth2

COPY nook-app/nook-platform/nook-replication nook-replication
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --locked -p nook-replication

COPY nook-app/nook-platform/nook-event-log nook-event-log
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --locked -p nook-event-log

COPY nook-app/nook-platform/nook-companion-core nook-companion-core
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --locked -p nook-companion-core

COPY nook-app/nook-platform/nook-core nook-core
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --locked -p nook-core \
    && mkdir -p /opt/nook \
    && touch /opt/nook/compile-native-passed

FROM compile-wasm-dependencies AS compile-wasm-source

ARG WASM_BUILD_MODE=dev

COPY nook-app/nook-platform/nook-app-common nook-app-common
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --locked --release --target wasm32-unknown-unknown --lib \
      -p nook-wasm -p nook-companion-wasm

COPY nook-app/nook-platform/nook-authenticator-domain nook-authenticator-domain
COPY nook-app/nook-platform/nook-auth2 nook-auth2
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --locked --release --target wasm32-unknown-unknown --lib \
      -p nook-wasm -p nook-companion-wasm

COPY nook-app/nook-platform/nook-replication nook-replication
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --locked --release --target wasm32-unknown-unknown --lib \
      -p nook-wasm -p nook-companion-wasm

COPY nook-app/nook-platform/nook-event-log nook-event-log
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --locked --release --target wasm32-unknown-unknown --lib \
      -p nook-wasm -p nook-companion-wasm

COPY nook-app/nook-platform/nook-companion-core nook-companion-core
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --locked --release --target wasm32-unknown-unknown --lib \
      -p nook-wasm -p nook-companion-wasm

COPY nook-app/nook-platform/nook-core nook-core
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --locked --release --target wasm32-unknown-unknown --lib \
      -p nook-wasm -p nook-companion-wasm

COPY nook-app/nook-platform/nook-companion-wasm nook-companion-wasm
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --locked --release --target wasm32-unknown-unknown --lib \
      -p nook-wasm -p nook-companion-wasm

COPY nook-app/nook-platform/nook-wasm nook-wasm
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --locked --release --target wasm32-unknown-unknown --lib \
      -p nook-wasm -p nook-companion-wasm \
    && mkdir -p /opt/nook/wasm-handoff \
    && case "${WASM_BUILD_MODE}" in \
         prod) wasm_opt_flag="" ;; \
         dev) wasm_opt_flag="--no-opt" ;; \
         *) echo "Unsupported WASM_BUILD_MODE=${WASM_BUILD_MODE}" >&2; exit 2 ;; \
       esac \
    && wasm-pack build nook-wasm --target web \
         --out-dir /opt/nook/wasm-handoff/nook-wasm \
         --out-name nook_wasm $wasm_opt_flag \
    && wasm-pack build nook-companion-wasm --target web \
         --out-dir /opt/nook/wasm-handoff/nook-companion-wasm \
         --out-name nook_companion_wasm $wasm_opt_flag \
    && touch /opt/nook/wasm-compile-passed

FROM rust-base AS compile-minds-base

RUN apt-get update \
    && apt-get install -y --no-install-recommends git openssh-client \
    && rm -rf /var/lib/apt/lists/*

FROM compile-minds-base AS compile-minds-dependencies

WORKDIR /meta-secret/nook/agentic-ai/minds
COPY agentic-ai/minds/Cargo.toml agentic-ai/minds/Cargo.lock ./
COPY agentic-ai/minds/vendor vendor
COPY agentic-ai/minds/hive/Cargo.toml hive/Cargo.toml
RUN mkdir -p hive/src/bin \
    && touch hive/src/lib.rs hive/src/main.rs hive/src/bin/export_observer_contract.rs
RUN --network=default cargo fetch --locked
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --locked --release -p hive \
      --features observer-contract-export --bins \
    && nook-sccache-report compile-hive-dependencies

FROM compile-minds-dependencies AS compile-minds-source

COPY agentic-ai/minds/hive/src hive/src
RUN --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --locked --release -p hive \
      --features observer-contract-export --bins \
    && mkdir -p /opt/nook/hive-observer-contract \
    && target/release/hive-export-observer-contract \
      --output /opt/nook/hive-observer-contract \
    && touch /opt/nook/hive-compile-passed

FROM web-base AS compile-hive-console

WORKDIR /meta-secret/nook/agentic-ai/minds/hive-console
COPY --from=compile-minds-source /opt/nook/hive-observer-contract /opt/nook/hive-observer-contract
ENV HIVE_OBSERVER_CONTRACT_INPUT=/opt/nook/hive-observer-contract
COPY agentic-ai/minds/hive-console/package.json agentic-ai/minds/hive-console/bun.lock ./
RUN bun install --frozen-lockfile
COPY agentic-ai/minds/hive-console/index.html \
     agentic-ai/minds/hive-console/svelte.config.js \
     agentic-ai/minds/hive-console/tsconfig.json \
     agentic-ai/minds/hive-console/vite.config.ts \
     agentic-ai/minds/hive-console/eslint.config.js \
     agentic-ai/minds/hive-console/.prettierrc ./
COPY agentic-ai/minds/hive-console/src src
COPY agentic-ai/minds/hive-console/locales locales
COPY agentic-ai/minds/hive-console/scripts scripts
COPY agentic-ai/minds/hive-console/.prettierignore ./
COPY agentic-ai/minds/hive-console/tsconfig.compile.json ./
RUN bun run contracts \
    && node_modules/.bin/svelte-check --tsconfig tsconfig.compile.json \
    && node_modules/.bin/tsc --noEmit -p tsconfig.compile.json \
    && bun run build \
    && mkdir -p /opt/nook \
    && touch /opt/nook/hive-console-compile-passed

FROM web-base AS compile-web

ARG VITE_BASE=/
ARG VITE_SITE_URL=
ARG VITE_PUBLIC_APP_URL=
ARG VITE_SIMPLE_APP_URL=
ARG VITE_SENTINEL_APP_URL=
ARG NOOK_SIMPLE_VAULT_URL=https://simple.nokey.sh/
ARG NOOK_EXTENSION_CHANNEL=production
ARG NOOK_EXTENSION_VERSION=1.0.0
ARG NOOK_EXTENSION_COMMIT=
ARG NOOK_EXTENSION_SITE_URL=https://nokey.sh/

WORKDIR /meta-secret/nook
COPY --from=web-deps /meta-secret/nook/nook-app/nook-web/nook-web-app/node_modules \
  /meta-secret/nook/nook-app/nook-web/nook-web-app/node_modules
COPY --from=web-deps /meta-secret/nook/nook-app/nook-web/nook-web-research/node_modules \
  /meta-secret/nook/nook-app/nook-web/nook-web-research/node_modules
RUN ln -s nook-web-app/node_modules /meta-secret/nook/nook-app/nook-web/node_modules \
    && ln -s ../nook-web-app/node_modules /meta-secret/nook/nook-app/nook-web/nook-vault-simple/node_modules \
    && ln -s ../nook-web-app/node_modules /meta-secret/nook/nook-app/nook-web/nook-vault-sentinel/node_modules \
    && ln -s ../nook-web-app/node_modules /meta-secret/nook/nook-app/nook-web/nook-web-extension/node_modules
COPY . .
COPY --from=compile-wasm-source /opt/nook/wasm-handoff /tmp/nook-wasm-handoff
RUN mkdir -p \
      nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm \
      nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm \
    && find /tmp/nook-wasm-handoff -mindepth 1 -maxdepth 1 ! -name nook-companion-wasm \
      -exec cp -a {} nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm/ \; \
    && cp -a /tmp/nook-wasm-handoff/nook-companion-wasm/. \
      nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm/ \
    && rm -rf /tmp/nook-wasm-handoff

RUN cd nook-app/nook-web/nook-web-app \
    && node_modules/.bin/svelte-check --tsconfig tsconfig.compile.json \
    && node_modules/.bin/tsc --noEmit -p tsconfig.compile.json
RUN cd nook-app/nook-web/nook-vault-simple \
    && ../nook-web-app/node_modules/.bin/svelte-check --tsconfig tsconfig.compile.json \
    && ../nook-web-app/node_modules/.bin/tsc --noEmit -p tsconfig.compile.json \
    && cd ../nook-vault-sentinel \
    && ../nook-web-app/node_modules/.bin/svelte-check --tsconfig tsconfig.compile.json \
    && ../nook-web-app/node_modules/.bin/tsc --noEmit -p tsconfig.compile.json
RUN cd nook-app/nook-web/nook-web-extension \
    && ../nook-web-app/node_modules/.bin/svelte-check --tsconfig tsconfig.compile.json \
    && ../nook-web-app/node_modules/.bin/tsc --noEmit -p tsconfig.compile.json
RUN cd nook-app/nook-web/nook-web-research \
    && ../nook-web-app/node_modules/.bin/svelte-check --tsconfig tsconfig.compile.json \
    && ../nook-web-app/node_modules/.bin/tsc --noEmit -p tsconfig.compile.json

RUN cd nook-app/nook-web/nook-web-app \
    && VITE_BASE="${VITE_BASE}" \
       VITE_SITE_URL="${VITE_SITE_URL}" \
       VITE_PUBLIC_APP_URL="${VITE_PUBLIC_APP_URL}" \
       VITE_SIMPLE_APP_URL="${VITE_SIMPLE_APP_URL}" \
       VITE_SENTINEL_APP_URL="${VITE_SENTINEL_APP_URL}" \
       bun run build
RUN cd nook-app/nook-web/nook-web-extension \
    && NOOK_SIMPLE_VAULT_URL="${NOOK_SIMPLE_VAULT_URL}" \
       NOOK_EXTENSION_CHANNEL="${NOOK_EXTENSION_CHANNEL}" \
       NOOK_EXTENSION_VERSION="${NOOK_EXTENSION_VERSION}" \
       NOOK_EXTENSION_COMMIT="${NOOK_EXTENSION_COMMIT}" \
       NOOK_EXTENSION_SITE_URL="${NOOK_EXTENSION_SITE_URL}" \
       bun run build
RUN cd nook-app/nook-web/nook-web-research && bun run build
RUN mkdir -p /opt/nook && touch /opt/nook/web-compile-passed

FROM registry.dev.nokey.sh/library/node:24-trixie-slim@sha256:0711b541c1c33a8a530ac4f0d391baa9a15b3d804695b1b24a47daa5fb60e74d AS compile-ci-agent

WORKDIR /meta-secret/nook/agentic-ai/ci-agent
COPY agentic-ai/ci-agent/package.json agentic-ai/ci-agent/package-lock.json ./
RUN npm ci --ignore-scripts
COPY agentic-ai/ci-agent/tsconfig.json ./
COPY agentic-ai/ci-agent/src/main src/main
RUN npm run build \
    && mkdir -p /opt/nook \
    && touch /opt/nook/ci-agent-compile-passed

FROM web-base AS compile-repository-tooling

WORKDIR /meta-secret/nook
COPY package.json bun.lock tsconfig.json tsconfig.compile.json eslint.config.mjs ./
COPY .github .github
COPY infra infra
COPY agentic-ai/minds/hive/controller agentic-ai/minds/hive/controller
RUN bun install --frozen-lockfile --ignore-scripts \
    && node_modules/.bin/tsc --noEmit -p tsconfig.compile.json \
    && mkdir -p /opt/nook \
    && touch /opt/nook/repository-tooling-compile-passed

FROM web-base AS compile-loom

WORKDIR /meta-secret/nook/agentic-ai/loom
COPY agentic-ai/loom/package.json agentic-ai/loom/bun.lock agentic-ai/loom/tsconfig.json agentic-ai/loom/tsconfig.compile.json ./
COPY agentic-ai/loom/src src
# Loom's production modules import the tracked Cortex implementation contracts.
# Keep those sources in the compile-only container without copying any nested
# skill dependencies or running their test/verification scripts.
COPY .cortex /meta-secret/nook/.cortex
RUN bun install --frozen-lockfile --ignore-scripts \
    && ln -s /meta-secret/nook/agentic-ai/loom/node_modules \
      /meta-secret/nook/.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/node_modules \
    && ln -s /meta-secret/nook/agentic-ai/loom/node_modules \
      /meta-secret/nook/.cortex/teams/ai/dynamic-skills/cortex-document-map/scripts/node_modules \
    && node_modules/.bin/tsc --noEmit -p tsconfig.compile.json \
    && mkdir -p /opt/nook \
    && touch /opt/nook/loom-compile-passed

FROM scratch AS compile

COPY --from=compile-native-source /opt/nook/compile-native-passed /compile/native
COPY --from=compile-wasm-source /opt/nook/wasm-compile-passed /compile/wasm
COPY --from=compile-web /opt/nook/web-compile-passed /compile/web
COPY --from=compile-minds-source /opt/nook/hive-compile-passed /compile/hive
COPY --from=compile-hive-console /opt/nook/hive-console-compile-passed /compile/hive-console
COPY --from=compile-ci-agent /opt/nook/ci-agent-compile-passed /compile/ci-agent
COPY --from=compile-repository-tooling /opt/nook/repository-tooling-compile-passed /compile/repository-tooling
COPY --from=compile-loom /opt/nook/loom-compile-passed /compile/loom
