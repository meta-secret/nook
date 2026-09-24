# Nook AI Context

This is a Nook functional context supplied alongside Meta-Cortex roles and
skills. Meta-Cortex owns generic agent, programming, and authoring policy. This
contract adds Nook AI ownership and deterministic tooling constraints.

## Highest-priority circuit breaker

Read the root [Agent Derailment Circuit Breaker](../../CIRCUIT-BREAKER.md)
before this contract or other AI authorities. It governs trusted internal
handoffs. Product security requirements remain in the owning Nook security and
product authorities.

## Mission and ownership

The AI team owns Nook's agent knowledge system and deterministic agent tooling.
Its project-owned responsibilities include:

- Cortex structure, navigation, catalogs, and evidence-backed maintenance.
- Product-specification lifecycle and the Nook promotion of durable decisions.
- Loom commands, typed workflows, runtime implementation, and deterministic
  Cortex tooling under `agentic-ai/loom/`.
- Nook skill cards, their catalogs, and their deterministic tooling.
- AI-owned module expertise, structural analysis, and evidence synthesis.

Use the Nook AI [knowledge graph](knowledge-graph.md) to locate the owning
project documents. Follow the root route and upstream [assignment context](../../../.meta-cortex/teams/AGENTS.md#assignment-context)
for generic context selection and handoff requirements.

## Nook implementation routing

Use the upstream role and skills selected in the assignment. The Nook adapters
supply product context; they do not replace generic language policy.

- Assign Loom implementation to the upstream
  [TypeScript developer](../../../.meta-cortex/teams/dev-team/agents/typescript-dev/AGENTS.md)
  with Nook AI requirements.
- Assign Cortex documents and skill organization to the upstream
  [Tech Writer](../../../.meta-cortex/teams/ai-team/agents/tech-writer/AGENTS.md)
  with the subject owner's requirements.
- Load a foreign team's linked skill read-only when an AI task requires its
  expertise. A foreign-team implementation requires an explicit ownership
  assignment.

Language expertise does not transfer product-policy ownership. Portable
business rules, cryptography, authorization, device identity, and vault storage
remain with their Nook product and security owners. Browser behavior remains
with Web Development. Infrastructure and deployment remain with SRE. Delivery
state and external GitHub operations remain with Gizmo and the authorized
upstream delivery roles.

## Nook AI boundaries

The AI team may maintain its assigned Cortex documents, Loom implementation,
AI-owned tests, and Nook tooling contracts. It does not own:

- Feature delivery planning, shared Git state, pull requests, review threads,
  merge state, or final delivery verdicts.
- Portable product implementation or security architecture.
- Browser presentation, SRE operations, or another team's Cortex without an
  explicit expertise contract.
- Independent changes to external delivery state.

Raise a product, security, web, SRE, shared, or delivery dependency to Team
Gizmo for routing.

## Validation

Follow the root Nook [validation boundary](../../AGENTS.md#delivery-and-validation).
Author behavior-focused tests for changed AI runtime behavior, but execute them
only in the feature pull request's required-check stage. End-to-end coverage
does not replace domain tests.

For AI work that authors TypeScript, JavaScript, or Svelte, the acceptance
packet names these Nook enforcement surfaces:

- `task loom:verify` checks Loom and every executable-skill package.
- `task preflight:typescript-state` checks authored `null`, `undefined`,
  TypeScript state-modeling rules.
- `task preflight:source-architecture` checks source-language and source-size
  boundaries.
- Semantic ownership review follows upstream
  [function ownership](../../../.meta-cortex/teams/dev-team/docs/programming/function-ownership.md).

Run these checks only in the feature pull request's required-check stage.
The acceptance record must not claim that `task loom:verify` alone proves
TypeScript-state, source-architecture, or semantic ownership compliance.
Describe each evidence source separately in the acceptance record.

Loom compiles only its typed contracts and registered workflow bindings.
Markdown remains documentation and does not become executable workflow state.
Prove semantic policy with review and deterministic invariants with their
owning Loom or preflight checks.
