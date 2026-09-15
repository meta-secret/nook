# syntax=docker/dockerfile:1
# Nested nightly: FROM Bake-context base (mirrors rust-ecosystem-nightly FROM rust-base).
# Short base cache-from orphans bake-sim-parent-expensive on restore.
FROM base
COPY inputs/parent.txt /tmp/parent.txt
RUN cat /tmp/parent.txt >/opt/parent-stamp \
  && sleep 1 \
  && echo bake-sim-parent-expensive
