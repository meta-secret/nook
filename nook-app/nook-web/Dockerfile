# syntax=docker/dockerfile:1.4

# nook-web image: the merged toolchain (rust lineage with warm native/wasm target/ + generated wasm
# pkg, plus node_modules copied from the parallel web-deps branch, plus Playwright from nook-base)
# with the workspace SOURCE copied in. This is what `task` runs against at runtime — there is NO
# bind mount, so the image is self-contained and reproducible. Rebuilt per commit; only the small
# source + dist layers rebuild on top of the fully cached toolchain.
#
# Bake context (wired in nook-app/nook-web/docker-bake.hcl):
#   toolchain -> nook-app/nook-web/Dockerfile (merged top: rust target/ + wasm pkg + node_modules + playwright)
#
# NOTE: no COPY --from here. The wasm pkg (nook-app/nook-web/src/lib/nook-wasm) and node_modules are already
# present in the toolchain (wasm pkg from the rust lineage, node_modules merged from web-deps).
# .dockerignore excludes both from the source COPY below, so the source layer never clobbers them.

FROM toolchain AS nook-web

# Production Vite base path (GitHub Pages / Cloudflare use "/").
ARG VITE_BASE=/

WORKDIR /meta-secret/nook

# Toolchain layers from older builds may still contain the pre-`nook-app` root-level app layout.
# Clear those paths before overlaying the current source so the sealed image cannot accidentally run
# stale root Taskfiles or packages from cache.
RUN rm -rf \
    .cargo \
    .config \
    .task \
    Cargo.lock \
    Cargo.toml \
    docker \
    docker-bake.hcl \
    nook-auth2 \
    nook-core \
    nook-wasm \
    nook-web \
    nook-web-extension \
    recipe.json \
    target

# Workspace source, copied as late as possible so the fully-cached toolchain layers above are never
# invalidated by a source edit. .dockerignore excludes target/, node_modules, dist/, and the
# generated wasm pkg, so this layers source over the toolchain WITHOUT clobbering the pre-built
# deps/target/node_modules/wasm already present.
COPY . .

RUN test -f nook-app/Taskfile.yml \
    && test ! -d nook-core \
    && test ! -f Cargo.toml

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
# nook-app/nook-web/dist; the extension bundle can be extracted from
# nook-app/nook-web-extension/dist for manual browser loading.
RUN cd nook-app/nook-web && VITE_BASE="${VITE_BASE}" bun run build
RUN cd nook-app/nook-web-extension && bun run build

# No ENTRYPOINT: the image is sealed (source + deps + warm target/ baked in), so `docker run`
# invokes the task command directly (e.g. `docker run <img> task check`).
