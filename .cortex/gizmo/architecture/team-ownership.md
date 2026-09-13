# Engineering Team Ownership

## Purpose

Nook assigns each change to one functional engineering team. Gizmo Prime is
the mission/root coordinator, and every team has a Team Gizmo that reports
upward to Prime for team-scoped delivery mechanics.

Ownership decides who changes code, Cortex, tests, and configuration. Gizmo
coordinates delivery but does not redefine a team's technical contract.

## Universal rules

- Follow [dev delivery](dev-delivery.md) for feature and manager stages.
- Each concurrent feature has a separate Gizmo and isolated Team Agent children.
- Every team has one Team Gizmo. Team Gizmo receives a high-level packet from
  Gizmo Prime, decomposes only its team's mechanics, dispatches internal Team
  Agents through the active harness, synthesizes exact-SHA evidence and
  blockers, and reports the high-level result to Prime.
- Team Gizmo is not a second Prime and never decides functional ownership,
  readiness, promotion, or final delivery.
- The manually run dev manager owns dev publication and main promotion.
- Every Team Agent task has exactly one team identity. Delivery Pipeline's
  internal PR Steward is an operational Team Agent for bounded pull-request
  observation and review mechanics.
- The functional owner defines behavior, contracts, tests, and acceptance.
- File location is evidence of ownership, not an exception to semantic
  ownership.
- A team stops at another team's boundary and reports the dependency to Gizmo.
- Gizmo assigns a separate task when another team's implementation is needed.
- Security review does not transfer implementation ownership.
- Team Agents may edit isolated child worktrees concurrently when their
  explicit file scopes are disjoint.
- Overlapping scopes and unresolved dependencies require ordered execution.
- Gizmo inventories dirty paths and hunks before dispatch.
- Every pre-existing change has an attributed owner and task.
- A scope overlap blocks dispatch unless the exact changes are handed off or
  attributed to the proposed task.
- Gizmo Prime owns mission-level child-worktree allocation, write-wave
  coordination, parent integration, feature acceptance, and local landing
  authorization. Team Gizmo coordinates issued internal child worktrees and
  commit handoffs within its packet.
- Internal PR Steward performs only explicitly authorized pull-request
  observation, review, and status mechanics; the manager-only `dev:pr-manager`
  command owns PR creation and updates.

## Teams

### Gizmo Prime and Team Gizmo delivery control

Gizmo Prime owns:

- mission scope and task routing;
- write-wave coordination and shared-branch commit turns;
- shared-file coordination;
- feature compilation and local landing authorization;
- technical review-finding disposition;
- feature acceptance verdicts;
- Workbench state; and
- the feature delivery verdict.

The dev manager controls dev PR creation/update through `dev:pr-manager`, plus
slow evidence, readiness, and promotion. Internal PR Steward observes the PR
and performs only these other mechanics under a manager packet issued through
Delivery Pipeline Team Gizmo.

Team Gizmo routes its team's authorized mechanics to internal Team Agents. The
Delivery Pipeline Team Gizmo coordinates the current internal PR Steward for
pull-request metadata, review and check observation, exact-head validation
retriggers, readiness evidence collection, bounded dev tasks, guarded
fast-forward publication, and remote PR-state verification. Internal PR
Steward is not a functional engineering team and does not own technical
findings.

Team Gizmo does not become the implementation owner when an internal Team
Agent is unavailable. Gizmo Prime does not become the implementation owner
when a Team Gizmo is unavailable.

### Delivery Pipeline

Delivery Pipeline is the operational team name. It is more precise than CI
because it covers CI, pull-request lifecycle, dev publication, workflow
execution, local landing, evidence, and guarded promotion.

Its current internal agents are:

- Delivery Pipeline Team Gizmo, which handles Level 1 delivery-pipeline
  orchestration, commit handoffs, and remote build-only task packets under
  Gizmo Prime's packet; and
- the internal PR Steward, which performs packetized external GitHub, PR,
  check, review, and status mechanics plus bounded dev tasks.

Delivery Pipeline executes authorized mechanics only. Team Gizmo and internal
PR Steward never create or update pull requests, invoke the manager-only
`dev:pr-manager`, replace the active harness, or decide readiness, promotion,
or final delivery. The Dev Manager remains policy owner for dev snapshots,
validation, readiness, promotion, and `dev:pr-manager`. Feature Gizmos remain
feature owners.

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
the file in an isolated child worktree. Gizmo verifies the child commit and
integrates it into the parent feature worktree.

## Assignment procedure

1. Describe the requested behavior.
2. Identify the functional owner and reporting Team Gizmo.
3. Split only at real team or dependency boundaries.
4. Give each task one team identity and bounded file scope.
5. Inventory dirty paths and hunks.
6. Attribute every dirty change to its owner and task.
7. Block an overlapping scope without an exact handoff or same-task
   attribution.
8. Name each acceptance command's read, write, and output scopes.
9. Group tasks only when file and command scopes are safe for concurrency.
10. Have Gizmo Prime issue the high-level packet to the owning Team Gizmo
    through the active harness.
11. Have that Team Gizmo create one issued child worktree for each internal
    task in the group from the packet's current commit.
12. Run each task in its child worktree through the active harness.
13. Verify each complete scoped commit and have the Team Gizmo return the
    handoff to Gizmo Prime for serialized parent integration.
14. Route cross-team dependencies back through Gizmo Prime.
15. Co-validate provider and consumer evidence on the combined branch.
16. Route integration failures to the responsible owners.

## Team responsibility

Within its assigned scope, a team owns:

- implementation;
- tests;
- team-owned Cortex updates;
- review fixes; and
- validation fixes caused by its change.

Team Gizmo coordinates internal Team Agents and reports evidence. Gizmo Prime
owns feature acceptance and the local landing request. The dev manager owns
dev PR policy, invokes `dev:pr-manager`, and owns promotion. Internal PR
Steward observes the PR and executes only review, check, status, and promotion
actions after the manager's authorization.

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
- only one writer mutated each worktree's Git index at a time;
- shared files had an explicitly assigned writer;
- accepted worker commits are integrated into the parent feature worktree;
- every child worktree was issued by Gizmo and stayed within its task scope;
- parent integration was serialized; and
- no external lifecycle system was introduced.
