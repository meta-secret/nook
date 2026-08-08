# syntax=docker/dockerfile:1
# Fixed production shape: base toolchain, dependencies, and the source leaf are
# stages of one Dockerfile, so the leaf's mode=max scope owns the exact lineage.
FROM alpine:3.21.3@sha256:a8560b36e8b8210634f77d9f7f9efd7ffa463e380b75e2e74aff4511df3ef88c AS base
COPY inputs/base.txt /tmp/base.txt
RUN cat /tmp/base.txt >/opt/base-stamp \
  && echo bake-sim-base-layer

FROM base AS parent
COPY inputs/parent.txt /tmp/parent.txt
RUN cat /tmp/parent.txt >/opt/parent-stamp \
  && sleep 1 \
  && echo bake-sim-parent-expensive

FROM parent AS leaf
COPY inputs/leaf.txt /tmp/leaf.txt
RUN cat /tmp/leaf.txt >/opt/leaf-stamp \
  && sleep 1 \
  && echo bake-sim-leaf-expensive
