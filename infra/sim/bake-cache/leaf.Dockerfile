# syntax=docker/dockerfile:1
# Mock rust-dylint leaf: own expensive RUN on top of parent context.
FROM parent
COPY inputs/leaf.txt /tmp/leaf.txt
RUN cat /tmp/leaf.txt >/opt/leaf-stamp \
  && sleep 1 \
  && echo bake-sim-leaf-expensive
