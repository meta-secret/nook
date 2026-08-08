# syntax=docker/dockerfile:1
# Mock rust-ecosystem-nightly: expensive RUN on top of base context.
FROM base
COPY inputs/parent.txt /tmp/parent.txt
RUN cat /tmp/parent.txt >/opt/parent-stamp \
  && sleep 1 \
  && echo bake-sim-parent-expensive
