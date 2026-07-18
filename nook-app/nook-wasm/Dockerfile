# syntax=docker/dockerfile:1.4

# Mounted development builds must keep Cargo artifacts outside `/meta-secret/nook`: the source
# bind mount replaces that whole tree. This image is keyed only by Cargo manifests/lockfile, so
# ordinary Rust source edits reuse the compiled dependency graph instead of rebuilding it.
FROM builder-wasm-deps AS nook-rust-fast

RUN mkdir -p /opt/nook \
    && mv /meta-secret/nook/nook-app/target /opt/nook/cargo-target

ENV CARGO_TARGET_DIR=/opt/nook/cargo-target
WORKDIR /meta-secret/nook

# nook-wasm build stage: wasm32 clippy + release build + wasm-pack bundle. It is a sibling of
# builder-debug from the shared manifest-keyed dependency image, so hosted BuildKit can run WASM
# and native coverage concurrently instead of serializing both source-sensitive branches.

FROM builder-wasm-deps AS builder-wasm

ARG WASM_BUILD_MODE=dev

COPY nook-app/Cargo.toml nook-app/Cargo.lock ./
COPY nook-app/.config .config
COPY nook-app/nook-auth2 nook-auth2
COPY nook-app/nook-core nook-core
COPY nook-app/nook-wasm nook-wasm

# Docker COPY preserves source mtimes while the inherited dependency target can be newer. Touch
# the module that embeds locale JSON so locale-only changes cannot reuse stale WASM outputs.
RUN touch nook-core/src/i18n.rs

# Rust clippy, native coverage/tests, and wasm-bindgen Node tests finish in the Rust branch. The
# slim web image can therefore run web-only Task gates without Cargo installed.
RUN cargo clippy --release --target wasm32-unknown-unknown \
      -p nook-wasm \
      -- -D warnings
# Emit the single JS/WASM package directly into the shared web source tree where every app imports
# it. target/ stays in-tree for reuse.
RUN case "$WASM_BUILD_MODE" in \
      prod) wasm_opt_flag="" && stamp_mode="optimized" ;; \
      dev) wasm_opt_flag="--no-opt" && stamp_mode="no-opt" ;; \
      *) echo "Unsupported WASM_BUILD_MODE=$WASM_BUILD_MODE (expected dev or prod)" >&2; exit 1 ;; \
    esac \
    && wasm-pack build nook-wasm --target web \
         --out-dir "/meta-secret/nook/nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm" \
         --out-name nook_wasm $wasm_opt_flag \
    && ( current="$(find nook-wasm/src nook-core/src nook-core/locales nook-auth2/src \
           \( -name '*.rs' -o -name '*.json' \) -print0 \
         | LC_ALL=C sort -z \
         | xargs -0 sha256sum \
         | sha256sum \
         | cut -d' ' -f1)" \
         && echo "$current $stamp_mode" > nook-web/nook-web-shared/src/vault-app/lib/nook-wasm/.wasm-source-sha256 )

RUN wasm-pack test --node nook-wasm

FROM scratch AS wasm-export

COPY --from=builder-wasm /meta-secret/nook/nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm /nook-wasm

# Formatting is an independent validation leaf so `task format` can still load nook-rust and fix
# unformatted source. Normal `task setup` includes this target in its parallel prepare group.
FROM builder-debug AS rust-format-check

RUN cargo fmt --all -- --check

# Tiny host-export boundary for the web phase. `task setup` exports this scratch target to a
# temporary host directory, then gives only that directory to the final web build as a named
# context. The web solve never consumes or materializes the multi-GB builder-wasm snapshot.
FROM scratch AS web-artifacts

COPY --from=builder-wasm /meta-secret/nook/nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm /nook-wasm
COPY --from=builder-debug /opt/nook/coverage /coverage

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
