# syntax=registry.dev.nokey.sh/docker/dockerfile:1.27.0@sha256:bde3983e9c939224420ddaf6b784cc30e09b035a4dea01f581230c50809f372e

# Compile-only product graph. The rust-base and web-base stages are supplied as
# named contexts by compile.docker-bake.hcl. Do not change this
# graph to inherit builder-core-deps or builder-wasm-deps: those stages compile
# tests, Clippy, and coverage as part of their dependency warm-up.

FROM rust-base AS compile-platform-manifests

WORKDIR /meta-secret/nook/nook-app/nook-platform

# Compiler objects are the cross-commit cache boundary. Keep debug/source-path
# metadata independent of the checkout identity and disable incremental object
# layouts, which sccache cannot reuse reliably across clean BuildKit vertices.
ENV CARGO_INCREMENTAL=0
ENV RUSTFLAGS="--remap-path-prefix=/meta-secret/nook=/workspace"
# The inherited rust-base value is a stable, read-only key input only. Every
# compiler vertex below must replace it from the mounted runtime secret before
# starting sccache, so publish and verification share identical BuildKit keys.
ENV NOOK_SCCACHE_RUNTIME_AUTHORITY=secret

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
# `cargo fetch` may query rustc for target metadata. It is not a compiler-cache
# vertex, so bypass the inherited wrapper rather than requiring cache authority
# outside the 16 explicitly secret-mounted compiler vertices below.
RUN --network=default RUSTC_WRAPPER= cargo fetch --locked

# These sibling stages warm only ordinary library dependencies. No --tests,
# --all-targets, test runner, Clippy, coverage, or test-only package is used.
FROM compile-platform-manifests AS compile-native-dependencies

RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --locked \
      -p nook-app-common \
      -p nook-authenticator-domain \
      -p nook-auth2 \
      -p nook-replication \
      -p nook-event-log \
      -p nook-companion-core \
      -p nook-core \
    && nook-sccache-report compile-native-dependencies \
    && mkdir -p /opt/nook \
    && touch /opt/nook/compile-native-dependencies

# Keep the native and WASM dependency compilers in one source-free ancestry so
# the single rooted compile export retains both compiler result lineages.
FROM compile-native-dependencies AS compile-wasm-dependencies

RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --locked --release --target wasm32-unknown-unknown --lib \
      -p nook-wasm \
      -p nook-companion-wasm \
    && nook-sccache-report compile-wasm-dependencies \
    && mkdir -p /opt/nook \
    && touch /opt/nook/compile-wasm-dependencies

# Copy in dependency order so an edit in a leaf package reuses earlier native
# compile layers on the persistent ARC BuildKit worker.
# The manifest stages create placeholder sources. Docker normalizes COPY mtimes,
# so refresh real sources before each build or Cargo can reuse a placeholder
# artifact instead of compiling the checked-out implementation.
FROM compile-native-dependencies AS compile-native-source

COPY nook-app/nook-platform/nook-app-common nook-app-common
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    find nook-app-common -type f -name '*.rs' -exec touch {} + \
    && \
    cargo build --locked -p nook-app-common

COPY nook-app/nook-platform/nook-authenticator-domain nook-authenticator-domain
COPY nook-app/nook-platform/nook-auth2 nook-auth2
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    find nook-authenticator-domain nook-auth2 -type f -name '*.rs' -exec touch {} + \
    && \
    cargo build --locked -p nook-authenticator-domain -p nook-auth2

COPY nook-app/nook-platform/nook-replication nook-replication
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    find nook-replication -type f -name '*.rs' -exec touch {} + \
    && \
    cargo build --locked -p nook-replication

COPY nook-app/nook-platform/nook-event-log nook-event-log
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    find nook-event-log -type f -name '*.rs' -exec touch {} + \
    && \
    cargo build --locked -p nook-event-log

COPY nook-app/nook-platform/nook-companion-core nook-companion-core
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    find nook-companion-core -type f -name '*.rs' -exec touch {} + \
    && \
    cargo build --locked -p nook-companion-core

COPY nook-app/nook-platform/nook-core nook-core
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    find nook-core -type f -name '*.rs' -exec touch {} + \
    && \
    cargo build --locked -p nook-core \
    && mkdir -p /opt/nook \
    && touch /opt/nook/compile-native-passed

# Exact-source native build image for PR validation consumers. This stage only
# performs the ordinary native cargo builds above; tests, Clippy, formatting,
# coverage, audits, and repository policy run later in their own jobs.
FROM compile-native-source AS pr-native-build

WORKDIR /meta-secret/nook
COPY . .

RUN test -f nook-app/Taskfile.yml \
    && git init -q \
    && git config user.email nook@local \
    && git config user.name nook \
    && git add -A \
    && git commit -q -m "PR native build source snapshot" >/dev/null

# Trusted ARC consumers have a remote BuildKit API but no container runtime.
# Import the producer's exact Zot image as a named context, execute validation
# as a normal solve vertex, then expose only the small coverage handoff.
FROM pr-native-image AS pr-native-verify

RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    task _rust:ci:verify-built

FROM scratch AS pr-native-verify-export

COPY --from=pr-native-verify /ci-artifacts/ /

FROM compile-wasm-dependencies AS compile-wasm-source

ARG WASM_BUILD_MODE=dev

COPY nook-app/nook-platform/nook-app-common nook-app-common
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    find nook-app-common -type f -name '*.rs' -exec touch {} + \
    && \
    cargo build --locked --release --target wasm32-unknown-unknown --lib \
      -p nook-wasm -p nook-companion-wasm

COPY nook-app/nook-platform/nook-authenticator-domain nook-authenticator-domain
COPY nook-app/nook-platform/nook-auth2 nook-auth2
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    find nook-authenticator-domain nook-auth2 -type f -name '*.rs' -exec touch {} + \
    && \
    cargo build --locked --release --target wasm32-unknown-unknown --lib \
      -p nook-wasm -p nook-companion-wasm

COPY nook-app/nook-platform/nook-replication nook-replication
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    find nook-replication -type f -name '*.rs' -exec touch {} + \
    && \
    cargo build --locked --release --target wasm32-unknown-unknown --lib \
      -p nook-wasm -p nook-companion-wasm

COPY nook-app/nook-platform/nook-event-log nook-event-log
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    find nook-event-log -type f -name '*.rs' -exec touch {} + \
    && \
    cargo build --locked --release --target wasm32-unknown-unknown --lib \
      -p nook-wasm -p nook-companion-wasm

COPY nook-app/nook-platform/nook-companion-core nook-companion-core
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    find nook-companion-core -type f -name '*.rs' -exec touch {} + \
    && \
    cargo build --locked --release --target wasm32-unknown-unknown --lib \
      -p nook-wasm -p nook-companion-wasm

COPY nook-app/nook-platform/nook-core nook-core
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    find nook-core -type f -name '*.rs' -exec touch {} + \
    && \
    cargo build --locked --release --target wasm32-unknown-unknown --lib \
      -p nook-wasm -p nook-companion-wasm

COPY nook-app/nook-platform/nook-companion-wasm nook-companion-wasm
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    find nook-companion-wasm -type f -name '*.rs' -exec touch {} + \
    && \
    cargo build --locked --release --target wasm32-unknown-unknown --lib \
      -p nook-wasm -p nook-companion-wasm

COPY nook-app/nook-platform/nook-wasm nook-wasm
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    find nook-wasm -type f -name '*.rs' -exec touch {} + \
    && \
    cargo build --locked --release --target wasm32-unknown-unknown --lib \
      -p nook-wasm -p nook-companion-wasm \
    && mkdir -p /opt/nook/wasm-handoff \
    && case "${WASM_BUILD_MODE}" in \
         prod) wasm_opt_flag=""; stamp_mode="optimized" ;; \
         dev) wasm_opt_flag="--no-opt"; stamp_mode="no-opt" ;; \
         *) echo "Unsupported WASM_BUILD_MODE=${WASM_BUILD_MODE}" >&2; exit 2 ;; \
       esac \
    && wasm-pack build nook-wasm --target web \
         --out-dir /opt/nook/wasm-handoff/nook-wasm \
         --out-name nook_wasm $wasm_opt_flag \
    && wasm-pack build nook-companion-wasm --target web \
         --out-dir /opt/nook/wasm-handoff/nook-companion-wasm \
         --out-name nook_companion_wasm $wasm_opt_flag \
    && printf '%s\n' "$stamp_mode" > /opt/nook/wasm-handoff/nook-wasm/nook-wasm-build-mode \
    && touch /opt/nook/wasm-compile-passed

# Copy only the Bun and Node runtimes from web-base into a source-free lineage;
# package manifests enter in the sequential dependency stages below.
FROM rust-base AS compile-node-dependency-toolchain

ENV BUN_INSTALL=/usr/local/bun
ENV PATH="${BUN_INSTALL}/bin:${PATH}"
COPY --from=web-base /usr/local/bun /usr/local/bun
COPY --from=web-base /usr/local/bin/node /usr/local/bin/node

FROM compile-node-dependency-toolchain AS compile-web-app-dependencies

WORKDIR /meta-secret/nook
COPY nook-app/nook-web/nook-web-app/package.json nook-app/nook-web/nook-web-app/bun.lock ./nook-app/nook-web/nook-web-app/
RUN cd nook-app/nook-web/nook-web-app \
    && bun install --frozen-lockfile \
    && mkdir -p /opt/nook \
    && touch /opt/nook/compile-web-app-dependencies

FROM compile-web-app-dependencies AS compile-web-dependencies

COPY nook-app/nook-web/nook-web-research/package.json nook-app/nook-web/nook-web-research/bun.lock ./nook-app/nook-web/nook-web-research/
RUN cd nook-app/nook-web/nook-web-research \
    && bun install --frozen-lockfile \
    && mkdir -p /opt/nook \
    && touch /opt/nook/compile-web-dependencies

FROM web-base AS compile-web

WORKDIR /meta-secret/nook
COPY --from=compile-web-dependencies /meta-secret/nook/nook-app/nook-web/nook-web-app/node_modules \
  /meta-secret/nook/nook-app/nook-web/nook-web-app/node_modules
COPY --from=compile-web-dependencies /meta-secret/nook/nook-app/nook-web/nook-web-research/node_modules \
  /meta-secret/nook/nook-app/nook-web/nook-web-research/node_modules
RUN mkdir -p \
      /meta-secret/nook/nook-app/nook-web/nook-vault-simple \
      /meta-secret/nook/nook-app/nook-web/nook-vault-sentinel \
      /meta-secret/nook/nook-app/nook-web/nook-web-extension \
    && ln -s nook-web-app/node_modules /meta-secret/nook/nook-app/nook-web/node_modules \
    && ln -s ../nook-web-app/node_modules /meta-secret/nook/nook-app/nook-web/nook-vault-simple/node_modules \
    && ln -s ../nook-web-app/node_modules /meta-secret/nook/nook-app/nook-web/nook-vault-sentinel/node_modules \
    && ln -s ../nook-web-app/node_modules /meta-secret/nook/nook-app/nook-web/nook-web-extension/node_modules
# Keep policy, workflow, Cortex, and unrelated product changes out of every web
# compiler key. The web workspace and its two imported legal documents are the
# only repository sources consumed before compilation; generated WASM crosses
# through the explicit handoff below.
COPY nook-app/nook-web nook-app/nook-web
COPY docs/privacy-policy.md docs/privacy-policy.md
COPY docs/terms-of-service.md docs/terms-of-service.md
COPY --from=compile-wasm-source /opt/nook/wasm-handoff /tmp/nook-wasm-handoff
RUN mkdir -p \
      nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm \
      nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm \
    && cp -a /tmp/nook-wasm-handoff/nook-wasm/. \
      nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm/ \
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

ARG VITE_BASE=/
ARG VITE_SITE_URL=
ARG VITE_PUBLIC_APP_URL=
ARG VITE_SIMPLE_APP_URL=
ARG VITE_SENTINEL_APP_URL=
RUN cd nook-app/nook-web/nook-web-app \
    && VITE_BASE="${VITE_BASE}" \
       VITE_SITE_URL="${VITE_SITE_URL}" \
       VITE_PUBLIC_APP_URL="${VITE_PUBLIC_APP_URL}" \
       VITE_SIMPLE_APP_URL="${VITE_SIMPLE_APP_URL}" \
       VITE_SENTINEL_APP_URL="${VITE_SENTINEL_APP_URL}" \
       node_modules/.bin/vite build --mode unified \
    && VITE_BASE="${VITE_BASE}" \
       VITE_SITE_URL="${VITE_SITE_URL}" \
       VITE_PUBLIC_APP_URL="${VITE_PUBLIC_APP_URL}" \
       VITE_SIMPLE_APP_URL="${VITE_SIMPLE_APP_URL}" \
       VITE_SENTINEL_APP_URL="${VITE_SENTINEL_APP_URL}" \
       node_modules/.bin/vite build --mode site
RUN cd nook-app/nook-web/nook-vault-simple \
    && VITE_SITE_URL="${VITE_SITE_URL}" \
       VITE_SIMPLE_APP_URL="${VITE_SIMPLE_APP_URL}" \
       ../nook-web-app/node_modules/.bin/vite build
RUN cd nook-app/nook-web/nook-vault-sentinel \
    && VITE_SIMPLE_APP_URL="${VITE_SIMPLE_APP_URL}" \
       VITE_SENTINEL_APP_URL="${VITE_SENTINEL_APP_URL}" \
       ../nook-web-app/node_modules/.bin/vite build
RUN cd nook-app/nook-web/nook-web-app \
    && bun scripts/assemble-preview.ts
RUN cd nook-app/nook-web/nook-web-research && node_modules/.bin/vite build

# The commit is deliberately introduced at the narrow extension packaging
# boundary. It varies for every head and must not invalidate type checks or the
# preceding site/application builds when product sources are unchanged.
# Extension packaging reads exactly these locale catalogs from outside the web
# workspace. Introduce them at this boundary so locale edits do not invalidate
# the preceding web compilers.
COPY nook-app/nook-platform/nook-app-common/locales/en.json nook-app/nook-platform/nook-app-common/locales/en.json
COPY nook-app/nook-platform/nook-app-common/locales/ru.json nook-app/nook-platform/nook-app-common/locales/ru.json
ARG NOOK_SIMPLE_VAULT_URL=https://simple.nokey.sh/
ARG NOOK_EXTENSION_CHANNEL=production
ARG NOOK_EXTENSION_VERSION=1.0.0
ARG NOOK_EXTENSION_COMMIT=
ARG NOOK_EXTENSION_SITE_URL=https://nokey.sh/
RUN cd nook-app/nook-web/nook-web-extension \
    && NOOK_SIMPLE_VAULT_URL="${NOOK_SIMPLE_VAULT_URL}" \
       NOOK_EXTENSION_CHANNEL="${NOOK_EXTENSION_CHANNEL}" \
       NOOK_EXTENSION_VERSION="${NOOK_EXTENSION_VERSION}" \
       NOOK_EXTENSION_COMMIT="${NOOK_EXTENSION_COMMIT}" \
       NOOK_EXTENSION_SITE_URL="${NOOK_EXTENSION_SITE_URL}" \
       bun scripts/build.ts
RUN mkdir -p /opt/nook && touch /opt/nook/web-compile-passed

FROM web-base AS compile-repository-tooling

WORKDIR /meta-secret/nook
COPY package.json bun.lock tsconfig.json tsconfig.compile.json eslint.config.mjs ./
COPY .github .github
COPY infra infra
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

# The exact source cache is a single bounded mode=max export. Keep the
# expensive, linear WASM compiler graph in the final target's ancestry so the
# export retains its source/compiler records for the next immutable commit.
# A scratch join makes only the copied marker reachable and obscures the
# compiler lineage that this cache exists to preserve.
FROM compile-wasm-source AS compile

COPY --from=compile-native-source /opt/nook/compile-native-passed /compile/native
RUN install -D /opt/nook/wasm-compile-passed /compile/wasm
COPY --from=compile-web /opt/nook/web-compile-passed /compile/web
COPY --from=compile-repository-tooling /opt/nook/repository-tooling-compile-passed /compile/repository-tooling
COPY --from=compile-loom /opt/nook/loom-compile-passed /compile/loom
