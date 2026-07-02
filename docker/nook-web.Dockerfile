# syntax=docker/dockerfile:1.4

# nook-web image: the LINEAR toolchain top (deps + warm native/wasm target/ + generated wasm pkg +
# bun deps + playwright, all in one continuous image lineage) with the workspace SOURCE copied in.
# This is what `task` runs against at runtime — there is NO bind mount, so the image is
# self-contained and reproducible. Rebuilt per commit; only the small source + dist layers rebuild
# on top of the fully cached toolchain.
#
# Bake context (wired in docker/nook-web.docker-bake.hcl):
#   toolchain -> nook-web/Dockerfile (linear top: deps, warm target/, wasm pkg, node_modules, playwright)
#
# NOTE: no COPY --from here. The generated wasm pkg (nook-web/src/lib/nook-wasm) is already present
# because builder-wasm produced it earlier in the SAME lineage. .dockerignore excludes it from the
# source COPY below, so the source layer never clobbers it.

FROM toolchain AS nook-web

# Production Vite base path (GitHub Pages / Cloudflare use "/").
ARG VITE_BASE=/

# Workspace source, copied as late as possible so the fully-cached toolchain layers above are never
# invalidated by a source edit. .dockerignore excludes target/, node_modules, dist/, and the
# generated wasm pkg, so this layers source over the toolchain WITHOUT clobbering the pre-built
# deps/target/node_modules/wasm already present.
COPY . .

# Seed a throwaway git repo of the copied source so in-container write tasks (task format,
# rust:coverage:update) can emit their changes as `git diff` for the user to apply on the host
# (the image is sealed — no bind mount, so tasks never write host files directly).
RUN git init -q \
    && git config user.email nook@local \
    && git config user.name nook \
    && git add -A \
    && git commit -q -m "nook-web source snapshot" >/dev/null

# Build the production web dist at image time so it is present in every container (the Cloudflare
# preview deploy and GitHub Pages extraction both read nook-web/dist without a bind mount). e2e
# rebuilds its own fast-sync dist variant as needed.
RUN cd nook-web && VITE_BASE="${VITE_BASE}" bun run build

# No ENTRYPOINT: the image is sealed (source + deps + warm target/ baked in), so `docker run`
# invokes the task command directly (e.g. `docker run <img> task check`).
