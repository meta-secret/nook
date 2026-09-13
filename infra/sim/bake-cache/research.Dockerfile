# syntax=docker/dockerfile:1
# Mock nook-web-research's separate Bun package lineage. There is intentionally
# no top-level nook-app/nook-web manifest: the research package owns its own
# package.json and bun.lock under the research app directory.
FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b AS web-base
COPY inputs/base.txt /tmp/base.txt
RUN cat /tmp/base.txt >/opt/base-stamp \
  && echo bake-sim-research-base

FROM web-base AS app-dependencies
# The app and research packages are independent Bun lineages, just like the
# production web-app-deps and web-research-deps Bake targets.
COPY inputs/app-package.txt /tmp/nook-web-app/package.json
COPY inputs/app-lock.txt /tmp/nook-web-app/bun.lock
RUN cat /tmp/nook-web-app/package.json /tmp/nook-web-app/bun.lock \
    >/opt/app-node-modules \
  && sleep 1 \
  && echo bake-sim-web-app-bun-deps-expensive

FROM web-base AS research-dependencies
# These fixtures represent the research app's package.json and bun.lock. They
# are source-free inputs, so source edits must not invalidate Bun installation.
COPY inputs/research-package.txt /tmp/nook-web-research/package.json
COPY inputs/research-lock.txt /tmp/nook-web-research/bun.lock
RUN cat /tmp/nook-web-research/package.json /tmp/nook-web-research/bun.lock \
    >/opt/research-node-modules \
  && sleep 1 \
  && echo bake-sim-research-bun-deps-expensive

FROM research-dependencies AS research-source
COPY inputs/research-source.txt /tmp/nook-web-research/src/research.txt
RUN cat /tmp/nook-web-research/src/research.txt >/opt/research-source \
  && sleep 1 \
  && echo bake-sim-research-source-expensive

FROM scratch AS verify
COPY --from=research-source /opt/research-node-modules /research-node-modules
COPY --from=research-source /opt/research-source /research-source

FROM scratch AS app-verify
COPY --from=app-dependencies /opt/app-node-modules /app-node-modules
