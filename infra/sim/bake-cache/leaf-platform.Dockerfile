# syntax=docker/dockerfile:1
# Leaf reached through the extra platform target (the pre-fix topology).
FROM platform
COPY inputs/leaf.txt /tmp/leaf.txt
RUN cat /tmp/leaf.txt >/opt/leaf-stamp \
  && sleep 1 \
  && echo bake-sim-leaf-expensive
