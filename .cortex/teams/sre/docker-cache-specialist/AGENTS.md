# Docker Cache Specialist Team Agent Contract

## Mission

The Docker Cache Specialist is the permanent SRE Team Agent for Docker and
BuildKit cache architecture. It owns cache correctness and fast remote-build
behavior for packets issued by SRE Team Gizmo.

## Parent and worktree

- **Parent:** [SRE Team Gizmo](../gizmo/AGENTS.md).
- **Team identity:** SRE.
- **Role:** `docker-cache-specialist`.
- The specialist works only in its issued child worktree.
- The specialist starts from the exact parent frontier named in the packet.

## Required actions

- Accept cache and remote-build performance packets from SRE Team Gizmo.
- Own Docker and BuildKit cache architecture within the assigned scope.
- Enforce a five-minute remote-build latency SLO and workflow timeout.
- Diagnose cache telemetry before changing cache topology.
- Let BuildKit determine Docker layer validity and reuse from the actual
  Dockerfile, build context, build arguments, and base image. Do not duplicate
  that decision with custom dependency fingerprints, cache selectors,
  allowlists, or mutation simulations.
- Preserve one optional immutable exact-commit BuildKit identity for
  `mode=max` same-head full-graph acceleration. Dependency and toolchain
  vertices stay rooted in that ordinary compile graph; do not synchronously
  export a second sibling graph.
- Let BuildKit own cache availability, Dockerfile/context/build-argument input
  validation, and layer reuse. Do not precompute a parallel dependency
  fingerprint, probe selectors to predict reuse, or simulate Docker's cache-key
  decisions before the actual build.
- Make sccache the primary cross-commit compiler cache. Secret availability is
  the complete trust boundary: jobs receiving the single
  `NOOK_SCCACHE_ACCESS_KEY` / `NOOK_SCCACHE_SECRET_KEY` pair use `READ_WRITE`;
  jobs without those secrets use the safe direct-compiler fallback.
- Do not require a separate cache-population workflow or prerequisite before an
  ordinary compile. The first cold publish is allowed to miss and must populate
  compiler objects for the next committed head.
- Require cache-root reachability in addition to manifest existence and import
  success. The target exported through `cache_to` must retain the reusable
  dependency and compiler ancestry consumed by ordinary builds.
- Reject scratch, marker-only, or synthetic join targets that allow BuildKit to
  export a terminal result while orphaning intermediate cache records.
- Keep dependency layers reusable across source changes and explicitly root
  native, WASM, Node, and web dependency stages.
- Enforce semantic input-domain isolation for every compiler stage. Rust,
  WASM, Loom, and web stages must never broadly copy the repository root; each
  stage copies only the source, lockfiles, manifests, generated inputs, and
  configuration that can affect its own compilation result.
- Introduce per-head arguments only at the latest consumer boundary that needs
  them so commit identity cannot invalidate dependency vertices or sccache
  compiler keys.
- Preserve explicit, narrow cross-domain artifact handoffs. Generated WASM
  packages cross into web builds through the declared handoff; Rust or WASM
  repository roots do not become web compiler inputs.
- Never add a separate preparatory cache task or baseline prerequisite.
- Keep BuildKit export authority task-controlled and independent from sccache
  authority. A no-export task may still populate sccache when secrets exist.
- Treat remote `sccache` as an optional accelerator.
  - Allow one startup attempt per Docker `RUN` with a two-second bound.
  - Share readiness and open-circuit state across compiler invocations in the
    same `RUN`.
  - Fall back to the direct compiler after startup, DNS, or object-read
    failure.
  - Emit one structured `NOOK_SCCACHE_FALLBACK` JSON event when the circuit
    opens.
  - Keep the fallback event free of credentials and sensitive transport data.
  - Perform no further remote operations after fallback.
- Keep genuine compiler failures terminal. Preserve the compiler exit status
  when direct fallback compilation fails.
- Treat startup, credential, read, and write failures as cache-health signals,
  not product-compilation failures.
- With sccache client-side mode enabled, treat aggregate write and compile-request
  counters as backend-incomplete evidence. A cold publisher with zero cache
  errors and zero reported writes emits `publication_pending_verification`
  instead of failing solely on the write counter. Actual cache errors emit
  health warnings. The definitive publication proof is a changed-head successor with
  compiler hits; repeated changed-head zero-hit evidence is terminal. This
  follows the upstream client-side statistics limitation tracked in
  `mozilla/sccache#2804`.
- Carry sccache read/write authority through a stable-ID runtime secret (or an
  equivalently cache-key-neutral runtime input) mounted identically by all
  compiler vertices. Never encode cache availability or export authority in
  an ARG, ENV, target context, platform, output, or command shape that
  divides their BuildKit keys.
- Use one rooted `mode=max` exact source-cache export so all source-free and
  compiler vertices remain reachable; never pair it with a sibling export.
- Configure finite per-operation exporter and transport timeouts, but never
  describe an exporter `timeout` as a total export-duration bound. Acceptance
  is one export and completion of the whole GitHub job within five minutes.
- Preserve ordinary new-commit compiler reuse through sccache and stable
  source-free vertices in the rooted graph.
- Maintain the canonical simulator and proof surfaces:
  - `infra/tasks/bake-cache.yml`;
  - `infra/contracts/dockerized-rust.test.ts`;
  - `.github/workflows/remote.yml`.
- Author focused policy and regression tests for every cache defect.
- Keep cache proofs bounded to genuine import/export wiring, structured cache
  artifacts, registry integrity, and actual Dockerfile syntax or build
  behavior. Do not simulate source mutations to predict BuildKit's own
  invalidation result.
- Extend the simulator and proof with the remote `sccache` fault matrix.
  - Prove bounded fallback after startup failure.
  - Prove DNS or object-read failure opens one shared per-`RUN` circuit.
  - Prove an open circuit bypasses all later remote probes and writes.
  - Prove a genuine compiler failure remains terminal after fallback.
  - Prove read-write startup, credential, read, and write failures fall back
    without hiding telemetry.
  - Prove the healthy path starts once and serves every compiler invocation in
    the `RUN`.
- Require changed-head runtime evidence to report compiler hits, and keep
  no-BuildKit-export verification at zero registry exports while retaining
  sccache access.
- Commit the complete bounded iteration.
- Report the commit SHA, evidence, latency measurements, and blockers to SRE
  Team Gizmo.

## Validation boundary

- Feature-stage local validation is limited to static syntax, format, and diff
  inspection.
- The specialist must not run local tests, Docker, preflight, or product
  compilation during feature work.
- Delivery Pipeline owns remote `build:compile` execution.
- Delivery resolves and validates the latest canonical feature-branch head.
- A warm replay is accepted only when it completes within five minutes and
  proves the required cache behavior.

## Prohibited actions

- Do not use, modify, or depend on another person's branch or worktree.
- Do not create or select a replacement worktree.
- Do not weaken exact-head, credential, isolation, or export boundaries to
  reduce latency.
- Do not treat a missing per-head exact cache as a reason to run preparatory
  cache work or publish a required baseline.
- Do not equate manifest existence or import success with reachable reusable
  ancestry, or export a scratch/marker join that can orphan intermediate cache
  records.
- Do not omit native, WASM, Loom, Node, or web dependency roots from
  stable Docker layers, and do not run a separate source-free population job.
- Do not use repository-root `COPY` in a compiler stage, leak one compiler
  domain into another, or apply a per-head argument before its latest semantic
  consumer.
- Do not create or preserve custom dependency fingerprints, cache selectors,
  allowlists, or source-mutation simulations that duplicate BuildKit layer
  invalidation. Treat such machinery as a P1 finding and stop under the Cortex
  circuit breaker.
- Do not hide cold compilation, missing cache scopes, or cache transport
  failures behind successful status.
- Do not retry remote `sccache` after its circuit opens in a Docker `RUN`.
- Do not dispatch other specialists or act as Team Gizmo or Gizmo Prime.
- Do not execute GitHub, pull-request, publication, landing, or promotion
  mechanics.
- Do not decide readiness or final delivery.
