# syntax=docker/dockerfile:1
# Fixed production shape: base toolchain, dependencies, and the source leaf are
# stages of one Dockerfile, so the leaf's mode=max scope owns the exact lineage.
FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b AS base
COPY inputs/base.txt /tmp/base.txt
RUN cat /tmp/base.txt >/opt/base-stamp \
  && echo bake-sim-base-layer

FROM base AS parent
COPY inputs/parent.txt /tmp/parent.txt
RUN cat /tmp/parent.txt >/opt/parent-stamp \
  && sleep 1 \
  && echo bake-sim-parent-expensive

FROM parent AS loom-deps
COPY inputs/loom.txt /tmp/loom.txt
RUN cat /tmp/loom.txt >/opt/loom-stamp \
  && sleep 1 \
  && echo bake-sim-loom-deps-expensive

# Sequential crate COPY+RUN. A later crate edit must keep earlier crate RUNs
# CACHED when this one-Dockerfile leaf restores its full-graph scope.
FROM loom-deps AS crate-a
COPY inputs/crate-a.txt /tmp/crate-a.txt
RUN cat /tmp/crate-a.txt >/opt/crate-a-stamp \
  && sleep 1 \
  && echo bake-sim-crate-a-expensive

FROM crate-a AS crate-b
COPY inputs/crate-b.txt /tmp/crate-b.txt
RUN cat /tmp/crate-b.txt >/opt/crate-b-stamp \
  && sleep 1 \
  && echo bake-sim-crate-b-expensive

FROM crate-b AS leaf
COPY inputs/leaf.txt /tmp/leaf.txt
RUN cat /tmp/leaf.txt >/opt/leaf-stamp \
  && sleep 1 \
  && echo bake-sim-leaf-expensive

FROM leaf AS consumer
COPY inputs/consumer.txt /tmp/consumer.txt
RUN cat /tmp/consumer.txt >/opt/consumer-stamp \
  && sleep 1 \
  && echo bake-sim-consumer-expensive

# Dylint's standalone lint crate is independent of product source. Keep its
# expensive self-test before the product-wide source boundary.
FROM parent AS dylint-self-test
COPY inputs/crate-a.txt /tmp/dylint-crate.txt
RUN cat /tmp/dylint-crate.txt >/opt/dylint-self-test-stamp \
  && sleep 1 \
  && echo bake-sim-dylint-self-test-expensive

FROM dylint-self-test AS dylint-split
ARG PRODUCT_SOURCE
RUN test -n "$PRODUCT_SOURCE" \
  && printf '%s\n' "$PRODUCT_SOURCE" >/opt/product-source-stamp \
  && sleep 1 \
  && echo bake-sim-dylint-product-expensive

# WASM Node's OS/browser/coverage dependency vertices belong before the product source boundary.
FROM parent AS wasm-node-deps
RUN sleep 1 \
  && echo bake-sim-wasm-node-os-tooling-expensive
RUN sleep 1 \
  && echo bake-sim-wasm-node-browser-tooling-expensive
RUN sleep 1 \
  && echo bake-sim-wasm-node-coverage-dependencies-expensive

FROM wasm-node-deps AS wasm-node-source
ARG PRODUCT_SOURCE
RUN test -n "$PRODUCT_SOURCE" \
  && printf '%s\n' "$PRODUCT_SOURCE" >/opt/wasm-node-source-stamp \
  && sleep 1 \
  && echo bake-sim-wasm-node-source-expensive
RUN sleep 1 \
  && echo bake-sim-wasm-node-coverage-execution-expensive
