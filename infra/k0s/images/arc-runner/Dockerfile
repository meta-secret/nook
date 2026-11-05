# syntax=registry.dev.nokey.sh/docker/dockerfile:1.27.0@sha256:bde3983e9c939224420ddaf6b784cc30e09b035a4dea01f581230c50809f372e

FROM registry.dev.nokey.sh/library/node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS hooks

ADD --checksum=sha256:3ed29df5e340209ff43447749184b7c041ec7bf98ece88bfd1cf5ad53781790d \
  https://codeload.github.com/actions/runner-container-hooks/tar.gz/d21e5b430e78919ed73b7690a377723bf2a34d8e \
  /tmp/runner-container-hooks.tar.gz
COPY infra/k0s/images/arc-runner/runner-container-hooks-v0.8.1.patch /tmp/runner-container-hooks.patch

RUN apt-get update \
  && apt-get install --yes --no-install-recommends patch \
  && mkdir /source \
  && tar --extract --gzip --file /tmp/runner-container-hooks.tar.gz \
    --directory /source --strip-components=1 \
  && patch --directory /source --strip=1 < /tmp/runner-container-hooks.patch \
  && npm run bootstrap --prefix /source \
  && npm run build --prefix /source/packages/hooklib \
  && npm run build --prefix /source/packages/k8s

FROM ghcr.io/actions/actions-runner:2.338.2@sha256:759a1d94a15b05941aba5196974ff43fe15b4cbba29b694b35cbc32a1166b232 AS arc-runner

COPY --from=hooks --chown=runner:runner /source/packages/k8s/dist/index.js /home/runner/k8s-novolume/index.js

USER runner

FROM arc-runner AS proof

RUN grep -F "Synchronizing repository actions" /home/runner/k8s-novolume/index.js \
  && grep -F "Synchronizing downloaded action" /home/runner/k8s-novolume/index.js \
  && grep -F "execCpFromPod" /home/runner/k8s-novolume/index.js
