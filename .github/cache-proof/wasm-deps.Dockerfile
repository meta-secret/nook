# syntax=registry.dev.nokey.sh/docker/dockerfile:1.4

# The named context is the source-free dependency target restored from Zot.
# This uncached read forces a fresh BuildKit worker to hydrate and mount the
# cached parent snapshots. Export only the marker from the final scratch stage.
FROM wasm-deps AS hydrated-wasm-deps

RUN test -n "$(find target/wasm32-unknown-unknown/release/deps -type f -name '*.wasm' -size +0c -print -quit)" \
    && printf '%s\n' 'hydrated-wasm-dependency-cache' >/tmp/nook-wasm-cache-proof.txt

FROM scratch AS builder-wasm-deps-cache-proof

COPY --from=hydrated-wasm-deps /tmp/nook-wasm-cache-proof.txt /nook-wasm-cache-proof.txt
