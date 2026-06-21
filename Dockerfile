FROM rust:1.96-bookworm

ARG BUN_VERSION=1.3.14
ARG TASK_VERSION=3.42.1
ARG WASM_PACK_VERSION=0.15.0
ARG BINARYEN_VERSION=122

ENV BUN_INSTALL=/usr/local/bun
ENV PATH="${BUN_INSTALL}/bin:${PATH}"

# System packages
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*

# Bun
RUN curl -fsSL https://bun.sh/install | bash -s -- "bun-v${BUN_VERSION}"

# Task runner
RUN arch="$(dpkg --print-architecture)" \
    && curl -fsSL "https://github.com/go-task/task/releases/download/v${TASK_VERSION}/task_linux_${arch}.tar.gz" \
        | tar -xz -C /usr/local/bin task

# Rust toolchain
RUN rustup component add rustfmt clippy \
    && rustup target add wasm32-unknown-unknown

# wasm-pack
RUN arch="$(dpkg --print-architecture)" \
    && case "${arch}" in \
        amd64) target="x86_64-unknown-linux-musl" ;; \
        arm64) target="aarch64-unknown-linux-musl" ;; \
        *) echo "Unsupported: ${arch}" >&2; exit 1 ;; \
    esac \
    && curl -fsSL "https://github.com/rustwasm/wasm-pack/releases/download/v${WASM_PACK_VERSION}/wasm-pack-v${WASM_PACK_VERSION}-${target}.tar.gz" \
        | tar -xz --strip-components=1 -C /usr/local/bin "wasm-pack-v${WASM_PACK_VERSION}-${target}/wasm-pack"

# Binaryen (wasm-opt)
RUN arch="$(dpkg --print-architecture)" \
    && case "${arch}" in \
        amd64) target="x86_64-linux" ;; \
        arm64) target="aarch64-linux" ;; \
        *) echo "Unsupported: ${arch}" >&2; exit 1 ;; \
    esac \
    && curl -fsSL "https://github.com/WebAssembly/binaryen/releases/download/version_${BINARYEN_VERSION}/binaryen-version_${BINARYEN_VERSION}-${target}.tar.gz" \
        | tar -xz --strip-components=2 -C /usr/local/bin "binaryen-version_${BINARYEN_VERSION}/bin"

WORKDIR /workspace
