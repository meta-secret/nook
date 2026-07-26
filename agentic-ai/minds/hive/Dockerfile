FROM rust:1.96.0-bookworm@sha256:5e2214abe154fe26e39f64488952e5c991eeed1d6d6da7cc8381ae83927f0cfc AS builder

WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY lace/Cargo.toml lace/Cargo.toml
COPY hive/Cargo.toml hive/Cargo.toml
COPY lace/src lace/src
COPY hive/src hive/src
RUN cargo build --locked --release -p hive

FROM debian:13.1-slim@sha256:a347fd7510ee31a84387619a492ad6c8eb0af2f2682b916ff3e643eb076f925a

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        openssh-client \
        patch \
        python3 \
        ripgrep \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 1000 hive \
    && useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash hive

COPY --from=builder /build/target/release/hive /usr/local/bin/hive

USER 1000:1000
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/hive"]
CMD ["worker"]
