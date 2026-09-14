# syntax=registry.dev.nokey.sh/docker/dockerfile:1.27.0@sha256:bde3983e9c939224420ddaf6b784cc30e09b035a4dea01f581230c50809f372e

# Web dependency cache branch. Rust/WASM lives in a separate Dockerfile and local BuildKit lineage;
# there is intentionally no stage that merges the two filesystems.

# --- WEB branch: node_modules only, independent of Rust (builds in parallel with the rust chain) ---
# Keep the two lockfile/install vertices independent. The research catalog is intentionally
# allowed to evolve on its own cadence; sharing one install vertex with the main app made a
# research lockfile change cold-start the expensive install even when the app lockfile was
# unchanged.
FROM web-base AS web-app-deps

COPY nook-app/nook-web/nook-web-app/package.json nook-app/nook-web/nook-web-app/bun.lock ./nook-app/nook-web/nook-web-app/
RUN cd nook-app/nook-web/nook-web-app && bun install --frozen-lockfile

FROM web-base AS web-research-deps

COPY nook-app/nook-web/nook-web-research/package.json nook-app/nook-web/nook-web-research/bun.lock ./nook-app/nook-web/nook-web-research/
RUN cd nook-app/nook-web/nook-web-research && bun install --frozen-lockfile

# Compatibility aggregate consumed by the sealed web image and the feature compile graph. Its
# child stages own the install cache keys; this stage only assembles their outputs.
FROM scratch AS web-deps

COPY --from=web-app-deps /meta-secret/nook/nook-app/nook-web/nook-web-app/node_modules \
  /meta-secret/nook/nook-app/nook-web/nook-web-app/node_modules
COPY --from=web-research-deps /meta-secret/nook/nook-app/nook-web/nook-web-research/node_modules \
  /meta-secret/nook/nook-app/nook-web/nook-web-research/node_modules
