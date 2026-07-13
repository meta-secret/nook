# syntax=docker/dockerfile:1.4

# Web dependency cache branch. Rust/WASM lives in a separate Dockerfile and GHCR cache lineage;
# there is intentionally no stage that merges the two filesystems.

# --- WEB branch: node_modules only, independent of Rust (builds in parallel with the rust chain) ---
FROM web-base AS web-deps

COPY nook-app/nook-web/nook-web-app/package.json nook-app/nook-web/nook-web-app/bun.lock ./nook-app/nook-web/nook-web-app/
RUN --mount=type=cache,target=/opt/nook/bun-install-cache,sharing=locked \
    cd nook-app/nook-web/nook-web-app && bun install --frozen-lockfile
