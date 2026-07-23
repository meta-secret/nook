# syntax=docker/dockerfile:1.4

# Slim nook-web image: web-base (Bun/Node/Task, no browser), cached node_modules, and the tiny
# host-exported WASM/coverage artifact directory. It never inherits the Rust toolchain or target/.
# Workspace source is still sealed into the image; there is no runtime bind mount on the common path.
#
# `task setup` first exports web-artifacts to a temporary host directory while web-deps builds in
# parallel. Bake then injects web-base, web-deps, and that small host directory as named contexts.

FROM web-base AS nook-web-source

# Production Vite base path (GitHub Pages / Cloudflare use "/").
ARG VITE_BASE=/
ARG VITE_SITE_URL=
ARG VITE_PUBLIC_APP_URL=
ARG NOOK_SIMPLE_VAULT_URL=https://simple.nokey.sh/
ARG VITE_SIMPLE_APP_URL=
ARG VITE_SENTINEL_APP_URL=
ARG NOOK_EXTENSION_CHANNEL=production
ARG NOOK_EXTENSION_VERSION=1.0.0
ARG NOOK_EXTENSION_COMMIT=
ARG NOOK_EXTENSION_SITE_URL=https://nokey.sh/

WORKDIR /meta-secret/nook

# Only these small outputs cross the Rust/web boundary. The Rust target/, Cargo registry, and
# compiler toolchain remain exclusively in the builder's local BuildKit content store.
COPY --from=web-deps /meta-secret/nook/nook-app/nook-web/nook-web-app/node_modules /meta-secret/nook/nook-app/nook-web/nook-web-app/node_modules
RUN ln -s nook-web-app/node_modules /meta-secret/nook/nook-app/nook-web/node_modules
# Playwright uses its own revisioned ffmpeg path for video recording. Browser images provide
# Debian's ffmpeg package; link that binary into the revision declared by the installed Playwright
# package. Browser-free web images have no ffmpeg and intentionally skip this step.
RUN if command -v ffmpeg >/dev/null 2>&1; then \
      revision="$(node -p "require('./nook-app/nook-web/nook-web-app/node_modules/playwright-core/browsers.json').browsers.find((browser) => browser.name === 'ffmpeg').revision")"; \
      install -d "/opt/nook/ms-playwright/ffmpeg-${revision}"; \
      ln -s /usr/bin/ffmpeg "/opt/nook/ms-playwright/ffmpeg-${revision}/ffmpeg-linux"; \
    fi
COPY --from=web-artifacts /nook-wasm /meta-secret/nook/nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm
COPY --from=web-artifacts /coverage /opt/nook/coverage

# Workspace source, copied as late as possible so the cached web dependency layers above are never
# invalidated by a source edit. .dockerignore excludes target/, node_modules, dist/, and the
# generated wasm pkg, so this layers source without clobbering node_modules or the generated WASM.
COPY . .

RUN test -f nook-app/Taskfile.yml \
    && test ! -d nook-core \
    && test ! -f Cargo.toml \
    && test ! -e /usr/local/cargo \
    && test ! -d nook-app/target

# Seed a throwaway git repo of the copied source so in-container write tasks (task format,
# rust:coverage:update) can emit their changes as `git diff` for the user to apply on the host
# (the image is sealed — no bind mount, so tasks never write host files directly).
RUN git init -q \
    && git config user.email nook@local \
    && git config user.name nook \
    && git add -A \
    && git commit -q -m "nook-web source snapshot" >/dev/null

# CI verification and production builds are sibling stages. The CI-only final target joins their
# results, so lint/check/tests run in parallel with the builds without weakening either gate.
FROM nook-web-source AS nook-web-verify

RUN CI=1 task _ci:pr \
    && install -d /opt/nook \
    && touch /opt/nook/web-verified

# Build the production web dist and browser extension at image time so both artifacts are present in
# every container. The Cloudflare preview deploy and GitHub Pages extraction read
# nook-app/nook-web/nook-web-app/dist; the extension bundle can be extracted from
# nook-app/nook-web/nook-web-extension/dist for manual browser loading.
FROM nook-web-source AS nook-web-build

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
    bun run build \
    && NOOK_EXTENSION_CHANNEL="${NOOK_EXTENSION_CHANNEL}" \
    NOOK_EXTENSION_VERSION="${NOOK_EXTENSION_VERSION}" \
    NOOK_EXTENSION_COMMIT="${NOOK_EXTENSION_COMMIT}" \
    NOOK_EXTENSION_SITE_URL="${NOOK_EXTENSION_SITE_URL}" \
    bun run package:deployment

FROM nook-web-build AS nook-web

# Hosted PR CI selects this target. Copying the marker creates an explicit BuildKit dependency on
# the sibling verification stage while preserving the same sealed runtime image and build outputs.
FROM nook-web-build AS nook-web-ci

COPY --from=nook-web-verify /opt/nook/web-verified /opt/nook/web-verified

# No ENTRYPOINT: the image is sealed (source + web deps + generated WASM baked in), so `docker run`
# invokes the task command directly (e.g. `docker run <img> task check`).
