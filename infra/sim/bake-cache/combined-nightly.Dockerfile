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

FROM loom-deps AS leaf
COPY inputs/leaf.txt /tmp/leaf.txt
RUN cat /tmp/leaf.txt >/opt/leaf-stamp \
  && sleep 1 \
  && echo bake-sim-leaf-expensive

FROM leaf AS consumer
COPY inputs/consumer.txt /tmp/consumer.txt
RUN cat /tmp/consumer.txt >/opt/consumer-stamp \
  && sleep 1 \
  && echo bake-sim-consumer-expensive
