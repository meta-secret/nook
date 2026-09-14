# Docker Cache Specialist Activation

## Purpose

This policy defines deterministic routing to SRE's permanent Docker Cache
Specialist. The specialist owns cache diagnosis and repair. Delivery Pipeline
continues to own GitHub execution mechanics.

## Required actions

- Cover every Docker or BuildKit-bearing job in `.github/workflows/pr.yml`.
- Produce canonical JSON and human-readable Markdown from the same telemetry
  model.
- Save both outputs as workflow evidence.
- Use the JSON verdict and reason codes for deterministic routing.
- Use Markdown only as human-readable diagnostic context.
- Activate the specialist when JSON reports one or more of these conditions:
  - `job-timeout` means a GitHub job timed out.
  - `job-cancelled` means a GitHub job was cancelled.
  - `cache-health-gate-failed` means the deterministic gate failed.
  - `telemetry-missing-or-incomplete` means required BuildKit telemetry is not
    usable.
  - `required-import-miss` means a required cache import missed.
  - `generation-baseline-missing` means the immutable compiler baseline for
    the current recipe/dependency-fingerprint generation does not exist.
  - `generation-baseline-invalid` means the current generation manifest or
    baseline cannot be trusted or consumed.
  - `effective-solve-input-mismatch` means the generation seed and ordinary
    consumer resolved different effective Bake inputs even though the
    generation manifest imported successfully.
  - `unrelated-input-cache-invalidation` means a compiler stage invalidated
    because its build context, broad repository copy, or prematurely applied
    per-head input included a change outside that stage's semantic input
    domain.
  - `sccache-read-only-startup-fallback` means optional read-only remote
    `sccache` did not become ready within its two-second startup budget.
  - `sccache-read-only-transport-fallback` means optional read-only remote
    `sccache` encountered a DNS or object-read transport failure.
  - `sccache-read-only-circuit-open` means the shared state for one Docker
    `RUN` already disabled optional remote reads after an earlier failure.
  - `sccache-compiler-failure` means the compiler itself failed. This failure
    remains terminal in every cache mode.
  - `sccache-read-write-transport-failure` means publication-mode startup,
    credentials, reads, or writes failed. This failure remains terminal.
  - `sccache-readiness-contract-violation` means one Docker `RUN` started or
    probed remote `sccache` more than once, exceeded the startup budget, or
    failed to share its readiness and circuit state.
  - `recipe-or-dependency-generation-changed` means a legitimate recipe or
    dependency-fingerprint change rotated the required baseline generation.
  - `unexpected-read-only-write-or-export` means a read-only consumer wrote
    cache data or exported a cache.
  - `severe-cache-hit-regression` means the hit rate crossed the configured
    severe-regression threshold.
  - `diagnostic-flag` means the shared telemetry model emitted a diagnostic
    flag that also appears in the Markdown statistics.
- Give the specialist the canonical JSON, Markdown report, BuildKit logs, job
  identity, run identity, and captured source commit.
- Require diagnosis before implementation changes.
- Diagnose whether a timeout or cache failure is caused by a missing or invalid
  generation baseline, a legitimate recipe/dependency generation change, or
  another cache defect. A missing optional exact-SHA cache is not by itself a
  maintenance-seed condition.
- Permit maintenance to seed exactly one immutable `mode=max` compiler
  baseline for each recipe/dependency-fingerprint generation. Prohibit
  per-head maintenance source seeding.
- Require ordinary unseeded commits to import the generation baseline plus the
  dependency cache. Treat an exact-SHA `mode=min` cache only as optional
  same-head retry acceleration.
- Treat Bake inheritance as declaration reuse, not late-bound CLI override
  propagation. A CLI override such as `--set target.args.*` changes that target
  only; a target that inherited from it earlier does not retroactively receive
  the override.
- Explicitly mirror every invocation-shaping argument, context, platform, and
  output between the generation seed and ordinary consumer. Include those
  effective solve inputs in the recipe fingerprint so a semantic solve change
  rotates the generation instead of silently reusing an incompatible manifest.
- Require the Docker cache simulator and proof to compare the effective seed
  and consumer solves. A successfully imported generation manifest proves
  availability, not cache-key compatibility: differing effective inputs can
  still produce zero matching cache keys.
- Isolate compiler-stage inputs by semantic domain. Rust, WASM, Hive, and web
  stages must each copy only the source, lockfiles, manifests, generated
  inputs, and configuration that can affect that domain; a compiler stage must
  never broadly copy the repository root.
- Introduce per-head arguments at the latest consumer boundary that actually
  needs them. Do not attach commit identity or another source-varying value to
  dependency or generation-baseline vertices.
- Keep cross-domain artifact handoffs explicit and narrow. In particular,
  transfer generated WASM packages through the declared handoff rather than
  making a web stage consume the Rust or WASM repository domain.
- Require simulator and proof coverage for policy-only cache changes and for
  each Rust, WASM, Hive, or web input-domain change. Each case must mutate an
  unrelated compiler domain and prove the subject domain remains cached, in
  addition to proving that a relevant-domain change invalidates the expected
  vertices.
- Require read-only consumers to perform zero writes and zero exports.
- Treat remote `sccache` in `READ_ONLY` mode as an optional accelerator.
  - Bound startup to two seconds and one attempt for each Docker `RUN`.
  - Share readiness and open-circuit state across every compiler invocation in
    that `RUN`.
  - On startup, DNS, or object-read failure, open the circuit and invoke the
    compiler directly for the current and remaining invocations.
  - Emit one structured `NOOK_SCCACHE_FALLBACK` JSON event for the transition.
  - Include the activation reason code, cache mode, failure class, and fallback
    compiler path without credentials or sensitive transport data.
  - Keep read-only mode free of remote writes even before fallback.
- Keep genuine compiler failures terminal after direct fallback. A cache
  failure must not mask or reinterpret the compiler exit status.
- Treat remote `sccache` in `READ_WRITE` mode as publication infrastructure.
  Startup, credential, read, and write failures remain terminal and must not
  degrade to direct compilation.
- Require the simulator and Docker proof to exercise the complete remote
  `sccache` fault matrix.
  - **Startup failure:** one bounded startup attempt, one fallback event, and
    direct compiler success in `READ_ONLY` mode.
  - **DNS or read failure:** the first transport failure opens the shared
    circuit and later invocations compile directly without another probe.
  - **Open circuit:** all remaining invocations bypass remote `sccache` and
    perform zero remote writes.
  - **Genuine compiler failure:** direct compilation fails terminally with the
    compiler's status.
  - **Read-write failure:** startup, credential, read, or write failure is
    terminal and emits no successful fallback verdict.
  - **Healthy single start:** one successful startup serves every compiler
    invocation in the `RUN` without repeated readiness probes.
- Require the canonical Docker cache simulator and proof for every repair.
- Route workflow dispatch, status inspection, reruns, and other GitHub
  mechanics through Delivery Pipeline.
- Repeat the bounded diagnosis, repair, and evidence loop for the latest
  canonical feature-branch head until the cache gate is green or a concrete
  blocker is reported.
- Keep each repair in the specialist's issued worktree and branch.
- During feature work, use only static syntax, formatting, and diff inspection.

## Prohibited actions

- Do not dispatch the specialist for a green cache verdict.
- Do not parse Markdown to make an activation decision.
- Do not run specialist analysis as an unconditional job on every workflow.
- Do not let an absent telemetry artifact silently pass the cache gate.
- Do not blindly seed each branch head or commit after a timeout, required
  import miss, or missing exact-SHA cache.
- Do not infer seed/consumer parity from Bake target inheritance or from a
  successful manifest import.
- Do not use a repository-root `COPY` as a compiler-stage input or let an
  unrelated Rust, WASM, Hive, or web change invalidate another compiler
  domain.
- Do not place per-head arguments above their latest semantic consumer
  boundary or replace an explicit artifact handoff with a broad source copy.
- Do not let the specialist execute GitHub, pull-request, publication,
  landing, or promotion mechanics.
- Do not retry remote `sccache` after the per-`RUN` read-only circuit opens.
- Do not emit credentials, endpoints containing secrets, or raw sensitive
  transport payloads in `NOOK_SCCACHE_FALLBACK`.
- Do not apply read-only fallback behavior to `READ_WRITE` publication mode.
- Do not run local tests, Docker, preflight, or product compilation during the
  feature stage.

## Fast path

The deterministic cache-health job is the normal fast path. A green verdict
ends cache analysis without specialist dispatch. This keeps ordinary builds
bounded while preserving machine-enforced cache correctness.

## Repair evidence

A completed repair reports:

- the reason codes that caused activation;
- the diagnosed cache defect;
- simulator and proof expectations;
- the current committed feature head;
- the remote latency and cache-health verdict; and
- any unresolved blocker.
