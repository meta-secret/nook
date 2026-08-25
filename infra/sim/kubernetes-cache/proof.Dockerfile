ARG BASE_IMAGE=registry.dev.nokey.sh/library/alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b
FROM ${BASE_IMAGE}
ARG CACHE_PROOF_INPUT
RUN mkdir -p /proof && printf '%s' "${CACHE_PROOF_INPUT}" > /proof/input.txt && echo cache-proof-execution-marker
