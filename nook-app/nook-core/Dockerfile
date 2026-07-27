# syntax=docker/dockerfile:1.4

# Native source verification extends the self-contained dependency targets from base.Dockerfile.
FROM builder-deps AS builder-debug

WORKDIR /meta-secret/nook/nook-app

COPY nook-app/Cargo.toml nook-app/Cargo.lock ./
COPY nook-app/.config .config

# Source-sensitive verification layers are ordered by Rust dependency edge. A nook-core-only change
# can reuse the nook-auth2 clippy and coverage-test layers; a nook-wasm-only change can reuse both.
COPY nook-app/nook-auth2 nook-auth2
RUN cargo clippy -p nook-auth2 --all-targets -- -D warnings \
    && nook-sccache-report native-auth-clippy
# --no-clean keeps the manifest-keyed instrumented dependencies warmed above. cargo-llvm-cov does
# not allow --no-clean with --no-report, so this first source-level run emits its interim report;
# the nook-core run below then extends the same coverage session and enforces the combined floor.
RUN cargo llvm-cov nextest --no-clean --profile ci -p nook-auth2 \
    && nook-sccache-report native-auth-coverage

COPY nook-app/nook-replication nook-replication
RUN cargo clippy -p nook-replication --all-targets -- -D warnings \
    && nook-sccache-report native-replication-clippy
RUN cargo llvm-cov nextest --no-clean --profile ci -p nook-replication \
    && nook-sccache-report native-replication-coverage

COPY nook-app/nook-event-log nook-event-log
RUN cargo clippy -p nook-event-log --all-targets -- -D warnings \
    && nook-sccache-report native-event-log-clippy
RUN cargo llvm-cov nextest --no-clean --profile ci -p nook-event-log \
    && nook-sccache-report native-event-log-coverage

COPY nook-app/nook-core nook-core
# Docker COPY preserves source mtimes, while the inherited target directory can
# contain newer artifacts. Touch the module that embeds locale JSON so changes
# to those non-Rust inputs always reach both the native and downstream WASM
# builds instead of reusing a stale include_str! result.
RUN touch nook-core/src/i18n.rs \
    && cargo clippy -p nook-core --all-targets -- -D warnings \
    && nook-sccache-report native-core-clippy
# Coverage runs HERE, in the image build (not at task runtime): cargo-llvm-cov first runs nook-auth2,
# nook-replication, and nook-event-log above, then runs nook-core with --no-clean so the final report combines all
# portable crates while preserving cacheable dependency coverage. The same run also bakes the
# coverage artifacts that PR CI copies out later;
# export must not rerun the Rust tests.
RUN FLOOR="$(jq -r '.lines_percent' nook-core/coverage-floor.json)" \
    && mkdir -p /opt/nook/coverage/nook-core \
    && cargo llvm-cov nextest --no-clean --profile ci -p nook-core --summary-only > /tmp/nook-core-coverage-summary.txt \
    && cargo llvm-cov report -p nook-core -p nook-auth2 -p nook-replication -p nook-event-log --summary-only --fail-under-lines "$FLOOR" > /opt/nook/coverage/nook-core/summary.txt \
    && cargo llvm-cov report -p nook-core -p nook-auth2 -p nook-replication -p nook-event-log --json --summary-only > /opt/nook/coverage/nook-core/summary.json \
    && cargo llvm-cov report -p nook-core -p nook-auth2 -p nook-replication -p nook-event-log --lcov --output-path /opt/nook/coverage/nook-core/lcov.info \
    && cp nook-core/coverage-floor.json /opt/nook/coverage/nook-core/coverage-floor.json \
    && nook-sccache-report native-core-coverage

COPY nook-app/nook-wasm nook-wasm

# Export only the small, already-computed coverage payload. This target deliberately branches
# before the WASM/web production stages so a PR fallback never materializes the multi-GB app image.
FROM scratch AS coverage-export

COPY --from=builder-debug /opt/nook/coverage/nook-core/ /
