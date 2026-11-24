# syntax=registry.dev.nokey.sh/docker/dockerfile:1.27.0@sha256:bde3983e9c939224420ddaf6b784cc30e09b035a4dea01f581230c50809f372e

# Compile-only product graph. The rust-base and web-base stages are supplied as
# named contexts by compile/docker-bake.hcl. Do not change this
# graph to inherit builder-core-deps or builder-wasm-deps: those stages compile
# non-build validation as part of their dependency warm-up.

FROM rust-base AS compile-platform-manifests

WORKDIR /meta-secret/nook/nook-app/nook-platform

# Compiler objects are the cross-commit cache boundary. Disable incremental
# object layouts, which sccache cannot reuse reliably across clean BuildKit
# vertices.
ENV CARGO_INCREMENTAL=0
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
# outside the explicitly secret-mounted compiler vertices below.
RUN --network=default RUSTC_WRAPPER= cargo fetch --locked

# These sibling stages warm only ordinary library dependencies. No validation
# target, runner, or validation-only package is used.
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

# Keep compiled dependencies when only their consumer changes. The manifest
# foundation uses placeholder libraries, so refresh each real source before
# Cargo checks artifact freshness.
FROM compile-native-dependencies AS compile-native-source

COPY --exclude=tests --exclude=examples --exclude=.cortex nook-app/nook-platform/nook-app-common/ nook-app-common/
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    find nook-app-common -type f -name '*.rs' -exec touch {} + \
    && cargo build --locked -p nook-app-common

COPY --exclude=tests --exclude=examples --exclude=.cortex nook-app/nook-platform/nook-authenticator-domain/ nook-authenticator-domain/
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    find nook-authenticator-domain -type f -name '*.rs' -exec touch {} + \
    && cargo build --locked -p nook-authenticator-domain

COPY --exclude=tests --exclude=examples --exclude=.cortex nook-app/nook-platform/nook-auth2/ nook-auth2/
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    find nook-auth2 -type f -name '*.rs' -exec touch {} + \
    && cargo build --locked -p nook-auth2

COPY --exclude=tests --exclude=examples --exclude=.cortex nook-app/nook-platform/nook-replication/ nook-replication/
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    find nook-replication -type f -name '*.rs' -exec touch {} + \
    && cargo build --locked -p nook-replication

COPY --exclude=tests --exclude=examples --exclude=.cortex nook-app/nook-platform/nook-event-log/ nook-event-log/
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    find nook-event-log -type f -name '*.rs' -exec touch {} + \
    && cargo build --locked -p nook-event-log

COPY --exclude=tests --exclude=examples --exclude=.cortex nook-app/nook-platform/nook-companion-core/ nook-companion-core/
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    find nook-companion-core -type f -name '*.rs' -exec touch {} + \
    && cargo build --locked -p nook-companion-core

COPY --exclude=tests --exclude=examples --exclude=.cortex nook-app/nook-platform/nook-core/ nook-core/
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    find nook-core -type f -name '*.rs' -exec touch {} + \
    && cargo build --locked -p nook-core \
    && mkdir -p /opt/nook \
    && touch /opt/nook/compile-native-passed

# Both WASM entry points use companion-core and its transitive dependencies.
# Keep vault-core and each entry point out of the other package's inputs.
FROM compile-wasm-dependencies AS compile-wasm-shared-source

COPY --exclude=tests --exclude=examples --exclude=.cortex nook-app/nook-platform/nook-app-common/ nook-app-common/
COPY --exclude=tests --exclude=examples --exclude=.cortex nook-app/nook-platform/nook-authenticator-domain/ nook-authenticator-domain/
COPY --exclude=tests --exclude=examples --exclude=.cortex nook-app/nook-platform/nook-auth2/ nook-auth2/
COPY --exclude=tests --exclude=examples --exclude=.cortex nook-app/nook-platform/nook-replication/ nook-replication/
COPY --exclude=tests --exclude=examples --exclude=.cortex nook-app/nook-platform/nook-event-log/ nook-event-log/
COPY --exclude=tests --exclude=examples --exclude=.cortex nook-app/nook-platform/nook-companion-core/ nook-companion-core/
RUN find nook-app-common nook-authenticator-domain nook-auth2 nook-replication nook-event-log nook-companion-core -type f -name '*.rs' -exec touch {} +

# Request each leaf's dependency graph with the same features as wasm-pack.
# The leaf and, for vault, nook-core still have placeholders. Real source is introduced
# below the dependency build and refreshed before final packaging.
FROM compile-wasm-shared-source AS compile-companion-dependency-artifacts
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --locked --lib --release --target wasm32-unknown-unknown -p nook-companion-wasm

FROM compile-companion-dependency-artifacts AS compile-companion-wasm-source

COPY --exclude=tests --exclude=examples --exclude=.cortex nook-app/nook-platform/nook-companion-wasm/ nook-companion-wasm/
ARG WASM_BUILD_MODE=dev
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    find nook-companion-wasm -type f -name '*.rs' -exec touch {} + \
    && case "${WASM_BUILD_MODE}" in \
         prod) wasm_opt_flag="" ;; \
         dev) wasm_opt_flag="--no-opt" ;; \
         *) echo "Unsupported WASM_BUILD_MODE=${WASM_BUILD_MODE}" >&2; exit 2 ;; \
       esac \
    && wasm-pack build nook-companion-wasm --target web \
         --out-dir /opt/nook/wasm-handoff/nook-companion-wasm \
         --out-name nook_companion_wasm $wasm_opt_flag -- --locked

FROM compile-wasm-shared-source AS compile-vault-shared-artifacts
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    cargo build --locked --lib --release --target wasm32-unknown-unknown -p nook-wasm

# A vault-core edit reuses the compiled shared dependencies. An entry-point
# edit also reuses the completed vault-core library.
FROM compile-vault-shared-artifacts AS compile-vault-dependency-artifacts
COPY --exclude=tests --exclude=examples --exclude=.cortex nook-app/nook-platform/nook-core/ nook-core/
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    find nook-core -type f -name '*.rs' -exec touch {} + \
    && cargo build --locked --lib --release --target wasm32-unknown-unknown -p nook-wasm

FROM compile-vault-dependency-artifacts AS compile-wasm-source

COPY --exclude=tests --exclude=examples --exclude=.cortex nook-app/nook-platform/nook-wasm/ nook-wasm/
ARG WASM_BUILD_MODE=dev
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    --mount=type=secret,id=sccache_s3_access_key,required=false \
    --mount=type=secret,id=sccache_s3_secret_key,required=false \
    find nook-wasm -type f -name '*.rs' -exec touch {} + \
    && case "${WASM_BUILD_MODE}" in \
         prod) wasm_opt_flag=""; stamp_mode="optimized" ;; \
         dev) wasm_opt_flag="--no-opt"; stamp_mode="no-opt" ;; \
         *) echo "Unsupported WASM_BUILD_MODE=${WASM_BUILD_MODE}" >&2; exit 2 ;; \
       esac \
    && wasm-pack build nook-wasm --target web \
         --out-dir /opt/nook/wasm-handoff/nook-wasm \
         --out-name nook_wasm $wasm_opt_flag -- --locked \
    && printf '%s\n' "$stamp_mode" > /opt/nook/wasm-handoff/nook-wasm/nook-wasm-build-mode \
    && touch /opt/nook/wasm-compile-passed

# Continue the rooted dependency foundation from the completed Cargo graph.
# This keeps Cargo fetch, native/WASM dependencies, and all stable Node/web
# dependency installs in one exportable ancestry without a synthetic join.
FROM compile-wasm-dependencies AS compile-node-dependency-toolchain

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

FROM compile-web-dependencies AS compile-web-extension-dependencies

COPY nook-app/nook-web/nook-web-extension/package.json nook-app/nook-web/nook-web-extension/bun.lock ./nook-app/nook-web/nook-web-extension/
RUN cd nook-app/nook-web/nook-web-extension \
    && bun install --frozen-lockfile \
    && mkdir -p /opt/nook \
    && touch /opt/nook/compile-web-extension-dependencies

FROM compile-web-extension-dependencies AS compile-foundation

FROM web-base AS compile-web

WORKDIR /meta-secret/nook
COPY --from=compile-web-dependencies /meta-secret/nook/nook-app/nook-web/nook-web-app/node_modules \
  /meta-secret/nook/nook-app/nook-web/nook-web-app/node_modules
COPY --from=compile-web-dependencies /meta-secret/nook/nook-app/nook-web/nook-web-research/node_modules \
  /meta-secret/nook/nook-app/nook-web/nook-web-research/node_modules
COPY --from=compile-web-extension-dependencies /meta-secret/nook/nook-app/nook-web/nook-web-extension/node_modules \
  /meta-secret/nook/nook-app/nook-web/nook-web-extension/node_modules
RUN mkdir -p \
      /meta-secret/nook/nook-app/nook-web/nook-vault-simple \
      /meta-secret/nook/nook-app/nook-web/nook-vault-sentinel \
      /meta-secret/nook/nook-app/nook-web/nook-web-extension \
    && ln -s nook-web-app/node_modules /meta-secret/nook/nook-app/nook-web/node_modules \
    && ln -s ../nook-web-app/node_modules /meta-secret/nook/nook-app/nook-web/nook-vault-simple/node_modules \
    && ln -s ../nook-web-app/node_modules /meta-secret/nook/nook-app/nook-web/nook-vault-sentinel/node_modules
# Keep policy, workflow, Cortex, and unrelated product changes out of every web
# compiler key. The web workspace and its two imported legal documents are the
# only repository sources consumed before compilation; generated WASM crosses
# through the explicit handoff below.
COPY nook-app/nook-web nook-app/nook-web
COPY docs/privacy-policy.md docs/privacy-policy.md
COPY docs/terms-of-service.md docs/terms-of-service.md
COPY --from=compile-wasm-source /opt/nook/wasm-handoff/nook-wasm/ /tmp/nook-wasm-handoff/nook-wasm/
COPY --from=compile-companion-wasm-source /opt/nook/wasm-handoff/nook-companion-wasm/ /tmp/nook-wasm-handoff/nook-companion-wasm/
RUN mkdir -p \
      nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm \
      nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm \
    && cp -a /tmp/nook-wasm-handoff/nook-wasm/. \
      nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm/ \
    && cp -a /tmp/nook-wasm-handoff/nook-companion-wasm/. \
      nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm/ \
    && rm -rf /tmp/nook-wasm-handoff

# Typed-API compile contracts: oxlint and the TypeScript 7 success-contract
# check for TypeScript, then ESLint for Svelte components.
RUN cd nook-app/nook-web \
    && node_modules/.bin/oxlint -c oxlint.compile-contracts.config.ts \
      nook-web-extension/src nook-web-shared/src nook-web-app/src \
      nook-web-research/src nook-vault-simple nook-vault-sentinel \
    && node named-success-contract-check.ts \
      nook-web-extension/src nook-web-shared/src nook-web-app/src \
      nook-web-research/src nook-vault-simple nook-vault-sentinel \
    && node_modules/.bin/eslint --config eslint.compile-contracts.config.js \
      --no-error-on-unmatched-pattern \
      "nook-web-extension/src/**/*.svelte" \
      "nook-web-shared/src/**/*.svelte" \
      "nook-web-app/src/**/*.svelte" \
      "nook-web-research/src/**/*.svelte" \
      "nook-vault-simple/**/*.svelte" \
      "nook-vault-sentinel/**/*.svelte"

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
# Empty selects the default vault target owned by companion WASM.
ARG NOOK_EXTENSION_VAULT=
ARG NOOK_EXTENSION_CHANNEL=production
ARG NOOK_EXTENSION_VERSION=1.0.0
ARG NOOK_EXTENSION_COMMIT=
ARG NOOK_EXTENSION_SITE_URL=https://nokey.sh/
RUN cd nook-app/nook-web/nook-web-extension \
    && NOOK_EXTENSION_VAULT="${NOOK_EXTENSION_VAULT}" \
       NOOK_EXTENSION_CHANNEL="${NOOK_EXTENSION_CHANNEL}" \
       NOOK_EXTENSION_VERSION="${NOOK_EXTENSION_VERSION}" \
       NOOK_EXTENSION_COMMIT="${NOOK_EXTENSION_COMMIT}" \
       NOOK_EXTENSION_SITE_URL="${NOOK_EXTENSION_SITE_URL}" \
       bun scripts/build.ts
RUN mkdir -p /opt/nook && touch /opt/nook/web-compile-passed

FROM web-base AS compile-repository-tooling

WORKDIR /meta-secret/nook
COPY package.json bun.lock tsconfig.json tsconfig.compile.json ./
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
# skill dependencies or running their validation scripts.
COPY .cortex /meta-secret/nook/.cortex
RUN bun install --frozen-lockfile --ignore-scripts \
    && ln -s /meta-secret/nook/agentic-ai/loom/node_modules \
      /meta-secret/nook/.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/node_modules \
    && ln -s /meta-secret/nook/agentic-ai/loom/node_modules \
      /meta-secret/nook/.cortex/teams/ai/dynamic-skills/cortex-document-map/scripts/node_modules \
    && node_modules/.bin/tsc --noEmit -p tsconfig.compile.json \
    && mkdir -p /opt/nook \
    && touch /opt/nook/loom-compile-passed

# The final compile target requires native, both packaged WASM products, web
# and tooling. Phase A owns the portable dependency cache export.
FROM compile-wasm-source AS compile

COPY --from=compile-native-source /opt/nook/compile-native-passed /compile/native
RUN install -D /opt/nook/wasm-compile-passed /compile/wasm
COPY --from=compile-web /opt/nook/web-compile-passed /compile/web
COPY --from=compile-repository-tooling /opt/nook/repository-tooling-compile-passed /compile/repository-tooling
COPY --from=compile-loom /opt/nook/loom-compile-passed /compile/loom
