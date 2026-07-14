# syntax=docker/dockerfile:1.4

# nook-wasm build stage: wasm32 clippy + release build + wasm-pack bundle.
# LINEAR CHAIN: FROM builder-debug (native warm-up), so this stage inherits the native target/
# in place and adds the wasm32 target/ + generated JS/wasm bundle to the SAME image lineage.
# No COPY --from of target/ anywhere — the Rust lineage is continuous, which keeps
# the BuildKit cache chain intact (a warm rebuild is a pure cache hit, no recompile) and avoids
# re-materializing multi-GB target/ layers. `builder-debug` is injected by bake via
# `contexts = { builder-debug = "target:builder-debug" }`.

FROM builder-debug AS builder-wasm

ARG WASM_BUILD_MODE=dev

# Rust clippy, native coverage/tests, and wasm-bindgen Node tests finish in the Rust branch. The
# slim web image can therefore run web-only Task gates without Cargo installed.
RUN cargo clippy --release --target wasm32-unknown-unknown \
      -p nook-wasm \
      -p nook-wasm-unified \
      -p nook-wasm-simple \
      -p nook-wasm-sentinel \
      -p nook-wasm-extension \
      -p nook-wasm-migration \
      -- -D warnings
# --out-dir is relative to the crate dir (nook-wasm/), so "../nook-web/nook-web-app/..." lands the JS/wasm bundle
# in the web source tree where Vite imports it. target/ stays in-tree for reuse.
RUN case "$WASM_BUILD_MODE" in \
      prod) wasm_opt_flag="" && stamp_mode="optimized" ;; \
      dev) wasm_opt_flag="--no-opt" && stamp_mode="no-opt" ;; \
      *) echo "Unsupported WASM_BUILD_MODE=$WASM_BUILD_MODE (expected dev or prod)" >&2; exit 1 ;; \
    esac \
    && for spec in \
         "nook-wasm:nook-wasm/apps/unified" \
         "nook-wasm-simple:nook-wasm/apps/simple" \
         "nook-wasm-sentinel:nook-wasm/apps/sentinel" \
         "nook-wasm-extension:nook-wasm/apps/extension" \
         "nook-wasm-migration:nook-wasm/apps/migration"; do \
         out_dir="${spec%%:*}"; crate_dir="${spec#*:}"; \
         wasm-pack build "$crate_dir" --target web \
           --out-dir "/meta-secret/nook/nook-app/nook-web/nook-web-shared/src/vault-app/lib/$out_dir" \
           --out-name nook_wasm $wasm_opt_flag || exit 1; \
       done \
    && ( current="$(find nook-wasm/src nook-wasm/apps nook-core/src nook-core/locales nook-auth2/src \
           \( -name '*.rs' -o -name '*.json' \) -print0 \
         | LC_ALL=C sort -z \
         | xargs -0 sha256sum \
         | sha256sum \
         | cut -d' ' -f1)" \
         && echo "$current $stamp_mode" > nook-web/nook-web-shared/src/vault-app/lib/nook-wasm/.wasm-source-sha256 )

RUN wasm-pack test --node nook-wasm

# Formatting is an independent validation leaf so `task format` can still load nook-rust and fix
# unformatted source. Normal `task setup` includes this target in its parallel prepare group.
FROM builder-debug AS rust-format-check

RUN cargo fmt --all -- --check

# Tiny host-export boundary for the web phase. `task setup` exports this scratch target to a
# temporary host directory, then gives only that directory to the final web build as a named
# context. The web solve never consumes or materializes the multi-GB builder-wasm snapshot.
FROM scratch AS web-artifacts

COPY --from=builder-wasm /meta-secret/nook/nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm /nook-wasm
COPY --from=builder-wasm /meta-secret/nook/nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm-simple /nook-wasm-simple
COPY --from=builder-wasm /meta-secret/nook/nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm-sentinel /nook-wasm-sentinel
COPY --from=builder-wasm /meta-secret/nook/nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm-extension /nook-wasm-extension
COPY --from=builder-wasm /meta-secret/nook/nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm-migration /nook-wasm-migration
COPY --from=builder-wasm /opt/nook/coverage /coverage

# On-demand sealed Rust image for explicit `task rust:*`, `task wasm:*`, and Rust formatting
# commands. Normal setup/CI does not load this multi-GB image into Docker's runtime image store.
FROM builder-wasm AS nook-rust

WORKDIR /meta-secret/nook

COPY . .

RUN test -f nook-app/Taskfile.yml \
    && git init -q \
    && git config user.email nook@local \
    && git config user.name nook \
    && git add -A \
    && git commit -q -m "nook-rust source snapshot" >/dev/null

# Browser-only wasm tests are manual/debug. Install Chromium only for this on-demand target so the
# normal Rust/WASM branch does not carry Playwright's browser and system-library layers.
FROM nook-rust AS nook-rust-browser

ARG BUN_VERSION=1.3.14
ARG PLAYWRIGHT_VERSION=1.55.0

ENV BUN_INSTALL=/usr/local/bun
ENV PATH="${BUN_INSTALL}/bin:${PATH}"
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/nook/ms-playwright

RUN apt-get update \
    && apt-get install -y --no-install-recommends unzip \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://bun.sh/install | bash -s -- "bun-v${BUN_VERSION}" \
    && bunx playwright@${PLAYWRIGHT_VERSION} install-deps chromium \
    && mkdir -p "$PLAYWRIGHT_BROWSERS_PATH" \
    && bunx playwright@${PLAYWRIGHT_VERSION} install chromium \
    && rm -rf /var/lib/apt/lists/*
