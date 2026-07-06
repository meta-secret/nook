# syntax=docker/dockerfile:1.4

# PARALLEL BRANCHES merged into one toolchain. Two independent inputs must not serialize:
#   - RUST branch (builder-deps -> builder-debug -> builder-wasm): owns the multi-GB target/ and
#     produces the small generated wasm pkg (nook-app/nook-web/src/lib/nook-wasm). Keyed on Rust source.
#   - WEB branch (web-deps): `bun install` -> node_modules. Keyed ONLY on package.json + bun.lock.
# In the old linear chain the web branch sat ON TOP of the rust chain, so a Rust edit needlessly
# re-ran `bun install` and the two never built concurrently. Here they are SEPARATE branches off the
# shared nook-base, so BuildKit builds them in PARALLEL, and `toolchain` merges them at the end.
#
# The merge keeps the 1.5GB target/ IN-LINEAGE (toolchain FROM builder-wasm, no copy) and pulls the
# comparatively small node_modules (~350MB) across with a single COPY --from=web-deps. The wasm pkg
# is already in the rust lineage (wasm-pack wrote it in builder-wasm), so it needs no copy. Net:
#   - Rust edit  -> rust branch rebuilds; web-deps stays cached (only the node_modules COPY re-runs).
#   - JS dep bump -> web-deps rebuilds; the whole rust branch stays cached.
# Contexts (nook-base, builder-wasm) are injected by bake (see nook-app/docker/toolchain.docker-bake.hcl).
# This `toolchain` stage is the base for the sealed nook-web image (nook-app/nook-web/Dockerfile).

# --- WEB branch: node_modules only, independent of Rust (builds in parallel with the rust chain) ---
FROM nook-base AS web-deps

COPY nook-app/nook-web/package.json nook-app/nook-web/bun.lock ./nook-app/nook-web/
RUN --mount=type=cache,target=/opt/nook/bun-install-cache,sharing=locked \
    cd nook-app/nook-web && bun install --frozen-lockfile

# --- Merge: rust lineage (target/ + wasm pkg in place) + web node_modules copied in cheaply ---
FROM builder-wasm AS toolchain

WORKDIR /meta-secret/nook

COPY --from=web-deps /meta-secret/nook/nook-app/nook-web/node_modules /meta-secret/nook/nook-app/nook-web/node_modules
