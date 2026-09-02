# Engineering Team Ownership

## Purpose

Nook assigns each change to one functional engineering team.

Ownership decides who changes code, Cortex, tests, and configuration. Gizmo
coordinates delivery but does not redefine a team's technical contract.

## Universal rules

- Every bounded Team Agent task has exactly one team identity.
- The functional owner defines behavior, contracts, tests, and acceptance.
- File location is evidence of ownership, not an exception to semantic
  ownership.
- A team stops at another team's boundary and reports the dependency to Gizmo.
- Gizmo assigns a separate task when another team's implementation is needed.
- Security review does not transfer implementation ownership.
- Team Agents edit the current shared checkout sequentially.
- Gizmo owns shared-branch sequencing and external delivery state.

## Teams

### Gizmo delivery control

Gizmo owns:

- mission scope and task routing;
- shared-branch write sequencing;
- shared-file coordination;
- pull requests and review coordination;
- validation, readiness, merge, and Workbench state; and
- the final delivery verdict.

Gizmo does not become the implementation owner when a Team Agent is
unavailable.

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

## Shared files

Shared files include root manifests, lockfiles, generated bindings, cross-team
registries, and root routing documents.

Gizmo assigns one writer for each shared-file change. The assigned Team Agent
edits the file in the current checkout. No separate integration workspace is
created.

## Assignment procedure

1. Describe the requested behavior.
2. Identify the functional owner.
3. Split only at real team or dependency boundaries.
4. Give each task one team identity and bounded file scope.
5. Sequence write-capable tasks on the shared branch.
6. Let each team implement and test its own scope.
7. Route cross-team dependencies back through Gizmo.
8. Validate the completed shared-branch result.

## Team responsibility

Within its assigned scope, a team owns:

- implementation;
- tests;
- team-owned Cortex updates;
- review fixes; and
- validation fixes caused by its change.

Gizmo owns external delivery actions after the technical result is ready.

## Validation

Verify:

- every changed behavior has one functional owner;
- every Team Agent task has one team identity;
- cross-team dependencies were routed to their owners;
- only one writer changed the checkout at a time;
- shared files had an explicitly assigned writer;
- accepted worker commits are already on the shared branch; and
- no worktree or parallel Team Agent lifecycle was introduced.
