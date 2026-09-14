# syntax=docker/dockerfile:1
# Compile-shaped graph used by the warm-cache acceptance proof. Dependency
# inputs stay before package source inputs; the two package leaves are siblings
# and the final scratch target joins their already-built handoff markers.
FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b AS compile-toolchain
COPY inputs/compile-base.txt /tmp/toolchain.txt
RUN cat /tmp/toolchain.txt >/opt/compile-toolchain \
  && sleep 1 \
  && echo bake-sim-compile-toolchain

FROM compile-toolchain AS compile-hive-dependencies
COPY inputs/compile-hive-lock.txt /tmp/hive-lock.txt
RUN cat /tmp/hive-lock.txt >/opt/compile-hive-dependencies \
  && sleep 1 \
  && echo bake-sim-compile-hive-dependencies

FROM compile-toolchain AS compile-wasm-dependencies
COPY inputs/compile-wasm-manifest.txt /tmp/wasm-manifest.txt
RUN cat /tmp/wasm-manifest.txt >/opt/compile-wasm-dependencies \
  && sleep 1 \
  && echo bake-sim-compile-wasm-dependencies

FROM compile-wasm-dependencies AS compile-wasm-source-base
COPY inputs/compile-wasm-shared.txt /tmp/wasm-shared.txt
RUN cat /tmp/wasm-shared.txt >/opt/compile-wasm-source-base \
  && sleep 1 \
  && echo bake-sim-compile-wasm-source-base

FROM compile-wasm-source-base AS compile-nook-wasm-source
COPY inputs/compile-nook-wasm.txt /tmp/nook-wasm-source.txt
RUN cat /tmp/nook-wasm-source.txt >/opt/compile-nook-wasm-source \
  && sleep 1 \
  && echo bake-sim-compile-nook-wasm-source

FROM compile-wasm-source-base AS compile-companion-wasm-source
COPY inputs/compile-companion-wasm.txt /tmp/companion-wasm-source.txt
RUN cat /tmp/companion-wasm-source.txt >/opt/compile-companion-wasm-source \
  && sleep 1 \
  && echo bake-sim-compile-companion-wasm-source

FROM compile-nook-wasm-source AS compile-nook-wasm-build
RUN cat /opt/compile-nook-wasm-source >/opt/compile-nook-wasm-build \
  && sleep 1 \
  && echo bake-sim-compile-nook-wasm-build

FROM compile-companion-wasm-source AS compile-companion-wasm-build
RUN cat /opt/compile-companion-wasm-source >/opt/compile-companion-wasm-build \
  && sleep 1 \
  && echo bake-sim-compile-companion-wasm-build

FROM scratch AS compile
COPY --from=compile-hive-dependencies /opt/compile-hive-dependencies /compile/hive
COPY --from=compile-nook-wasm-build /opt/compile-nook-wasm-build /compile/nook-wasm
COPY --from=compile-companion-wasm-build /opt/compile-companion-wasm-build /compile/companion-wasm
