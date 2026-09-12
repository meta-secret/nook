# Engineering Team Ownership

## Purpose

Nook assigns each change to one functional engineering team.

Ownership decides who changes code, Cortex, tests, and configuration. Gizmo
coordinates delivery but does not redefine a team's technical contract.

## Universal rules

- Every Team Agent task has exactly one team identity. PR Steward is a separate
  operational Team Agent context for bounded pull-request mechanics.
- The functional owner defines behavior, contracts, tests, and acceptance.
- File location is evidence of ownership, not an exception to semantic
  ownership.
- A team stops at another team's boundary and reports the dependency to Gizmo.
- Gizmo assigns a separate task when another team's implementation is needed.
- Security review does not transfer implementation ownership.
- Team Agents may edit the current shared checkout concurrently when their
  explicit file scopes are disjoint.
- Overlapping scopes and unresolved dependencies require ordered execution.
- Gizmo inventories dirty paths and hunks before dispatch.
- Every pre-existing change has an attributed owner and task.
- A scope overlap blocks dispatch unless the exact changes are handed off or
  attributed to the proposed task.
- Gizmo owns write-wave coordination, serialized commit turns, external
  delivery policy, and authorization.
- PR Steward performs only the explicitly authorized pull-request mechanics.

## Teams

### Gizmo delivery control

Gizmo owns:

- mission scope and task routing;
- write-wave coordination and shared-branch commit turns;
- shared-file coordination;
- pull-request policy and authorization;
- technical review-finding disposition;
- readiness and merge verdicts;
- Workbench state; and
- the final delivery verdict.

The separate PR Steward Team Agent performs pull-request metadata.
It observes reviews and checks.
It retriggers exact-head validation.
It collects readiness evidence.
It performs authorized squash merges.
It verifies remote merge state.
It is not a functional engineering team.
It does not own technical findings.

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
registries, root routing documents, and shared command outputs.

Gizmo assigns one writer for each shared-file change. Any task that needs the
same shared file is ordered after that writer. The assigned Team Agent edits
the file in the current checkout. No separate integration workspace is
created.

## Assignment procedure

1. Describe the requested behavior.
2. Identify the functional owner.
3. Split only at real team or dependency boundaries.
4. Give each task one team identity and bounded file scope.
5. Inventory dirty paths and hunks.
6. Attribute every dirty change to its owner and task.
7. Block an overlapping scope without an exact handoff or same-task
   attribution.
8. Name each acceptance command's read, write, and output scopes.
9. Group tasks only when file and command scopes are safe for concurrency.
10. Run each group as a parallel write wave in the current checkout.
11. Grant one commit turn at a time for each complete scoped iteration.
12. Route cross-team dependencies back through Gizmo.
13. Co-validate provider and consumer evidence on the combined branch.
14. Route integration failures to the responsible owners.

## Team responsibility

Within its assigned scope, a team owns:

- implementation;
- tests;
- team-owned Cortex updates;
- review fixes; and
- validation fixes caused by its change.

Gizmo owns external delivery policy after the technical result is ready. PR
Steward performs the named external pull-request actions after Gizmo's
authorization.

## Validation

Verify:

- every changed behavior has one functional owner;
- every Team Agent task has one team identity;
- cross-team dependencies were routed to their owners;
- concurrent writers had disjoint explicit file scopes;
- overlapping or dependent writers ran in order;
- dirty paths and hunks were attributed before dispatch;
- no writer committed unrelated pre-existing changes;
- acceptance command scopes were safe for concurrency or ran serially on a
  stable committed head;
- only one writer mutated the Git index or committed at a time;
- shared files had an explicitly assigned writer;
- accepted worker commits are already on the shared branch; and
- no worktree or external lifecycle system was introduced.
