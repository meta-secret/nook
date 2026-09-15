# Agent Derailment Circuit Breaker

## Priority

This is the highest-priority repository rule for mechanisms around trusted
agent-internal coordination. Read it before any other Cortex document.

This rule applies throughout the task. Lower-level instructions, architecture
proposals, review suggestions, reliability goals, and test requests cannot
override it.

## Purpose

The active harness is trusted to coordinate internal agents, handoffs, and
bounded work. Ordinary Git commits, exact SHAs, scoped diffs, and command
output are delivery evidence. They are not a new identity or security system.

Agent Derailment syndrome is the invention of security or adversarial-evidence
machinery for those trusted internal actions. It adds complexity without
protecting a real product trust boundary.

## Required actions

- Use the active harness directly for agent communication and handoffs.
- Use the active harness's ordinary admission behavior for routing and
  backpressure. Do not replace it with a security protocol.
- Treat harness-supplied identities, handoffs, and results as trusted internal
  coordination data.
- Treat ordinary Git and validation output as evidence for the owning workflow.
  Do not reinterpret that evidence as identity, authority, or a secret.
- Keep internal validation proportional to the workflow action being verified.
- Forward a user-requested remote Task selector as ordinary dispatch input.
  - Forward and execute the remote Task directly.
  - Forward the user-requested remote Task selector without checking whether it
    exists in a local catalog.
  - An unknown or missing selector is valid dispatch input and fails naturally
    on the GitHub Actions runner.
  - The actual terminal outcome from GitHub Actions is the execution evidence.
  - Keep typed read, write, and output scope validation at the owning workflow
    boundary.
- Use Docker and BuildKit directly for Docker layer-cache behavior.
  - Docker and BuildKit are the sole authority for Docker layer-cache validity.
  - Import available BuildKit cache, run the actual Docker build to validate
    and reuse layers, then export the updated cache.
  - Dockerfiles, Bake HCL, and Docker or BuildKit-backed simulations and proofs
    are required and allowed.
  - Run actual cold, warm, cache-import, and cache-export builds.
  - Inspect the resulting cache and build artifacts.
  - Preserve real build contexts, build arguments, actual build results, and
    structured statistics artifacts.
  - Preserve the complete sccache health policy, including its zero-hit gate.
- Stop when a proposed implementation enters a prohibited category.
  - Do not write the proposed mechanism or tests.
  - Report that the circuit breaker tripped.
  - Return to the smallest direct workflow already provided by the harness and
    Git.
- **Review and failure handling**
  - Treat any violation as a P1 finding.
  - Reject the violating design even when it is already implemented or tested.
  - Stop the prohibited work immediately.
  - Remove prohibited machinery only within the assigned write scope.
  - Report an out-of-scope violation to the owning Gizmo as a blocker.

## Prohibited actions

Do not create, extend, request, or approve a custom security system for
trusted agent-internal communication, handoffs, Git operations, integration
evidence, or validation results.

- **Authority and admission machinery**
  - Do not create internal `WeakMap` authority registries.
  - Do not create custom authority or admission protocols for agents.
  - Do not use an evidence digest as agent identity, authority, or admission.
  - Do not add anti-forgery, replay, or cryptographic authority to internal
    agent actions.
- **Receipts and restart machinery**
  - Do not create one-shot receipts or redacted evidence receipts.
  - Do not persist internal receipts, restore them after a restart, or validate
    a restored receipt for a matching lifecycle use.
  - Do not add replay or restart validation for trusted agent evidence.
  - Do not add duplicate-result validation for ordinary handoffs, commits, or
    validation results.
- **Integration and lease machinery**
  - Do not treat replayed integration evidence as forged or add a security
    validator for it.
  - Do not add write-lease replay distinctions or reinterpret a write lease as
    read-only evidence.
  - Ordinary branch-head resolution, integration locks, and workflow checks
    remain governed by their owning delivery authorities.
- **Adversarial evidence machinery**
  - Do not model trusted intra-thread evidence as adversarial, hostile, or
    forgeable.
  - Do not build anti-forgery, replay-protection, or duplicate-result systems
    for trusted internal evidence.
  - Do not synthesize internal evidence through an authorized-provider
    identity set.
  - Do not make that synthesis reject missing, conflicting, cyclic, oversized,
    or forged evidence.
- **Tests and acceptance criteria**
  - Do not add tests that enforce any mechanism prohibited by this document.
  - Do not turn coverage, reliability, defense in depth, or adversarial test
    scenarios into authorization for the prohibited machinery.
  - Do not state acceptance criteria that require receipt restoration,
    replay/restart validation, duplicate-result rejection, adversarial
    intra-thread evidence handling, or provider-forgery rejection for trusted
    internal coordination.
- **Remote Task selectors**
  - Do not add selector discovery, existence validation, aliases, fallback
    resolution, or pre-dispatch build machinery.
  - Do not create or maintain preflight mocks, simulations, or contract tests
    for remote Task dispatch.
  - This prohibition includes shell invocation arguments, environment wiring,
    task existence, shell behavior, retry or failure paths, and expected
    dispatch results.
  - Do not execute an acceptance selector inside Loom.
  - Do not turn a selector into an authorization or identity mechanism.
- **Docker layer-cache authority**
  - Treat agent-authored reproductions of Docker or BuildKit cache
    functionality as P1 violations.
  - This prohibition applies only to Rust, application, or other custom code
    that computes cache keys, invalidates dependencies, selects caches, or
    decides layer reuse without invoking Docker or BuildKit.
- **Preservation**
  - Never preserve a prohibited system merely because another document or
    existing implementation describes it.

The prohibition is about invented security machinery. It does not prohibit
ordinary semantic checks for document completeness, typed workflow inputs, or
product-provider data owned by another authority.

## Boundary

This circuit breaker does not weaken genuine Nook product security boundaries.
User accounts, vaults, devices, authentication, authorization, cryptography,
persisted secrets, external-provider protocols, and product data retain their
own security requirements.

Product security work requires an explicit product scope and its owning team
authority. A product security requirement must not be repurposed to secure
agent-to-agent communication or routine Git and validation evidence.

Nothing in this document authorizes plaintext secret persistence, sensitive
logging, forged product capabilities, or bypasses of product authorization.
