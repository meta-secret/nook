# syntax=docker/dockerfile:1
# Fixed production shape: nightly tools and the source leaf are stages of one
# Dockerfile, so the leaf's mode=max scope owns the exact parent lineage.
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
