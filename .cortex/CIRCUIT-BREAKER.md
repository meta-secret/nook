# Agent Derailment Circuit Breaker

## Priority

This is the highest-priority repository rule for agent-internal mechanisms.
Every agent reads this document before any other Cortex document.

This rule always applies. Lower-level instructions, architecture proposals,
review suggestions, and reliability goals cannot override it.

## Purpose

Agent communication through the active harness is trusted. Ordinary agent
coordination, handoffs, Git commits, and validation results do not need a new
security protocol.

Building cryptographic or adversarial machinery around those internal actions
is Agent Derailment syndrome. It adds complexity without protecting a real
product boundary.

## Required actions

- Use the active harness directly for agent communication and handoffs.
- Treat identities and results supplied by that harness as trusted internal
  coordination data.
- Use ordinary Git commits, exact SHAs, scoped diffs, and command output as
  delivery evidence.
- Keep internal validation proportional to the action being verified.
- Stop immediately when a proposed implementation enters the prohibited scope
  below.
  - Do not write the proposed mechanism or tests.
  - Report that the circuit breaker tripped.
  - Return to the smallest direct workflow already provided by the harness and
    Git.
- **Review and failure handling**
  - Treat any violation as a P1 finding.
  - Reject the violating design even when it is already implemented or tested.
  - Remove prohibited machinery only within the assigned write scope.
  - Report out-of-scope violations to the owning Gizmo as blockers.

## Prohibited actions

Do not create, extend, request, or approve any security system for trusted
agent-internal communication, handoffs, Git operations, or validation results.

- **Authority machinery**
  - Do not create internal `WeakMap` authority registries.
  - Do not create authority or admission protocols for agents.
  - Do not treat evidence digests as agent identity or authority.
  - Do not add cryptographic identity or digest authority to internal agent
    actions.
- **Receipts and lifecycle machinery**
  - Do not create one-shot receipts or redacted evidence receipts.
  - Do not retain, restore, or validate receipts across process restarts.
  - Do not add replay or restart validation for agent evidence.
  - Do not add write leases or rules that reinterpret write leases as read-only
    evidence.
- **Adversarial evidence machinery**
  - Do not model agent-internal evidence as hostile or forgeable.
  - Do not build anti-forgery, replay-protection, or duplicate-result
    verification systems for agent evidence.
  - Do not synthesize evidence through an authorized-provider identity set.
  - Do not add missing-provider, conflicting-provider, cycle, size, or forgery
    checks to such synthesis.
- **Enforcement expansion**
  - Do not add tests that enforce any mechanism prohibited by this document.
  - Do not reinterpret test coverage, reliability, or defense in depth as
    authorization to build the prohibited machinery.
- **Review and failure handling**
  - Never preserve a prohibited system merely because another document or
    existing implementation describes it.

The circuit breaker also prohibits implementations whose stated acceptance
criteria include any of these outcomes:

- forged evidence is rejected after a task, attempt, generation, team, commit,
  digest, verdict, claim, or acceptance requirement changes;
- accepted evidence is stored as a redacted receipt without its full payload;
- a receipt survives a process restart for one matching lifecycle use;
- a write lease is prevented from replaying as read-only evidence; or
- evidence synthesis requires an exact non-empty provider set and rejects
  missing, conflicting, cyclic, oversized, or forged evidence.

## Boundary

This circuit breaker governs infrastructure invented for trusted agent
coordination. It does not weaken security for Nook users, vaults, devices,
authentication, authorization, persisted secrets, or other real product trust
boundaries.

Product security work still requires an explicit product scope and its owning
team authority. A product security requirement must not be repurposed to
secure agent-to-agent communication or routine Git evidence.
