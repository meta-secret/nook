# syntax=docker/dockerfile:1
# Broken production shape: a source overlay between the cached nightly parent
# and the source-sensitive leaf adds a third linked Bake target.
FROM parent AS platform
COPY inputs/platform.txt /tmp/platform.txt
RUN cat /tmp/platform.txt >/opt/platform-stamp \
  && echo bake-sim-platform-overlay
