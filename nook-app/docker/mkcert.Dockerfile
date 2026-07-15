# syntax=docker/dockerfile:1.7

ARG DEBIAN_RELEASE=trixie
FROM debian:${DEBIAN_RELEASE}-slim

ARG MKCERT_VERSION=1.4.4
ARG TARGETARCH

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && case "${TARGETARCH}" in amd64|arm64) ;; *) echo "Unsupported mkcert architecture: ${TARGETARCH}" >&2; exit 1 ;; esac \
    && curl -fsSLo /usr/local/bin/mkcert \
        "https://github.com/FiloSottile/mkcert/releases/download/v${MKCERT_VERSION}/mkcert-v${MKCERT_VERSION}-linux-${TARGETARCH}" \
    && chmod 0755 /usr/local/bin/mkcert \
    && mkcert -version \
    && rm -rf /var/lib/apt/lists/*

ENTRYPOINT ["mkcert"]
