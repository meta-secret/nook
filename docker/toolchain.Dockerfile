# syntax=docker/dockerfile:1.4

# toolchain: the LINEAR TOP of the build chain. FROM builder-wasm, which already carries (in one
# continuous image lineage) the chef-cooked deps, native warm target/, wasm32 target/, the crates
# registry, and the generated wasm pkg. This stage only ADDS the web toolchain (bun deps +
# Playwright chromium) on top — there is NO COPY --from of target/registry/node_modules/wasm, so
# the BuildKit cache chain stays intact and a warm rebuild is a pure cache hit (no recompile, no
# multi-GB layer copy). `builder-wasm` is injected by bake via
# `contexts = { builder-wasm = "target:builder-wasm" }` (see docker/toolchain.docker-bake.hcl).
# This `toolchain` stage is the base for the sealed nook-web image (docker/nook-web.Dockerfile).

FROM builder-wasm AS toolchain

COPY nook-web/package.json nook-web/bun.lock ./nook-web/
RUN mkdir -p "$BUN_INSTALL_CACHE_DIR" \
    && cd nook-web && bun install --frozen-lockfile
RUN mkdir -p "$PLAYWRIGHT_BROWSERS_PATH" \
    && cd nook-web && bunx playwright install --with-deps chromium
