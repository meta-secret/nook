# syntax=docker/dockerfile:1.4

# nook-web image: the toolchain base (deps + warm target/ + bun deps + playwright) with the
# workspace SOURCE copied in. This is what `task` runs against at runtime — there is NO bind
# mount, so the image is self-contained and reproducible. Rebuilt per commit; only the small
# source + dist layers rebuild on top of the cached toolchain.
#
# Bake contexts (wired in docker/nook-web.docker-bake.hcl):
#   toolchain    -> docker/toolchain.Dockerfile (base: deps, warm target/, node_modules, playwright)
#   builder-wasm -> nook-wasm/Dockerfile        (generated wasm pkg for nook-web/src/lib/nook-wasm)

FROM toolchain AS nook-web

# Production Vite base path (GitHub Pages / Cloudflare use "/").
ARG VITE_BASE=/

# The generated wasm bundle (gitignored + dockerignored, so it is NOT part of the source COPY
# below). Copied from the wasm builder first so it stays cached when only app source changes.
COPY --from=builder-wasm /meta-secret/nook/nook-web/src/lib/nook-wasm nook-web/src/lib/nook-wasm

# Workspace source, copied as late as possible so unrelated cached layers above are never
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
