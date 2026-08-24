# syntax=docker/dockerfile:1

ARG RUST_VERSION=1.97
ARG DEBIAN_RELEASE=trixie
ARG RUST_DIGEST=sha256:3382bd20aa942806c533e9a73cd000474fb3ef173f71e684cc9b942675781769

FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS bun
FROM node:24-trixie-slim@sha256:0711b541c1c33a8a530ac4f0d391baa9a15b3d804695b1b24a47daa5fb60e74d AS node
FROM rust:${RUST_VERSION}-${DEBIAN_RELEASE}@${RUST_DIGEST}

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN rustup component add rustfmt

WORKDIR /opt/nook-formatter
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY format.sh /usr/local/bin/nook-format
RUN chmod 0755 /usr/local/bin/nook-format

WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/nook-format"]
