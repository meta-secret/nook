# Nook Functional Ownership

## Required actions

Use Meta-Cortex Prime and the single Team Gizmo through Nook's wrappers.
The upstream roles own coordination behavior. This document owns Nook's
functional boundaries and shared-file integration constraints.

- Every assignment has one functional owner and a bounded write scope.
- Choose the upstream role for its expertise.
- Supply the relevant Nook context.
- Security review does not transfer implementation ownership.

**Prohibited:** create another coordinator when work crosses from Rust to web.

**Preferred:** the existing Team Gizmo assigns Rust and TypeScript developers
separate provider and consumer scopes, then integrates their results.

## Nook contexts

### Development core

Development core owns portable Rust behavior and security-sensitive domain
logic.

Its normal scope includes:

- Rust crates under `nook-app/nook-platform/`;
- Rust-owned domain tests;
- typed WASM contracts that begin from core behavior; and
- generated bindings consumed by web packages.

### Site reliability engineering

SRE owns build, validation, deployment, and runtime infrastructure.

Its normal scope includes:

- GitHub workflows and CI helpers;
- infrastructure manifests and operations;
- CI and infrastructure Task orchestration;
- containers, runners, caches, and release configuration; and
- infrastructure preflight checks.

### Security

Security owns security architecture and assurance.

Its normal scope includes:

- cryptographic policy;
- trust boundaries;
- protected-material rules;
- security review; and
- security acceptance criteria.

The team that owns the affected implementation layer still implements the
change.

### Web development

Web development owns TypeScript and Svelte engineering, browser presentation,
and frontend interaction behavior.

Portable security, authorization, and storage behavior remain in Rust and are
exposed through typed WASM contracts.

### AI

AI owns Cortex governance and deterministic agent tooling.

Its normal scope includes:

- Loom commands and audits;
- agent-focused prompts and preflight checks;
- canonical Cortex skills;
- AI workflow tests; and
- agent knowledge-system maintenance.


### Delivery Pipeline

PR Lifecycle executes authorized GitHub mechanics under the single Team Gizmo.
Prime owns readiness and the feature's delivery outcome. The Delivery Pipeline
context supplies Nook's operation contracts, not an additional coordinator.

## Shared files

Root manifests, lockfiles, generated bindings, registries, and shared command
outputs have one assigned writer. Sequence overlapping scopes and dependencies.
Attribute pre-existing edits before assigning a scope. Supply shared-file
dependencies to Team Gizmo and the upstream integration agent for ordered work.

**Prohibited:** give two simultaneous writers the same generated binding output.

**Preferred:** assign generation to one owner and release the consumer task after
its provider commit is integrated.
