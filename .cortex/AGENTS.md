# Nook Agent Routing Contract

## Required entry

Read [the circuit breaker](CIRCUIT-BREAKER.md) before every other Cortex document.
Then enforce the Meta-Cortex integration
[required bootstrap](meta-cortex-integration.md#required-bootstrap). Do not
plan, edit, validate, or launch agents until the bootstrap succeeds. After it
succeeds, read the [root knowledge graph](knowledge-graph.md).
Load the [upstream entry point](../.meta-cortex/AGENTS.md) with those project
constraints. Explicit user instructions determine task scope and stopping point.

Resolve the session's development mode through the upstream
[workflow](../.meta-cortex/AGENTS.md#development-mode) before planning, editing,
or launching agents. Nook's delivery contract supplies the project-specific
stages and constraints below.

## Canonical Cortex tree

Meta-Cortex owns generic agents and skills. Nook retains six functional contexts:
AI, Development Core, Security, SRE, Web Development, and Delivery Pipeline.
They describe product ownership, not six coordinator instances.
Each feature uses one functional team identity: the single Team Gizmo coordinates
bounded Team Agents and owns their integration order. See [agent feature
ownership](gizmo-prime/dynamic-skills/agent-feature-ownership.md) for the
ownership boundary.

- [Nook Gizmo Prime](gizmo-prime/AGENTS.md) wraps upstream Prime.
- [Nook Team Gizmo](gizmo-prime/team-gizmo/AGENTS.md) wraps the single upstream coordinator.
- [Nook agent catalog](gizmo-prime/team-gizmo/role-catalog.md) maps project scopes to roles.
- The active ignored `.meta-cortex/meta-cortex.toml` is the sole live launch
  configuration. Follow Meta-Cortex's
  [agent configuration rules](../.meta-cortex/teams/gizmo-team/docs/agent-configuration.md).
  Nook documents do not copy or override its settings.

## Nook assignment context

Follow the upstream [assignment context](../.meta-cortex/teams/AGENTS.md#assignment-context).
Select the owning Nook context from the root graph and include its product,
security, delivery, and validation requirements when they apply. Workers use
the assigned context directly.

## Context routes

- [AI](teams/ai/AGENTS.md): Cortex, Loom, executable skills, and agent tooling.
- [Development Core](teams/dev-core/AGENTS.md): portable Rust behavior and WASM contracts.
- [Security](teams/security/AGENTS.md): product trust boundaries and security review.
- [SRE](teams/sre/AGENTS.md): infrastructure, deployment, runners, and operations.
- [Web Development](teams/web-dev/AGENTS.md): browser presentation and interaction.
- [Delivery Pipeline](teams/delivery-pipeline/AGENTS.md): authorized GitHub mechanics.

## Nook language and tooling constraints

Use the responsible Meta-Cortex role, programming documents, and skills for
generic language rules. Nook adds these project constraints:

- [Rust lint rollout and existing values](teams/dev-core/design-docs/typed-newtypes.md).
- [Rust ownership lint rollout](teams/dev-core/design-docs/rust-action-ownership.md).
- [Nook test surfaces and coverage](shared/dynamic-skills/testing-pyramid-and-regression.md).
- [Nook source-size enforcement](shared/dynamic-skills/source-file-size.md): preserve the 1,000-line source limit, keep unit tests colocated while retaining integration tests, and use domain or architectural decomposition for oversized files.
- [Dependency audit integration](shared/dynamic-skills/prefer-popular-libraries.md).
- [Automation languages](shared/dynamic-skills/typescript-rust-automation-only.md) is a P1 hard rule: do not author, retain, or invoke Python; use Bun and TypeScript for scripts, Rust for compiled behavior, and Taskfiles for orchestration.
- [Nook UI and localization](teams/web-dev/dynamic-skills/ui-design-skills.md).
- [Nook unused-code tooling](teams/web-dev/dynamic-skills/web-unused-code.md).
- [Nook secret lifecycle](teams/security/dynamic-skills/secret-lifecycle.md).

Portable business rules, validation, cryptography, authorization, device identity,
and vault storage stay in Rust. Web code consumes the public typed WASM boundary.
Do not persist plaintext secrets or log sensitive data. Changed storage and wire
schemas require an explicit migration decision and behavior-focused Rust coverage.

## Team worker contract

Use upstream Prime and Team Gizmo roles with Nook's functional scopes and
acceptance requirements. Team-context Gizmo paths resolve to the feature's
single coordinator. Keep another active task read-only without an explicit
handoff. Add Nook-specific assignment details through the
[subagent-delegation workflow](gizmo-prime/workflows/subagent-delegation.md).

The upstream [integration agent](../.meta-cortex/teams/delivery-team/agents/integration-agent/AGENTS.md)
owns local Git mechanics. Nook adds its feature constraints and applicable
checks through the root and selected team authorities.

## Mandatory delivery architecture

Read the [delivery visual model](gizmo-prime/architecture/multiagent-delivery-diagrams.md)
and [feature-delivery contract](gizmo-prime/architecture/dev-delivery.md)
for an authorized delivery task. Prime owns the feature's outcome and authorization.
The upstream integration agent integrates bounded work. PR Lifecycle performs
authorized GitHub mechanics.
The user's explicit intermediate stopping point takes precedence over full delivery.

## GitHub execution boundary

Route live-agent GitHub PR operations, including read-only queries and wrapper
calls, through upstream PR agent behavior in Nook's PR Lifecycle adapter.
Route workflow dispatch, reruns, logs, and pipeline repairs through upstream
CI/CD with Nook's SRE context. Both require Prime's authorization and Team
Gizmo's assignment in multi-agent mode.
Repository-owned CI retains its existing execution contracts.
Use the [operation handshake](teams/delivery-pipeline/pr-lifecycle/workflows/authorization-handshake.md).
An explicit user-directed direct task follows the integration contract instead.

## Remote task execution

Follow the circuit breaker and [remote execution](teams/sre/workflows/remote-execution.md).
Forward requested selectors directly. Do not add selector catalogs or preflight
simulations. Actual terminal GitHub Actions results supply execution evidence.

## No fallback or speculative recovery

Agent-authored fallback behavior and speculative recovery machinery are
prohibited. This is a universal P1 rule.

### Required actions

- Implement the smallest direct path that satisfies the accepted scope.
- Keep every unsupported or failed state observable.
- Fail closed when the required path cannot complete.
- Treat recovery as a separate product capability.
- Require explicit user authorization before implementing that capability.
- Report a blocker when the required behavior cannot be implemented exactly.

### Prohibited actions

- Do not add an alternate execution path when the intended path is unavailable
  or fails.
- Do not add compatibility branches, legacy branches, shims, or aliases.
- Do not add recovery, replay, resume, reconciliation, or repair engines for
  failures that are not part of the accepted scope.
- Do not add journals, checkpoints, leases, tombstones, retry queues, or
  lifecycle state machines to support speculative recovery.
- Do not infer recovery authority from review suggestions, possible future
  failures, autonomy, or general reliability goals.
- Do not generalize one required failure case into reusable recovery
  infrastructure.
- Existing fallback behavior does not create an exception. Do not extend or
  duplicate it.
- Lower-level Cortex guidance cannot authorize fallback behavior. Report the
  policy conflict and stop.
- Do not silently degrade behavior or substitute a default result.
- Do not catch a failure and continue as if the operation succeeded.
- Do not approximate required behavior with fallback or recovery
  functionality.


## Cortex authoring

Load [upstream Context Engineering](../.meta-cortex/teams/ai-team/agents/tech-writer/skills/context-engineering/SKILL.md).
Use [self-improvement](teams/ai/dynamic-skills/self-improvement.md) for
evidence-backed promotion of durable Cortex guidance.
Nook's executable documentation tooling retains these project-specific cards:

- [Writer integration](teams/ai/dynamic-skills/cortex-writer.md).
- [Article audit integration](teams/ai/dynamic-skills/cortex-article-structure/SKILL.md).
- [Document-map audit integration](teams/ai/dynamic-skills/cortex-document-map/SKILL.md).
- [Consistency compilation](teams/ai/dynamic-skills/cortex-consistency/SKILL.md).

These cards own Nook tooling details only. Upstream owns generic authoring rules.

## Delivery and validation

Author behavior-focused Rust tests for changed domain logic and targeted web tests
for changed user flows. E2E does not replace domain tests. Nook executes tests,
preflight, builds, and full Loom verification only in the authorized hosted stage.
Local feedback is limited to scoped rustfmt and inexpensive TS diagnostics or
formatting unless the user explicitly authorizes another command. Never report an
unexecuted check as passing.

Complete authorized delivery requires all required PR checks, actual squash merge
into main, and remote feature-branch cleanup. A migration follows those stages
unless the user explicitly requests an earlier stopping point. Report unrun
checks honestly at any requested intermediate stop.

Codex scheduled tasks, heartbeats, and deferred repository automations remain
prohibited. Use the active task and the repository's existing CI contracts.

## Reporting

Follow Meta-Cortex's [communication and decisions](../.meta-cortex/teams/AGENTS.md#communication-and-decisions)
rules. Include Nook-specific evidence and blockers in the upward report.
