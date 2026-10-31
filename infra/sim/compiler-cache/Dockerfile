# syntax=registry.dev.nokey.sh/docker/dockerfile:1.27.0@sha256:bde3983e9c939224420ddaf6b784cc30e09b035a4dea01f581230c50809f372e

# Use the production toolchain, strict disk/S3 configuration and actual wrappers.
FROM rust-base AS compiler-fixture
WORKDIR /opt/nook/compiler-cache-proof
ENV CARGO_TARGET_DIR=/opt/nook/compiler-cache-proof/target
ENV NOOK_SCCACHE_REPORT_DIR=/opt/nook/compiler-cache-proof/reports
COPY Cargo.toml Cargo.lock clippy.toml ./
COPY stub.rs src/lib.rs
RUN test "$SCCACHE_MULTILEVEL_CHAIN" = disk,s3 \
    && test "$SCCACHE_MULTILEVEL_WRITE_ERROR_POLICY" = all \
    && test "$SCCACHE_CLIENT_SIDE" = 0 \
    && mkdir -p /proof \
    && RUSTC_WRAPPER= cargo fetch --locked

# Native recache requests guarantee real normal writes, without clearing S3.
FROM compiler-fixture AS compiler-publisher
RUN --mount=type=secret,id=sccache_s3_access_key,required=true \
    --mount=type=secret,id=sccache_s3_secret_key,required=true \
    SCCACHE_RECACHE=1 cargo build --locked --lib \
    && nook-sccache-report --require --finish compiler-publisher \
    && jq -e '.remote_writes > 0 and .local_writes > 0' reports/compiler-publisher.json \
    && cp reports/compiler-publisher.json /proof/publisher.json

# This branch starts with empty Cargo outputs and local compiler storage.
# Copying the publication result orders it after real S3 writes have completed.
FROM compiler-fixture AS compiler-warm-parent
COPY --from=compiler-publisher /proof/publisher.json /proof/publisher.json
RUN --mount=type=secret,id=sccache_s3_access_key,required=true \
    --mount=type=secret,id=sccache_s3_secret_key,required=true \
    test ! -d "$CARGO_TARGET_DIR" \
    && cargo build --locked --lib \
    && nook-sccache-report --require --finish compiler-warm-parent \
    && jq -e '.remote_hits > 0 and .local_hits == 0' reports/compiler-warm-parent.json \
    && cp reports/compiler-warm-parent.json /proof/warm-parent.json \
    && jq -n --argjson cargo_target "$(du -sk "$CARGO_TARGET_DIR" | cut -f1)" \
      --argjson local_sccache "$(du -sk "$SCCACHE_DIR" | cut -f1)" \
      '{scope: "fixture_parent_snapshot_directories", unit: "allocated_KiB", cargo_target: $cargo_target, local_sccache: $local_sccache}' \
      > /proof/warm-parent-storage.json

# Negative control: real source is present but the actual ordinary library is
# deliberately still the compiled placeholder. Link the same probe used below
# directly to that existing rlib; never rebuild the library inside the probe.
FROM compiler-warm-parent AS compiler-negative-control
COPY src/lib.rs src/lib.rs
COPY tests/ordinary.rs tests/ordinary.rs
RUN <<'STALE_PROBE'
set -eu
rustc --edition 2024 --test -D warnings tests/ordinary.rs \
  --extern nook_compiler_cache_proof="$CARGO_TARGET_DIR/debug/libnook_compiler_cache_proof.rlib" \
  -L "dependency=$CARGO_TARGET_DIR/debug/deps" -o "$CARGO_TARGET_DIR/ordinary-probe"
set +e
"$CARGO_TARGET_DIR/ordinary-probe" > /proof/stale-ordinary-rlib.log 2>&1
probe_status="$?"
set -e
test "$probe_status" -eq 101
grep -F 'CompiledValue("706c616365686f6c646572")' /proof/stale-ordinary-rlib.log
grep -F 'CompiledValue("7265616c20736f75726365")' /proof/stale-ordinary-rlib.log
printf 'ordinary rlib probe rejected the compiled placeholder\n' > /proof/stale-ordinary-rlib-rejected
STALE_PROBE

# Both siblings inherit ordinary filesystem snapshots. Each first verifies
# Cargo freshness, then rebuilds missing fixture outputs against inherited disk
# objects. No shared writable mount or global worker limit is introduced.
FROM compiler-warm-parent AS compiler-child-a-cache
RUN --mount=type=secret,id=sccache_s3_access_key,required=true \
    --mount=type=secret,id=sccache_s3_secret_key,required=true \
    test ! -e "$SCCACHE_DIR/child-b-owner" \
    && printf 'child-a\n' > "$SCCACHE_DIR/child-a-owner" \
    && cargo build --locked --lib --message-format=json > /proof/child-a-fresh.json \
    && jq -se '[.[] | select(.reason == "compiler-artifact" and .target.name == "nook_compiler_cache_proof")] as $artifacts | ($artifacts | length) == 1 and $artifacts[0].fresh == true' /proof/child-a-fresh.json \
    && cargo clean \
    && cargo build --locked --lib \
    && nook-sccache-report --require --finish compiler-child-a-cache \
    && jq -e '.local_hits > 0 and .remote_hits == 0' reports/compiler-child-a-cache.json \
    && cp reports/compiler-child-a-cache.json /proof/child-a-cache.json \
    && cp "$SCCACHE_DIR/child-a-owner" /proof/child-a-owner

FROM compiler-child-a-cache AS compiler-child-a-real
COPY src/lib.rs src/lib.rs
COPY tests/ordinary.rs tests/ordinary.rs
RUN --mount=type=secret,id=sccache_s3_access_key,required=true \
    --mount=type=secret,id=sccache_s3_secret_key,required=true \
    touch src/lib.rs \
    && cargo fmt --all --check \
    && cargo build --locked --lib \
    && rustc --edition 2024 --test -D warnings tests/ordinary.rs \
      --extern nook_compiler_cache_proof="$CARGO_TARGET_DIR/debug/libnook_compiler_cache_proof.rlib" \
      -L "dependency=$CARGO_TARGET_DIR/debug/deps" -o "$CARGO_TARGET_DIR/ordinary-probe" \
    && "$CARGO_TARGET_DIR/ordinary-probe" > /proof/child-a-ordinary-rlib.log 2>&1 \
    && cat /proof/child-a-ordinary-rlib.log \
    && cargo check --locked --workspace --all-targets \
    && cargo clippy --locked --workspace --all-targets -- -D warnings \
    && cargo test --locked --lib \
    && nook-sccache-report --require --finish compiler-child-a-real \
    && cp reports/compiler-child-a-real.json /proof/child-a-real.json \
    && jq -n --argjson cargo_target "$(du -sk "$CARGO_TARGET_DIR" | cut -f1)" \
      --argjson local_sccache "$(du -sk "$SCCACHE_DIR" | cut -f1)" \
      '{scope: "fixture_child_snapshot_directories", unit: "allocated_KiB", cargo_target: $cargo_target, local_sccache: $local_sccache}' \
      > /proof/child-a-storage.json \
    && printf 'ordinary rlib contains real source\n' > /proof/child-a-real-source

FROM compiler-warm-parent AS compiler-child-b-cache
RUN --mount=type=secret,id=sccache_s3_access_key,required=true \
    --mount=type=secret,id=sccache_s3_secret_key,required=true \
    test ! -e "$SCCACHE_DIR/child-a-owner" \
    && printf 'child-b\n' > "$SCCACHE_DIR/child-b-owner" \
    && cargo build --locked --lib --message-format=json > /proof/child-b-fresh.json \
    && jq -se '[.[] | select(.reason == "compiler-artifact" and .target.name == "nook_compiler_cache_proof")] as $artifacts | ($artifacts | length) == 1 and $artifacts[0].fresh == true' /proof/child-b-fresh.json \
    && cargo clean \
    && cargo build --locked --lib \
    && nook-sccache-report --require --finish compiler-child-b-cache \
    && jq -e '.local_hits > 0 and .remote_hits == 0' reports/compiler-child-b-cache.json \
    && cp reports/compiler-child-b-cache.json /proof/child-b-cache.json \
    && cp "$SCCACHE_DIR/child-b-owner" /proof/child-b-owner

FROM compiler-child-b-cache AS compiler-child-b-real
COPY src/lib.rs src/lib.rs
COPY tests/ordinary.rs tests/ordinary.rs
RUN --mount=type=secret,id=sccache_s3_access_key,required=true \
    --mount=type=secret,id=sccache_s3_secret_key,required=true \
    touch src/lib.rs \
    && cargo fmt --all --check \
    && cargo build --locked --lib \
    && rustc --edition 2024 --test -D warnings tests/ordinary.rs \
      --extern nook_compiler_cache_proof="$CARGO_TARGET_DIR/debug/libnook_compiler_cache_proof.rlib" \
      -L "dependency=$CARGO_TARGET_DIR/debug/deps" -o "$CARGO_TARGET_DIR/ordinary-probe" \
    && "$CARGO_TARGET_DIR/ordinary-probe" > /proof/child-b-ordinary-rlib.log 2>&1 \
    && cat /proof/child-b-ordinary-rlib.log \
    && cargo check --locked --workspace --all-targets \
    && cargo clippy --locked --workspace --all-targets -- -D warnings \
    && cargo test --locked --lib \
    && nook-sccache-report --require --finish compiler-child-b-real \
    && cp reports/compiler-child-b-real.json /proof/child-b-real.json \
    && jq -n --argjson cargo_target "$(du -sk "$CARGO_TARGET_DIR" | cut -f1)" \
      --argjson local_sccache "$(du -sk "$SCCACHE_DIR" | cut -f1)" \
      '{scope: "fixture_child_snapshot_directories", unit: "allocated_KiB", cargo_target: $cargo_target, local_sccache: $local_sccache}' \
      > /proof/child-b-storage.json \
    && printf 'ordinary rlib contains real source\n' > /proof/child-b-real-source

FROM scratch AS compiler-result
COPY --from=compiler-child-a-real /proof/ /proof/
COPY --from=compiler-child-b-real /proof/ /proof/
COPY --from=compiler-negative-control /proof/stale-ordinary-rlib.log /proof/stale-ordinary-rlib.log
COPY --from=compiler-negative-control /proof/stale-ordinary-rlib-rejected /proof/stale-ordinary-rlib-rejected
