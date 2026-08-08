# syntax=docker/dockerfile:1
# Mock rust-base: short stamp only. Importing this scope while nesting parent
# orphans bake-sim-parent-expensive the same way short rust-base orphans nightly.
FROM alpine:3.21.3@sha256:a8560b36e8b8210634f77d9f7f9efd7ffa463e380b75e2e74aff4511df3ef88c
COPY inputs/base.txt /tmp/base.txt
RUN cat /tmp/base.txt >/opt/base-stamp \
  && echo bake-sim-base-layer
