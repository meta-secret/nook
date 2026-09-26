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

- Apply the [upstream Docker specialist](../../../../.meta-cortex/teams/sre-team/agents/docker-specialist/AGENTS.md)
  and its skill with Nook's cache-health requirements and validation boundary.
- Accept cache and remote-build performance packets from SRE Team Gizmo.
- Own Docker and BuildKit cache architecture within the assigned scope.
- Enforce a five-minute remote-build latency SLO and workflow timeout.
- Diagnose cache telemetry before changing cache topology.
- Let BuildKit determine Docker layer validity and reuse from the actual
  Dockerfile, build context, build arguments, and base image. Do not duplicate
  that decision with custom dependency fingerprints, cache selectors,
  allowlists, or mutation simulations.
- Preserve immutable exact-commit BuildKit identities for the current head and
  its first parent. The current ref accelerates same-head retries; the parent
  ref carries reusable layers to an ordinary successor head. Dependency and
  toolchain vertices stay rooted in that ordinary compile graph; do not
  synchronously export a second sibling graph.
- Use the unversioned semantic compile-cache repository name
  `nook-build-compile`. Do not manually rotate a schema suffix or derive a
  toolchain/dependency fingerprint; Dockerfile, context, build args, and base
  image remain BuildKit's invalidation inputs.
- Let BuildKit own cache validity, Dockerfile/context/build-argument input
  validation, and layer reuse. A narrow authenticated manifest/blob access
  check may fail fast on inaccessible registry resources, but must not select
  or filter cache refs, or predict hits/reuse. Do not precompute a parallel
  dependency fingerprint or simulate Docker's cache-key decisions.
- Make sccache the primary cross-commit compiler cache. Secret availability is
  the complete trust boundary: jobs receiving the single
  `NOOK_SCCACHE_ACCESS_KEY` / `NOOK_SCCACHE_SECRET_KEY` pair use `READ_WRITE`;
  jobs without those secrets use the safe direct-compiler fallback.
- Do not require a separate cache-population workflow or prerequisite before an
  ordinary compile. The first cold publish is allowed to miss and must populate
  compiler objects for the next committed head.
- Require authenticated registry reachability and access to each present
  current/parent cache manifest and every referenced blob before compilation.
  A missing exact current or parent manifest is an expected miss;
  registry/authentication errors, inaccessible referenced content, and export
  failure are terminal.
- Run remote `build:compile` as two sequential BuildKit/Bake invocations.
  Phase A builds a rooted dependency-foundation target from the current exact
  head and first-parent imports. That target includes Cargo fetch, native and
  WASM dependency compilation, and stable Node/web dependency roots where
  feasible. When publication is authorized, Phase A is the sole current-head
  `mode=max` registry exporter. Its completed export is portable before Phase
  B starts, so a Phase B failure leaves a retryable foundation cache on a fresh
  node.
- Phase B imports the current-head cache (the Phase A publication when export
  is authorized), then performs source-sensitive native/WASM, web,
  repository-tooling, and Loom compile/type-check work. Phase B has no
  `cache-to`; its failure cannot overwrite or invalidate Phase A's portable
  export. Both invocations remain inside the single five-minute build-only job.
- In a no-BuildKit-export invocation, Phase A still imports current and
  first-parent refs and Phase B imports only the current-head ref; neither
  phase exports registry cache. sccache access remains available when the
  trusted credential pair exists.
- Reject scratch, marker-only, or synthetic join targets that allow BuildKit to
  export a terminal result while orphaning intermediate cache records.
- Keep dependency layers reusable across source changes. Root Cargo fetch,
  native and WASM dependency compilation, and stable Node/web dependency stages
  in the Phase A dependency graph; keep Loom and source-sensitive work in Phase
  B.
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
- Treat remote `sccache` as an authoritative requirement for credentialed
  trusted CI Rust compiles, not an optional accelerator. Those jobs must fail
  when sccache is unavailable, opens its fallback circuit, or produces neither
  useful hits nor authoritative cold-publisher writes. Secret-free fork and
  Dependabot lanes retain their direct-compiler fallback because they are not
  trusted cache publishers or consumers.
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
- Use one rooted Phase A `mode=max` exact source-cache export so all intended
  source-free dependency vertices remain reachable. Phase B must not export
  registry cache, and neither phase may add a sibling cache exporter.
- Configure finite per-operation exporter and transport timeouts, but never
  describe an exporter `timeout` as a total export-duration bound. Acceptance
  is the Phase A export and completion of the whole GitHub job within five
  minutes.
- Preserve ordinary new-commit compiler reuse through sccache and stable
  source-free vertices in the rooted graph.
- Maintain the canonical simulator and proof surfaces:
  - `infra/tasks/bake-cache.yml`;
  - `infra/contracts/dockerized-rust.test.ts`;
  - `.github/workflows/remote.yml`.
- Author focused policy and regression tests for every cache defect.
- Keep cache proofs bounded to genuine import/export wiring, structured cache
  artifacts, registry integrity, and actual Dockerfile syntax or build
  behavior. Prove the Phase A/Phase B order, Phase A portability boundary, sole
  exporter, and no-export mode without simulating source mutations to predict
  BuildKit's own invalidation result.
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
- Finish the complete bounded iteration on the assigned worker branch.
- Report the worker branch, evidence, latency measurements, and blockers to
  SRE Team Gizmo.

## Validation boundary

- Hosted execution is the default. Hosted PR checks remain mandatory for
  delivery and readiness; local results are diagnostic and do not replace them.
- By default, feature-stage local validation is limited to static syntax,
  format, and diff inspection. Local diagnostics follow the root
  [delivery and validation policy](../../../AGENTS.md#delivery-and-validation).
- A specific repository preflight, coverage, or build target may be selected
  directly only when it is the smallest suitable diagnostic for the recorded
  task need. A selected Taskfile target may also execute its actually declared
  necessary prerequisites through that task. Unrelated or broader local targets
  and deployment remain prohibited.
- Direct Docker/BuildKit control, direct cache operations or mutation, and
  daemon/container destruction remain prohibited; use only repository targets
  permitted by the root policy.
- Upstream CI/CD with Nook SRE context owns remote `build:compile` execution.
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
- Do not omit native, WASM, Node, or web dependency roots from the Phase A
  dependency graph, or Loom compile/type-check from Phase B. Do not run a
  separate source-free population job.
- Do not use repository-root `COPY` in a compiler stage, leak one compiler
  domain into another, or apply a per-head argument before its latest semantic
  consumer.
- Do not create or preserve custom dependency fingerprints, cache selectors,
  allowlists, or source-mutation simulations that duplicate BuildKit layer
  invalidation. Treat such machinery as a P1 finding and stop under the Cortex
  circuit breaker.
- Do not hide cache transport or export failures behind successful status.
  Ordinary absent exact refs may fall through to the first-parent lineage; a
  first-ever commit may cold-build and seed its exact ref.
- Do not run tests, coverage, e2e, or preflight transitively from either
  `build:compile` phase. Loom work in this build-only route is compile/type
  checking, not `loom:verify`.
- Do not retry remote `sccache` after its circuit opens in a Docker `RUN`.
- Do not dispatch other specialists or act as Team Gizmo or Gizmo Prime.
- Do not execute GitHub, pull-request, publication, landing, or promotion
  mechanics.
- Do not decide readiness or final delivery.
