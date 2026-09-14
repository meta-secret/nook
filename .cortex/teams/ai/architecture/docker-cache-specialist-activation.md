# Docker Cache Specialist Activation

## Purpose

This policy defines deterministic routing to SRE's permanent Docker Cache
Specialist. The specialist owns cache diagnosis and repair. Delivery Pipeline
continues to own GitHub execution mechanics.

## Required actions

- Cover every Docker or BuildKit-bearing job in `.github/workflows/pr.yml`.
- Enforce a five-minute hard timeout for ordinary `build:compile` executions.
- Produce canonical JSON and human-readable Markdown from the same telemetry
  model. Save both as evidence, route only from JSON reason codes, and use
  Markdown only as human diagnostic context.
- Activate the specialist when JSON reports:
  - `job-timeout`, `job-cancelled`, `cache-health-gate-failed`,
    `telemetry-missing-or-incomplete`, or `required-import-miss`;
  - `effective-solve-input-mismatch` when cache-sharing builds resolve
    different Bake inputs;
  - `unreachable-cache-root` when an imported manifest does not retain needed
    reusable dependency or compiler ancestry;
  - `unrelated-input-cache-invalidation` when a compiler stage includes a
    change outside its semantic input domain;
  - `sccache-compiler-failure` for a terminal compiler failure;
  - `sccache-transport-fallback` for startup, credential, read, or write
    failure that opens the direct-compiler circuit and requires telemetry;
  - `sccache-readiness-contract-violation` when a Docker `RUN` repeats startup,
    exceeds the startup budget, or does not share circuit state;
  - `unexpected-buildkit-export`, `severe-cache-hit-regression`, or
    `diagnostic-flag`.
- Give the specialist canonical JSON, the Markdown report, BuildKit logs, job
  and run identity, and the captured source commit. Diagnose before editing.
- Use ordinary stable Docker layers for reusable dependency and toolchain
  ancestry. Secret availability is the sole remote-cache boundary: a job with
  the shared cache credential pair uses remote sccache `READ_WRITE`; a job
  without it performs direct compilation and has no remote-cache access.
- Carry stable sccache authority through a stable-ID runtime secret, or an
  equivalently cache-key-neutral runtime input, mounted identically by all
  compiler vertices. Never encode cache availability in an argument,
  environment variable, context, platform, output, or command shape that
  divides their BuildKit keys.
- Treat exact-SHA `mode=min` cache as optional same-head retry acceleration,
  never as a prerequisite for an ordinary changed-head build.
- Compare every effective invocation-shaping argument, context, platform, and
  output for builds expected to share cache. Bake inheritance is declaration
  reuse; a CLI override on one target does not retroactively alter another.
- Require exported cache roots to retain reusable dependency and compiler
  vertices. Reject scratch, marker-only, and synthetic joins that orphan them.
- Isolate Rust, WASM, Hive, and web compiler inputs by semantic domain. Never
  broadly copy the repository root. Introduce per-head arguments at the latest
  consumer boundary and keep cross-domain artifact handoffs narrow.
- Require simulator and proof coverage for cache-policy and compiler-domain
  changes. Unrelated-domain mutations remain cached; relevant-domain mutations
  invalidate only expected vertices.
- Prove two ordinary unseeded heads: the first publishing head populates remote
  compiler entries; a subsequent changed head obtains sccache hits and finishes
  within five minutes; an appropriate same-head no-BuildKit-export replay
  performs zero registry exports while retaining sccache access.
- Allow one two-second startup attempt per Docker `RUN`, share readiness and
  circuit state, and fall back after missing credentials, startup, DNS,
  object-read, or write failure. Emit sanitized `NOOK_SCCACHE_FALLBACK` and
  health telemetry without exposing transport or credential details.
- Keep genuine compiler failures terminal after fallback.
- Preserve simulator/proof coverage for startup failure, DNS/read/write
  failure, shared open circuit, compiler failure, and healthy single startup.
- Require the canonical Docker simulator and proof for every repair. Route all
  workflow dispatch, status, rerun, and GitHub mechanics through Delivery.
- Repeat the bounded diagnosis, repair, and evidence loop for the latest
  canonical feature head until green or concretely blocked.
- Work only in the issued branch/worktree. During feature work use static
  syntax, formatting, and diff inspection only.

## Prohibited actions

- Do not dispatch for a green verdict, parse Markdown for routing, run analysis
  unconditionally, or silently pass absent telemetry.
- Do not add a separate cache-population workflow or require preparatory work
  before an ordinary build can populate and consume compiler cache entries.
- Do not infer solve parity from Bake inheritance or manifest import, or treat
  a marker/scratch/join result as proof of reachable cache ancestry.
- Do not use repository-root compiler copies, leak compiler domains, or apply
  per-head arguments above their latest semantic consumer.
- Do not execute GitHub, PR, publication, landing, or promotion mechanics.
- Do not retry sccache after its circuit opens or expose sensitive transport
  or credential data.
- Do not run local tests, Docker, preflight, or product compilation during the
  feature stage.

## Fast path

A green deterministic cache-health verdict ends analysis without specialist
dispatch.

## Repair evidence

Report activation reasons, the diagnosed defect, simulator/proof expectations,
the current committed feature head, remote latency and cache-health verdict,
and unresolved blockers.
