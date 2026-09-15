# syntax=registry.dev.nokey.sh/docker/dockerfile:1.27.0@sha256:bde3983e9c939224420ddaf6b784cc30e09b035a4dea01f581230c50809f372e

# Root the reusable deterministic source graph, nightly tools, and Kani
# toolchain beneath one export before any terminal validation executes.
FROM scratch AS rust-ecosystem-smoke-cache
COPY --from=deterministic /usr/local/cargo/bin/cargo /proof/cargo
COPY --from=fuzz /usr/local/cargo/bin/cargo-fuzz /proof/cargo-fuzz
COPY --from=kani /usr/local/cargo/bin/cargo-kani /proof/cargo-kani
