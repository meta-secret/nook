# syntax=docker/dockerfile:1.4

# --- Rust ecosystem gates ---
# Same Dockerfile as rust-base, but separate Bake images/stages so product builds
# do not inherit deny/audit/fuzz/dylint or a second nightly toolchain.

FROM rust-base AS rust-ecosystem-policy-tools

ARG CARGO_DENY_VERSION=0.20.2
ARG CARGO_DENY_SHA256=9f12ed4c49936e09b48bf862b595cde2fe64fcbd9d74dfacac6131ca824c8d5f
ARG CARGO_AUDIT_VERSION=0.22.2
ARG CARGO_AUDIT_SHA256=7fb9497f8594b389e5fce5ef9b92db08432996895b2e0c5a0167a69ed445c428

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL \
      "https://github.com/EmbarkStudios/cargo-deny/releases/download/${CARGO_DENY_VERSION}/cargo-deny-${CARGO_DENY_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
      -o /tmp/cargo-deny.tgz \
    && echo "${CARGO_DENY_SHA256}  /tmp/cargo-deny.tgz" | sha256sum -c - \
    && tar xzf /tmp/cargo-deny.tgz -C /tmp \
    && install -m 0755 \
      "/tmp/cargo-deny-${CARGO_DENY_VERSION}-x86_64-unknown-linux-musl/cargo-deny" \
      /usr/local/cargo/bin/cargo-deny \
    && rm -rf /tmp/cargo-deny.tgz \
      "/tmp/cargo-deny-${CARGO_DENY_VERSION}-x86_64-unknown-linux-musl" \
    && cargo-deny --version

RUN curl -fsSL \
      "https://github.com/rustsec/rustsec/releases/download/cargo-audit%2Fv${CARGO_AUDIT_VERSION}/cargo-audit-x86_64-unknown-linux-musl-v${CARGO_AUDIT_VERSION}.tgz" \
      -o /tmp/cargo-audit.tgz \
    && echo "${CARGO_AUDIT_SHA256}  /tmp/cargo-audit.tgz" | sha256sum -c - \
    && tar xzf /tmp/cargo-audit.tgz -C /tmp \
    && install -m 0755 \
      "/tmp/cargo-audit-x86_64-unknown-linux-musl-v${CARGO_AUDIT_VERSION}/cargo-audit" \
      /usr/local/cargo/bin/cargo-audit \
    && rm -rf /tmp/cargo-audit.tgz \
      "/tmp/cargo-audit-x86_64-unknown-linux-musl-v${CARGO_AUDIT_VERSION}" \
    && cargo-audit --version

FROM rust-ecosystem-policy-tools AS rust-ecosystem-dependency-policy

ARG WORKSPACE
ARG POLICY_RUN_NONCE
WORKDIR /meta-secret/nook

RUN --mount=type=bind,source=.,target=/meta-secret/nook,readonly \
    test -n "$WORKSPACE" \
    && test -n "$POLICY_RUN_NONCE" \
    && cargo-deny --manifest-path "$WORKSPACE/Cargo.toml" --log-level error check --hide-inclusion-graph \
    && cd "$WORKSPACE" \
    && cargo-audit audit --quiet
