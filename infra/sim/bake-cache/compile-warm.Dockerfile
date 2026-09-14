# syntax=docker/dockerfile:1
# Compile-shaped graph used by the warm-cache acceptance proof. Dependency
# inputs stay before package source inputs. The expensive WASM compiler leaves
# form the exported target's ancestry so mode=min retains their cache records.
FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b AS compile-toolchain-image
COPY inputs/compile-base.txt /tmp/toolchain.txt
RUN cat /tmp/toolchain.txt >/opt/compile-toolchain \
  && sleep 1 \
  && echo bake-sim-compile-toolchain

FROM toolchain-base AS compile-toolchain

ARG SIMULATED_BUILD_PROFILE=production
ARG SIMULATED_SCCACHE_CLIENT_SIDE=1
ENV SCCACHE_S3_RW_MODE=READ_ONLY
RUN test "$SIMULATED_BUILD_PROFILE" = production

# Every dependency compiler is a direct ancestor of the exported dependency
# target. This models the production root contract instead of a scratch marker
# join that can discard the reusable compiler records.
FROM compile-toolchain AS compile-native-dependencies
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    test "$(cat /run/secrets/sccache_runtime_mode)" = READ_WRITE \
  && { test "$SIMULATED_SCCACHE_CLIENT_SIDE" = 1 \
    || { echo 'NOOK_SCCACHE_PUBLICATION_FAILURE {"cache_errors":0,"cache_misses":1,"cache_writes":0}' >&2; exit 1; }; } \
  && echo bake-sim-sccache-write \
  && echo 'NOOK_SCCACHE_AUTHORITY baked_runtime_mode=READ_ONLY runtime_mode=READ_WRITE runtime_mode_source=runtime_secret' \
  && cat /opt/compile-toolchain >/opt/compile-native-dependencies \
  && sleep 1 \
  && echo bake-sim-compile-native-dependencies

FROM compile-native-dependencies AS compile-wasm-dependencies
COPY inputs/compile-wasm-manifest.txt /tmp/wasm-manifest.txt
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    cat /tmp/wasm-manifest.txt >/opt/compile-wasm-dependencies \
  && sleep 1 \
  && echo bake-sim-compile-wasm-dependencies

FROM compile-wasm-dependencies AS compile-hive-dependencies
COPY inputs/compile-hive-lock.txt /tmp/hive-lock.txt
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    cat /tmp/hive-lock.txt >/opt/compile-hive-dependencies \
  && sleep 1 \
  && echo bake-sim-compile-hive-dependencies

FROM compile-hive-dependencies AS compile-hive-console-dependencies
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    cat /opt/compile-hive-dependencies >/opt/compile-hive-console-dependencies \
  && sleep 1 \
  && echo bake-sim-compile-hive-console-dependencies

FROM compile-hive-console-dependencies AS compile-web-app-dependencies
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    cat /opt/compile-hive-console-dependencies >/opt/compile-web-app-dependencies \
  && sleep 1 \
  && echo bake-sim-compile-web-app-dependencies

FROM compile-web-app-dependencies AS compile-web-dependencies
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    cat /opt/compile-web-app-dependencies >/opt/compile-web-dependencies \
  && sleep 1 \
  && echo bake-sim-compile-web-dependencies

FROM compile-hive-dependencies AS compile-hive-source
COPY inputs/compile-hive-source.txt /tmp/hive-source.txt
RUN cat /tmp/hive-source.txt >/opt/compile-hive-source \
  && sleep 1 \
  && echo bake-sim-compile-hive-source

FROM compile-wasm-dependencies AS compile-wasm-source-base
COPY inputs/compile-wasm-shared.txt /tmp/wasm-shared.txt
RUN cat /tmp/wasm-shared.txt >/opt/compile-wasm-source-base \
  && sleep 1 \
  && echo bake-sim-compile-wasm-source-base

FROM compile-wasm-source-base AS compile-companion-wasm-source
COPY inputs/compile-companion-wasm.txt /tmp/companion-wasm-source.txt
RUN cat /tmp/companion-wasm-source.txt >/opt/compile-companion-wasm-source \
  && sleep 1 \
  && echo bake-sim-compile-companion-wasm-source

FROM compile-companion-wasm-source AS compile-companion-wasm-build
RUN cat /opt/compile-companion-wasm-source >/opt/compile-companion-wasm-build \
  && sleep 1 \
  && echo bake-sim-compile-companion-wasm-build

# Exact source publication is mode=min, so the reusable compiler vertices must
# be ancestors of the exported target. A scratch join of sibling leaves only
# preserves the joined marker layers and reproduces the production miss where
# unchanged WASM compilers rerun on every new commit.
FROM compile-companion-wasm-build AS compile-nook-wasm-source
COPY inputs/compile-nook-wasm.txt /tmp/nook-wasm-source.txt
RUN cat /tmp/nook-wasm-source.txt >/opt/compile-nook-wasm-source \
  && sleep 1 \
  && echo bake-sim-compile-nook-wasm-source

FROM compile-nook-wasm-source AS compile-nook-wasm-build
RUN --mount=type=secret,id=sccache_runtime_mode,required=true \
    test "$(cat /run/secrets/sccache_runtime_mode)" = READ_WRITE \
  && echo bake-sim-sccache-hit \
  && cat /opt/compile-nook-wasm-source >/opt/compile-nook-wasm-build \
  && sleep 1 \
  && echo bake-sim-compile-nook-wasm-build

# Product web sources are a narrow input domain. An unrelated policy/catalog
# file in this build context must not participate in this COPY digest.
FROM compile-web-dependencies AS compile-web-source
COPY inputs/compile-web-source.txt /tmp/web-source.txt
COPY inputs/compile-web-legal.txt /tmp/web-legal.txt
RUN cat /tmp/web-source.txt >/opt/compile-web-source \
  && cat /tmp/web-legal.txt >>/opt/compile-web-source \
  && sleep 1 \
  && echo bake-sim-compile-web-source

# The real commit identity belongs only to extension packaging. Declaring the
# ARG earlier would make every preceding web RUN vary for each repository head.
FROM compile-web-source AS compile-extension-package
COPY inputs/compile-extension-locales.txt /tmp/extension-locales.txt
ARG SIMULATED_EXTENSION_COMMIT=
RUN test -n "$SIMULATED_EXTENSION_COMMIT" \
  && test -s /tmp/extension-locales.txt \
  && printf '%s\n' "$SIMULATED_EXTENSION_COMMIT" >/opt/compile-extension-package \
  && sleep 1 \
  && echo bake-sim-compile-extension-package

FROM compile-web-dependencies AS compile-dependency-cache
RUN install -D /opt/compile-native-dependencies /compile/native \
  && install -D /opt/compile-wasm-dependencies /compile/wasm \
  && install -D /opt/compile-hive-dependencies /compile/hive \
  && install -D /opt/compile-hive-console-dependencies /compile/hive-console \
  && install -D /opt/compile-web-app-dependencies /compile/web-app \
  && install -D /opt/compile-web-dependencies /compile/web

FROM compile-nook-wasm-build AS compile
COPY --from=compile-hive-source /opt/compile-hive-source /compile/hive
COPY --from=compile-web-source /opt/compile-web-source /compile/web
COPY --from=compile-extension-package /opt/compile-extension-package /compile/extension
RUN install -D /opt/compile-nook-wasm-build /compile/nook-wasm \
  && install -D /opt/compile-companion-wasm-build /compile/companion-wasm
