# syntax=docker/dockerfile:1
# Cheap stand-in for rust-ecosystem-nightly's pinned cargo-dylint install.
# The dependency fingerprint is copied before every mutable source input.
FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b AS rust-ecosystem-nightly
COPY inputs/dylint-dependencies.txt /tooling/dylint-dependencies.txt
RUN cat /tooling/dylint-dependencies.txt >/tooling/installed \
    && sleep 1 \
    && echo bake-sim-cargo-dylint-dependencies

FROM rust-ecosystem-nightly AS verification
ARG FAIL_VERIFICATION=0
COPY inputs/compile-web-source.txt /source/compile-web-source.txt
RUN test "$FAIL_VERIFICATION" = 0 \
    && test -s /tooling/installed \
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

FROM tests AS heavy
RUN test -s /proof/tests \
    && printf 'browser and expensive checks\n' >/proof/heavy \
    && echo pr-proof-heavy

FROM scratch AS result
COPY --from=heavy /proof /proof
