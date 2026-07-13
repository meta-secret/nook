# syntax=docker/dockerfile:1.4

# Slim nook-web image: web-base (Bun/Node/Task/Playwright), cached node_modules, and the tiny
# host-exported WASM/coverage artifact directory. It never inherits the Rust toolchain or target/.
# Workspace source is still sealed into the image; there is no runtime bind mount on the common path.
#
# `task setup` first exports web-artifacts to a temporary host directory while web-deps builds in
# parallel. Bake then injects web-base, web-deps, and that small host directory as named contexts.

FROM web-base AS nook-web

# Production Vite base path (GitHub Pages / Cloudflare use "/").
ARG VITE_BASE=/
ARG VITE_SITE_URL=
ARG VITE_PUBLIC_APP_URL=

WORKDIR /meta-secret/nook

# Only these small outputs cross the Rust/web boundary. The Rust target/, Cargo registry, and
# compiler toolchain remain exclusively in BuildKit/GHCR cache.
COPY --from=web-deps /meta-secret/nook/nook-app/nook-web/nook-web-app/node_modules /meta-secret/nook/nook-app/nook-web/nook-web-app/node_modules
COPY --from=web-artifacts /nook-wasm /meta-secret/nook/nook-app/nook-web/nook-web-app/src/lib/nook-wasm
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

# Build the production web dist and browser extension at image time so both artifacts are present in
# every container. The Cloudflare preview deploy and GitHub Pages extraction read
# nook-app/nook-web/nook-web-app/dist; the extension bundle can be extracted from
# nook-app/nook-web/nook-web-extension/dist for manual browser loading.
RUN cd nook-app/nook-web/nook-web-app \
    && VITE_BASE="${VITE_BASE}" \
    VITE_SITE_URL="${VITE_SITE_URL}" \
    VITE_PUBLIC_APP_URL="${VITE_PUBLIC_APP_URL}" \
    bun run build
RUN cd nook-app/nook-web/nook-web-extension && bun run build

# No ENTRYPOINT: the image is sealed (source + web deps + generated WASM baked in), so `docker run`
# invokes the task command directly (e.g. `docker run <img> task check`).
