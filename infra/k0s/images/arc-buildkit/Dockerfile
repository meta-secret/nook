FROM moby/buildkit:v0.32.2@sha256:28a898719c18a33f4e8000685287fa36fd0dd9560c6440227d3a732d79bb41d8

RUN apk add --no-cache e2fsprogs=1.47.3-r0 jq=1.8.1-r0

COPY entrypoint /usr/local/bin/nook-buildkit-entrypoint
COPY prepare-state /usr/local/bin/nook-buildkit-prepare-state

ENTRYPOINT ["/usr/local/bin/nook-buildkit-entrypoint"]
