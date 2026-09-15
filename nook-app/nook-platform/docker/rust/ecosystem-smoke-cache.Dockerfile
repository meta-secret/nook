# syntax=registry.dev.nokey.sh/docker/dockerfile:1.27.0@sha256:bde3983e9c939224420ddaf6b784cc30e09b035a4dea01f581230c50809f372e

# Root the three independently executed ecosystem validation graphs beneath a
# single cache export. These tiny proof copies introduce no product behavior;
# they only make the named-context ancestry reachable by mode=max.
FROM scratch AS rust-ecosystem-smoke-cache
COPY --from=deterministic /meta-secret/nook/nook-app/nook-platform/Cargo.toml /proof/deterministic-Cargo.toml
COPY --from=fuzz /meta-secret/nook/nook-app/nook-platform/Cargo.toml /proof/fuzz-Cargo.toml
COPY --from=kani /meta-secret/nook/nook-app/nook-platform/Cargo.toml /proof/kani-Cargo.toml
