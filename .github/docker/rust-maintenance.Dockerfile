# syntax=registry.dev.nokey.sh/docker/dockerfile:1.27.0@sha256:bde3983e9c939224420ddaf6b784cc30e09b035a4dea01f581230c50809f372e
FROM rust-base AS audit-tools
RUN cargo install cargo-outdated --version 0.19.0 --locked

FROM audit-tools AS audit
WORKDIR /meta-secret/nook
COPY --from=repository-source / /meta-secret/nook
ENV RUST_DEPS_OUTDATED_REPORT=/out/report.txt GITHUB_OUTPUT=/out/result
RUN mkdir /out && bash .github/scripts/ci-rust-deps-outdated.sh

FROM scratch AS audit-export
COPY --from=audit /out/ /
