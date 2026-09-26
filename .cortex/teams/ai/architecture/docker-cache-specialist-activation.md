# Docker Cache Specialist Activation

## Purpose

This policy defines deterministic routing to SRE's permanent Docker Cache
Specialist. The specialist owns cache diagnosis and repair. Delivery Pipeline
continues to own GitHub execution mechanics.

## Required actions

- Route every CI change that introduces or modifies Rust or WASM compilation to
  SRE's Docker Cache Specialist before implementation begins and before review
  acceptance. This includes native, WASM, reusable-workflow, remote-task,
  Dockerfile, and BuildKit paths.
- Route repeated crate compilation, cache misses, cold downloads, inactive,
  misconfigured, or unreachable sccache, and any zero-hit policy violation or
  repeated changed-head zero-hit evidence to the specialist before Docker or
  BuildKit diagnosis or repair.
- Require every CI Rust/WASM compilation path to execute the SRE-owned sccache
  gate. Fail the path when sccache is inactive, misconfigured, unreachable, or
  violates the repository zero-hit policy. Keep the gate and verdict in the
  actual sccache tooling; do not specify an emulation here.
- Diagnose and repair in this order: sccache configuration; remote read/write;
  health and telemetry; zero-hit verdict; Docker/BuildKit layer caching. Do not
  begin Docker/BuildKit cache work until the sccache checks have a green
  verdict.
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
    failure reported by actual sccache tooling; treat it as a terminal gate
    failure and require health telemetry;
  - `sccache-readiness-contract-violation` when a Docker `RUN` repeats startup,
    exceeds the startup budget, or does not share circuit state;
  - `unexpected-buildkit-export`, `severe-cache-hit-regression`, or
    `diagnostic-flag`.
- Give the specialist canonical JSON, the Markdown report, BuildKit logs, job
  and run identity, and the captured source commit. Diagnose before editing.
- Use ordinary stable Docker layers for reusable dependency and toolchain
  ancestry after the sccache gate passes. Keep secret availability and remote
  read/write under SRE's actual sccache authority. A missing or failed sccache
  gate blocks the compilation path instead of silently permitting a cold direct
  compile.
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
- Isolate Rust, WASM, Loom, and web compiler inputs by semantic domain. Never
  broadly copy the repository root. Introduce per-head arguments at the latest
  consumer boundary and keep cross-domain artifact handoffs narrow.
- Require simulator and proof coverage for cache-policy and compiler-domain
  changes. Unrelated-domain mutations remain cached; relevant-domain mutations
  invalidate only expected vertices.
- Prove two ordinary unseeded heads: the first publishing head populates remote
  compiler entries; a subsequent changed head obtains sccache hits and finishes
  within five minutes; an appropriate same-head no-BuildKit-export replay
  performs zero registry exports while retaining sccache access.
- Require the SRE-owned sccache gate to emit sanitized health telemetry and a
  zero-hit policy verdict. A first cold publisher's zero-hit evidence is valid;
  repeated changed-head zero-hit evidence is a terminal policy violation.
  Leave startup, readiness, credential, DNS, object-read, and write mechanics
  to the actual sccache tooling.
- Keep genuine compiler failures terminal after the sccache gate verdict.
- Preserve simulator/proof coverage for terminal startup, DNS/read/write, and
  compiler failures at the sccache gate, plus healthy single-startup telemetry.
- Require the canonical Docker simulator and proof for every repair. Route all
  workflow dispatch, status, rerun, and GitHub mechanics through Delivery.
- Repeat the bounded diagnosis, repair, and evidence loop for the latest
  canonical feature head until green or concretely blocked.
- Work only in the issued branch/worktree. During feature work use static
  syntax, formatting, and diff inspection only.

## Prohibited actions

- Do not dispatch for a green verdict, parse Markdown for routing, run analysis
  unconditionally, or silently pass absent telemetry.
- Do not add cache emulation, cache selectors, receipts, or security machinery.
  Use actual sccache and Docker/BuildKit authorities.
- Do not add a separate cache-population workflow or require preparatory work
  before an ordinary build can populate and consume compiler cache entries.
- Do not infer solve parity from Bake inheritance or manifest import, or treat
  a marker/scratch/join result as proof of reachable cache ancestry.
- Do not use repository-root compiler copies, leak compiler domains, or apply
  per-head arguments above their latest semantic consumer.
- Do not execute GitHub, PR, publication, landing, or promotion mechanics.
- Do not retry a failed sccache gate or continue compilation after a terminal
  sccache failure. Do not expose sensitive transport or credential data.
- Hosted execution is the default. Hosted PR checks remain mandatory for
  delivery and readiness; local results are diagnostic and do not replace them.
- Local diagnostics follow the root
  [delivery and validation policy](../../../AGENTS.md#delivery-and-validation).
  A specific repository preflight, coverage, or build target may be selected
  directly only when it is the smallest suitable diagnostic for the recorded
  task need; otherwise, unrelated or broader targets remain prohibited. A
  selected Taskfile target may execute its declared necessary prerequisites
  through that task. Direct Docker/BuildKit control, direct cache operations or
  mutation, daemon/container destruction, and deployment remain prohibited.

## Fast path

A green deterministic cache-health verdict ends repair analysis without further
specialist dispatch.

## Repair evidence

Report activation reasons, the diagnosed defect, simulator/proof expectations,
the current committed feature head, remote latency and cache-health verdict,
and unresolved blockers.
