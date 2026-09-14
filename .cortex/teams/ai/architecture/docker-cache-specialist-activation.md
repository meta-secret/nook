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
- Require read-only consumers to perform zero writes and zero exports.
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
- Do not let the specialist execute GitHub, pull-request, publication,
  landing, or promotion mechanics.
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
