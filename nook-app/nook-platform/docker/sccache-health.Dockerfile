# syntax=registry.dev.nokey.sh/docker/dockerfile:1.4

FROM registry.dev.nokey.sh/amazon/aws-cli:2.27.50@sha256:48c3d4212e2f5b0e24bdc6af7708f9412ce65425a79575e0f78b8f8c0dcd70ab

ARG SCCACHE_ENDPOINT
ARG SCCACHE_BUCKET

RUN --mount=type=secret,id=sccache_s3_access_key \
    --mount=type=secret,id=sccache_s3_secret_key \
    AWS_ACCESS_KEY_ID="$(cat /run/secrets/sccache_s3_access_key)" \
    AWS_SECRET_ACCESS_KEY="$(cat /run/secrets/sccache_s3_secret_key)" \
    AWS_DEFAULT_REGION=auto \
    aws --endpoint-url "$SCCACHE_ENDPOINT" \
    s3api head-bucket --bucket "$SCCACHE_BUCKET"
