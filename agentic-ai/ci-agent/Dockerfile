# syntax=registry.dev.nokey.sh/docker/dockerfile:1.4
#
# Lightweight Cursor SDK agent image. Talks to the host Docker daemon via a
# mounted /var/run/docker.sock (sibling containers — not Docker-in-Docker).
# Bind-mount the repo at runtime so the agent edits the real working tree.

ARG NODE_IMAGE=registry.dev.nokey.sh/library/node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03
ARG TASK_VERSION=3.52.0
ARG DOCKER_STATIC_VERSION=29.5.3
ARG BUILDX_VERSION=0.36.1

FROM ${NODE_IMAGE}

ARG TASK_VERSION
ARG DOCKER_STATIC_VERSION
ARG BUILDX_VERSION

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        jq \
    && rm -rf /var/lib/apt/lists/*

# Docker CLI only — daemon is the host via mounted sock.
RUN curl -fsSL "https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_STATIC_VERSION}.tgz" \
    | tar xz --strip-components=1 -C /usr/local/bin docker/docker \
    && docker --version

# Buildx is a separate CLI plugin in Docker's static distribution. Nook's Task
# targets call `docker buildx bake`, so the agent image must carry the plugin
# even though the daemon and BuildKit instance live on the host.
RUN mkdir -p /usr/local/lib/docker/cli-plugins \
    && curl -fsSL \
        "https://github.com/docker/buildx/releases/download/v${BUILDX_VERSION}/buildx-v${BUILDX_VERSION}.linux-amd64" \
        -o /usr/local/lib/docker/cli-plugins/docker-buildx \
    && chmod +x /usr/local/lib/docker/cli-plugins/docker-buildx \
    && docker buildx version

RUN curl -fsSL https://taskfile.dev/install.sh | sh -s -- -b /usr/local/bin "v${TASK_VERSION}" \
    && task --version

WORKDIR /opt/ci-agent

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
    && npm prune --omit=dev \
    && npm cache clean --force

WORKDIR /workspace

ENTRYPOINT ["node", "/opt/ci-agent/dist/main/main.js"]
CMD ["implement"]
