# syntax=docker/dockerfile:1
# Hive-shaped cache graph: source-free Cargo inputs feed one fetch layer and
# two dependency branches. Source enters only after those reusable branches.
FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b AS toolchain
COPY inputs/base.txt /tmp/toolchain.txt
RUN cat /tmp/toolchain.txt >/opt/toolchain-stamp \
  && echo bake-sim-hive-toolchain

FROM toolchain AS fetched-dependencies
COPY inputs/parent.txt /tmp/Cargo.toml
COPY inputs/loom.txt /tmp/Cargo.lock
COPY inputs/crate-a.txt /tmp/vendor-tree
COPY inputs/crate-b.txt /tmp/crate-manifests
RUN cat /tmp/Cargo.toml /tmp/Cargo.lock /tmp/vendor-tree /tmp/crate-manifests \
    >/opt/fetched-dependencies \
  && sleep 1 \
  && echo bake-sim-hive-cargo-fetch

FROM fetched-dependencies AS test-dependencies
RUN cp /opt/fetched-dependencies /opt/test-dependencies \
  && sleep 1 \
  && echo bake-sim-hive-test-dependencies

FROM fetched-dependencies AS clippy-dependencies
RUN cp /opt/fetched-dependencies /opt/clippy-dependencies \
  && sleep 1 \
  && echo bake-sim-hive-clippy-dependencies

FROM test-dependencies AS test-source
COPY inputs/leaf.txt /tmp/hive-source
RUN cat /tmp/hive-source >/opt/test-source \
  && sleep 1 \
  && echo bake-sim-hive-test-source

FROM clippy-dependencies AS clippy-source
COPY inputs/leaf.txt /tmp/hive-source
RUN cat /tmp/hive-source >/opt/clippy-source \
  && sleep 1 \
  && echo bake-sim-hive-clippy-source

FROM scratch AS verify
COPY --from=test-source /opt/test-source /test-source
COPY --from=clippy-source /opt/clippy-source /clippy-source

# Independent console lineage: browser/tooling and package dependencies are
# source-free; only the final verification layer receives console source.
FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b AS console-browser
COPY inputs/base.txt /tmp/browser-toolchain
RUN cat /tmp/browser-toolchain >/opt/console-browser \
  && sleep 1 \
  && echo bake-sim-hive-console-browser

FROM console-browser AS console-dependencies
COPY inputs/loom.txt /tmp/bun.lock
RUN cat /tmp/bun.lock >/opt/console-dependencies \
  && sleep 1 \
  && echo bake-sim-hive-console-dependencies

FROM console-dependencies AS console-verify
COPY inputs/leaf.txt /tmp/console-source
RUN cat /tmp/console-source >/opt/console-source \
  && sleep 1 \
  && echo bake-sim-hive-console-source
