# syntax=docker/dockerfile:1.4

# nook-wasm build stage: wasm32 clippy + release build + wasm-pack bundle.
# LINEAR CHAIN: FROM builder-debug (native warm-up), so this stage inherits the native target/
# in place and adds the wasm32 target/ + generated JS/wasm bundle to the SAME image lineage.
# No COPY --from of target/ anywhere — the whole toolchain is one continuous image, which keeps
# the BuildKit cache chain intact (a warm rebuild is a pure cache hit, no recompile) and avoids
# re-materializing multi-GB target/ layers. `builder-debug` is injected by bake via
# `contexts = { builder-debug = "target:builder-debug" }`.

FROM builder-debug AS builder-wasm

ARG WASM_BUILD_MODE=dev

# Separate RUNs so each layer caches independently.
RUN cargo clippy --release --target wasm32-unknown-unknown -p nook-wasm -- -D warnings
# --out-dir is relative to the crate dir (nook-wasm/), so "../nook-web/nook-web-app/..." lands the JS/wasm bundle
# in the web source tree where Vite imports it. target/ stays in-tree for reuse.
RUN case "$WASM_BUILD_MODE" in \
      prod) wasm_opt_flag="" && stamp_mode="optimized" ;; \
      dev) wasm_opt_flag="--no-opt" && stamp_mode="no-opt" ;; \
      *) echo "Unsupported WASM_BUILD_MODE=$WASM_BUILD_MODE (expected dev or prod)" >&2; exit 1 ;; \
    esac \
    && wasm-pack build nook-wasm --target web --out-dir ../nook-web/nook-web-app/src/lib/nook-wasm --out-name nook_wasm $wasm_opt_flag \
    && ( current="$(find nook-wasm/src nook-core/src nook-core/locales nook-auth/src \
           \( -name '*.rs' -o -name '*.json' \) -print0 \
         | LC_ALL=C sort -z \
         | xargs -0 sha256sum \
         | sha256sum \
         | cut -d' ' -f1)" \
         && echo "$current $stamp_mode" > nook-web/nook-web-app/src/lib/nook-wasm/.wasm-source-sha256 )
