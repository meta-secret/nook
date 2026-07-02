# syntax=docker/dockerfile:1.4

# toolchain: the LINEAR TOP of the build chain. FROM builder-wasm, which already carries (in one
# continuous image lineage) the chef-cooked deps, native warm target/, wasm32 target/, the crates
# registry, and the generated wasm pkg. This stage ADDS only the bun node_modules on top — placed
# AFTER all the Rust compiles (nook-core native + nook-wasm), right before the web/js layer.
#
# Playwright (apt system libs + chromium browser binaries) is NOT here — it lives in nook-base, so
# the ~one-time browser download survives BOTH Rust source edits and JS dep bumps (it only rebuilds
# on a base / Playwright-version bump). Only `bun install` remains here because node_modules is
# genuinely keyed on nook-web/package.json + bun.lock; a JS dep bump invalidates just this layer and
# the nook-web image on top, leaving the entire expensive Rust chain below cached (no recompile).
#
# No COPY --from of target/registry/node_modules/wasm — the whole toolchain is one continuous image
# lineage, so the BuildKit cache chain stays intact and a warm rebuild is a pure cache hit (no
# recompile, no multi-GB layer copy). `builder-wasm` is injected by bake via
# `contexts = { builder-wasm = "target:builder-wasm" }` (see docker/toolchain.docker-bake.hcl).
# This `toolchain` stage is the base for the sealed nook-web image (nook-web/Dockerfile).

FROM builder-wasm AS toolchain

COPY nook-web/package.json nook-web/bun.lock ./nook-web/
RUN mkdir -p "$BUN_INSTALL_CACHE_DIR" \
    && cd nook-web && bun install --frozen-lockfile
