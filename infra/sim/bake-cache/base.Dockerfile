# syntax=docker/dockerfile:1
# Mock rust-base: short stamp only. Importing this scope while nesting parent
# orphans bake-sim-parent-expensive the same way short rust-base orphans nightly.
FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b
COPY inputs/base.txt /tmp/base.txt
RUN cat /tmp/base.txt >/opt/base-stamp \
  && echo bake-sim-base-layer
