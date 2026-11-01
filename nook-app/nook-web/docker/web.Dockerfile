# syntax=registry.dev.nokey.sh/docker/dockerfile:1.27.0@sha256:bde3983e9c939224420ddaf6b784cc30e09b035a4dea01f581230c50809f372e

# Web/e2e lineage. Independent of the Rust toolchain and Cargo target/. Bun owns package installs;
# a pinned Node binary is present only for Playwright workers.

FROM registry.dev.nokey.sh/library/debian:trixie-slim AS web-base

ENV BUN_VERSION=1.3.14
ENV TASK_VERSION=3.52.0
# Node binary only — Playwright workers need it. Pin version + sha256; npm/npx stay out.
ENV NODE_VERSION=24.19.0
ENV NODE_SHA256=f625d97cd707df4ff96254916fbc5ff014f09c09effe5a1e0ca8f6d41a8789d4

ENV BUN_INSTALL=/usr/local/bun
ENV PATH="${BUN_INSTALL}/bin:${PATH}"
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/nook/ms-playwright

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        jq \
        unzip \
        zip \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash -s -- "bun-v${BUN_VERSION}"
RUN curl -fsSL \
      "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz" \
      -o /tmp/node.tar.gz \
    && echo "${NODE_SHA256}  /tmp/node.tar.gz" | sha256sum -c - \
    && tar xzf /tmp/node.tar.gz -C /tmp \
    && install -m 0755 \
      "/tmp/node-v${NODE_VERSION}-linux-x64/bin/node" \
      /usr/local/bin/node \
    && rm -rf /tmp/node.tar.gz "/tmp/node-v${NODE_VERSION}-linux-x64" \
    && node --version
RUN sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -b /usr/local/bin "v${TASK_VERSION}"

WORKDIR /meta-secret/nook

# Browser binaries are deliberately outside web-base. PR checks use web-base for unit tests and
# preview builds. Main/manual e2e uses Debian's Chromium and ffmpeg packages instead of Playwright's
# bundled Chromium + headless-shell download, which otherwise produces a ~1.3 GB image layer.
FROM web-base AS web-e2e-base

ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium ffmpeg xvfb \
    && rm -rf /var/lib/apt/lists/*

# Local S3 server (SeaweedFS weed mini) that Playwright's webServer starts. Pin version + sha256;
# the host-native install in nook-web-extension/Taskfile.yml pins the same release.
ENV SEAWEEDFS_VERSION=4.48
ENV SEAWEEDFS_SHA256=4a7d108384d044d95212d1342cdda9533fa55842c1c9b41f606ca3c8a9561124

RUN curl -fsSL \
      "https://github.com/seaweedfs/seaweedfs/releases/download/${SEAWEEDFS_VERSION}/linux_amd64.tar.gz" \
      -o /tmp/seaweedfs.tar.gz \
    && echo "${SEAWEEDFS_SHA256}  /tmp/seaweedfs.tar.gz" | sha256sum -c - \
    && tar xzf /tmp/seaweedfs.tar.gz -C /tmp weed \
    && install -m 0755 /tmp/weed /usr/local/bin/weed \
    && rm -f /tmp/seaweedfs.tar.gz /tmp/weed \
    && weed version
