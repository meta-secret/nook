# syntax=registry.dev.nokey.sh/docker/dockerfile:1.27.0@sha256:bde3983e9c939224420ddaf6b784cc30e09b035a4dea01f581230c50809f372e

# Web dependency cache branch. Rust/WASM lives in a separate Dockerfile and local BuildKit lineage;
# there is intentionally no stage that merges the two filesystems.

# --- WEB branch: node_modules only, independent of Rust (builds in parallel with the rust chain) ---
FROM web-base AS web-deps

COPY nook-app/nook-web/nook-web-app/package.json nook-app/nook-web/nook-web-app/bun.lock ./nook-app/nook-web/nook-web-app/
RUN cd nook-app/nook-web/nook-web-app && bun install --frozen-lockfile

COPY nook-app/nook-web/nook-web-research/package.json nook-app/nook-web/nook-web-research/bun.lock ./nook-app/nook-web/nook-web-research/
RUN cd nook-app/nook-web/nook-web-research && bun install --frozen-lockfile
