# syntax=docker/dockerfile:1
FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b AS tooling
RUN mkdir /tooling \
    && printf 'immutable utilities\n' >/tooling/installed

FROM tooling AS verification
ARG FAIL_VERIFICATION=0
ARG SOURCE_REVISION=initial
RUN test "$FAIL_VERIFICATION" = 0 \
    && test -s /tooling/installed \
    && mkdir /proof \
    && printf '%s\n' "$SOURCE_REVISION" >/proof/source-revision \
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
