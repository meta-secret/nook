# syntax=registry.dev.nokey.sh/docker/dockerfile:1.27.0@sha256:bde3983e9c939224420ddaf6b784cc30e09b035a4dea01f581230c50809f372e

FROM --platform=$BUILDPLATFORM registry.dev.nokey.sh/library/golang:1.26.8-bookworm@sha256:dc9ad6c05acc7a88e5b71bde60a5fe3bd4b9f0db209011711b464107438a8107 AS source

ADD --checksum=sha256:0f7d4a765b273359d0752aa1c8a309606578fd0db42e71f0fc5de845d3b1139b \
  https://codeload.github.com/moby/buildkit/tar.gz/refs/tags/v0.34.1 /tmp/buildkit.tar.gz
WORKDIR /source
RUN tar --extract --gzip --file /tmp/buildkit.tar.gz --strip-components=1
COPY infra/k0s/images/buildkit/cache-noop.patch /tmp/cache-noop.patch
RUN git apply --check /tmp/cache-noop.patch && git apply /tmp/cache-noop.patch
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOFLAGS=-mod=vendor

FROM source AS daemon
ARG TARGETOS
ARG TARGETARCH
RUN --network=none GOOS="$TARGETOS" GOARCH="$TARGETARCH" go build -trimpath \
  -tags 'osusergo netgo static_build seccomp' \
  -ldflags '-extldflags -static -X github.com/moby/buildkit/version.Package=github.com/moby/buildkit -X github.com/moby/buildkit/version.Version=v0.34.1-nook.1 -X github.com/moby/buildkit/version.Revision=patch-sha256:4eff5ddf943d69143a96a852cbd9f6aeddd0d06ef10078c4164d80e23b0111de' \
  -o /out/buildkitd ./cmd/buildkitd

FROM source AS native-tests
COPY infra/k0s/images/buildkit/cache-noop-tests.patch /tmp/cache-noop-tests.patch
RUN git apply --check /tmp/cache-noop-tests.patch && git apply /tmp/cache-noop-tests.patch
RUN --network=none go test -c -o /usr/local/bin/cache.test ./cache
ENTRYPOINT ["timeout", "--signal=TERM", "--kill-after=10s", "900", "/usr/local/bin/cache.test"]
CMD ["-test.v", "-test.run", "TestEnsureCompression|TestLinkBlobMatchingLabelsNoop|TestLoopLeaseContent|TestSharingCompressionVariant|TestGetRemotes"]

FROM registry.dev.nokey.sh/moby/buildkit:v0.34.1-rootless@sha256:f68752a5a94acfcdad2d07867b7075601a421638e17fc5f28efc1c814d0c4f89 AS buildkit
COPY --from=daemon /out/buildkitd /usr/bin/buildkitd
