# syntax=docker/dockerfile:1
# Cheap stand-in for Dylint's immutable product-dependency layer. The
# dependency input is copied before the Cargo Chef and source inputs.
FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b AS dylint-deps
COPY inputs/dylint-dependencies.txt /dylint/dependencies.txt
RUN cp /dylint/dependencies.txt /dylint/installed \
    && sleep 1 \
    && echo bake-sim-cargo-dylint-product-dependencies

# Cheap stand-in for `chef-deps`' WASM release cook. Both immutable dependency
# stages remain before every mutable verification source input.
FROM dylint-deps AS chef-deps
COPY inputs/chef-dependencies.txt /chef/dependencies.txt
RUN cat /chef/dependencies.txt >/chef/cooked \
    && sleep 1 \
    && echo bake-sim-cargo-chef-wasm-release

FROM chef-deps AS verification
ARG FAIL_VERIFICATION=0
COPY inputs/compile-web-source.txt /source/compile-web-source.txt
RUN test "$FAIL_VERIFICATION" = 0 \
    && test -s /dylint/installed \
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

# Coverage remains a Docker/BuildKit verification output. It is part of the
# test solve and is never transported to the runner for a redundant report.
FROM tests AS coverage-export
RUN printf 'coverage artifacts\n' >/proof/coverage \
    && echo pr-proof-coverage

FROM chef-deps AS rust-fuzz-deps
COPY inputs/fuzz-dependencies.txt /fuzz/dependencies.txt
RUN cat /fuzz/dependencies.txt >/fuzz/installed \
    && sleep 1 \
    && echo bake-sim-fuzz-dependencies

# Heavy work consumes the already floor-validated test and coverage solve.
FROM coverage-export AS heavy
COPY --from=rust-fuzz-deps /fuzz/installed /fuzz/installed
RUN test -s /proof/tests \
    && test -s /fuzz/installed \
    && printf 'browser and expensive checks\n' >/proof/heavy \
    && echo pr-proof-heavy

FROM tests AS browser-artifacts
RUN printf 'browser artifacts\n' >/proof/browser \
    && echo pr-proof-browser

FROM scratch AS result
COPY --from=heavy /proof/verification /proof/verification
COPY --from=heavy /proof/tests /proof/tests
COPY --from=heavy /proof/heavy /proof/heavy
