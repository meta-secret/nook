# syntax=docker/dockerfile:1.4

# nook-web build stage: bun deps + Playwright chromium. Independent of the Rust chain —
# builds in parallel with core/wasm from nook-base. `nook-base` is injected by bake via
# `contexts = { nook-base = "target:nook-base" }`. This stage is also the base for the
# final toolchain image (docker/toolchain.Dockerfile).

FROM nook-base AS toolchain-web

COPY nook-web/package.json nook-web/bun.lock ./nook-web/
RUN mkdir -p "$BUN_INSTALL_CACHE_DIR" \
    && cd nook-web && bun install --frozen-lockfile
RUN mkdir -p "$PLAYWRIGHT_BROWSERS_PATH" \
    && cd nook-web && bunx playwright install --with-deps chromium
