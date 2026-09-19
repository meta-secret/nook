# syntax=docker/dockerfile:1
# Cheap stand-in for `chef-deps`' WASM release cook. The manifest-only
# dependency input is copied before every mutable verification source input.
FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b AS chef-deps
COPY inputs/chef-dependencies.txt /chef/dependencies.txt
RUN cat /chef/dependencies.txt >/chef/cooked \
    && sleep 1 \
    && echo bake-sim-cargo-chef-wasm-release

FROM chef-deps AS verification
ARG FAIL_VERIFICATION=0
COPY inputs/compile-web-source.txt /source/compile-web-source.txt
RUN test "$FAIL_VERIFICATION" = 0 \
    && test -s /chef/cooked \
    && test -s /source/compile-web-source.txt \
    && mkdir /proof \
    && sha256sum /source/compile-web-source.txt >/proof/source-content \
    && printf 'verified\n' >/proof/verification \
    && echo pr-proof-verification

FROM verification AS tests
ARG FAIL_TESTS=0
RUN test "$FAIL_TESTS" = 0 \
    && test -s /proof/verification \
    && printf 'tests and coverage\n' >/proof/tests \
    && echo pr-proof-test-compilation

FROM chef-deps AS rust-fuzz-deps
COPY inputs/fuzz-dependencies.txt /fuzz/dependencies.txt
RUN cat /fuzz/dependencies.txt >/fuzz/installed \
    && sleep 1 \
    && echo bake-sim-fuzz-dependencies

FROM tests AS heavy
COPY --from=rust-fuzz-deps /fuzz/installed /fuzz/installed
RUN test -s /proof/tests \
    && test -s /fuzz/installed \
    && printf 'browser and expensive checks\n' >/proof/heavy \
    && echo pr-proof-heavy

FROM scratch AS result
COPY --from=heavy /proof /proof
