# syntax=docker/dockerfile:1.4

# Web dependency cache branch. Rust/WASM lives in a separate Dockerfile and GHCR cache lineage;
# there is intentionally no stage that merges the two filesystems.

# --- WEB branch: node_modules only, independent of Rust (builds in parallel with the rust chain) ---
FROM web-base AS web-deps

COPY nook-app/nook-web/nook-web-app/package.json nook-app/nook-web/nook-web-app/bun.lock ./nook-app/nook-web/nook-web-app/
# Do not use sharing=locked here: PR solves share the self-hosted runner's BuildKit daemon, and a
# canceled solve can otherwise stall unrelated builds while they wait for the abandoned mount owner.
# Private mounts avoid both that global lock and concurrent writers to the same Bun cache directory.
RUN --mount=type=cache,target=/opt/nook/bun-install-cache,sharing=private \
    cd nook-app/nook-web/nook-web-app && bun install --frozen-lockfile
