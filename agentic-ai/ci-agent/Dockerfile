# syntax=docker/dockerfile:1.4
#
# Lightweight Cursor SDK agent image. Talks to the host Docker daemon via a
# mounted /var/run/docker.sock (sibling containers — not Docker-in-Docker).
# Bind-mount the repo at runtime so the agent edits the real working tree.

ARG NODE_IMAGE=node:24-bookworm-slim
ARG TASK_VERSION=3.42.1
ARG DOCKER_STATIC_VERSION=27.5.1

FROM ${NODE_IMAGE}

ARG TASK_VERSION
ARG DOCKER_STATIC_VERSION

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
