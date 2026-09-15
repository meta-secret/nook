# AI Team Agent Contract

## Highest-priority circuit breaker

Read and follow the root [Agent Derailment Circuit
Breaker](../../CIRCUIT-BREAKER.md) before this contract or any other AI
authority. It is the highest-priority rule for every AI-team task.

Do not design, implement, test, or approve custom security machinery for
trusted agent-internal communication, evidence, handoffs, integration, or Git
actions. Stop that work immediately and report a circuit-breaker violation.

## Mission

The AI team owns Nook's agent knowledge system and deterministic agent
tooling.

Gizmo owns shared-branch sequencing and external delivery state. The active
harness provides Team Agent communication.

## Context loading

1. Confirm that the root [Agent Derailment Circuit
   Breaker](../../CIRCUIT-BREAKER.md) has been read.
2. Read [the AI knowledge graph](knowledge-graph.md).
3. Select one category that owns the assigned AI functionality.
4. Open only the exact workflow, skill, architecture, or reference required.
5. Follow direct links one hop only when the task requires them.
6. Do not load the Gizmo graph or another team's graph.

### Universal boundary

The root [team worker contract](../../AGENTS.md#team-worker-contract) supplies
universal requirements. This entry point adds only AI ownership and context
selection.

### Trusted in-thread handoffs

Team Gizmos and Team Agents that operate inside the same active Codex
thread/harness form a highly trusted orchestration domain. Their handoff is
ordinary typed coordination data:

- the task and dependency state;
- the bounded file scope and issued worktree;
- the committed result, status, and ordinary evidence observation; and
- the upward report to the parent.

The AI team MUST NOT model those peers as attackers. A contract or review that
adds any of the following solely to protect one trusted Team Gizmo or Team
Agent from another fails review as a P1 defect:

- encryption or signatures for an internal task or result handoff;
- anti-forgery checks, key registries, or authority registries;
- replay defenses framed as hostile-agent protection;
- cryptographic agent identity, result identity, or digest authority;
- one-use capability issuance or consumption theatrics; or
- redundant or double verification of the same internal task or result.

Keep the simple typed handoff. Preserve dependency ordering, wave admission,
write-scope exclusions, and minimal current-head or clean-worktree checks.

This trust rule does not weaken validation at a real boundary. Strong checks
remain mandatory for GitHub, network, and provider responses; credentials and
secrets; user data; third-party artifacts; independently supplied build or
promotion evidence; and data crossing process or system boundaries. Product
cryptography, Git delivery integrity, and external evidence policy remain with
their owning authorities. Git baseline, path, symlink, gitlink, and worktree
checks remain required for handoff tooling. Loom's `lib/base-evidence` checks
and independent build or promotion evidence remain required at their actual
boundaries.

### Harness admission

AI dispatch follows active-harness admission. Immediately attempt every
dependency-ready specialist with a disjoint scope and use the actual admission
result concurrently. Queue temporary refusals for retry when capacity releases. A host or
session allocation is current availability, not an architecture or product
limit. Do not pre-check or budget a wave against a numeric limit. Cortex and
Loom never encode, infer, or repeat a fixed numeric agent or subagent
concurrency cap.

### Bootstrap evidence

AI Team Gizmo and its leaves consume the canonical feature branch name and the
bootstrap evidence issued by Gizmo Prime. Prime's fresh-base bootstrap runs
before planning, delegation, worktree creation, or edits. It records
`originMainSha` for the exact freshly fetched `origin/main` and
`pinnedLocalDevSha` after canonical local `main` and `dev` are synchronized;
`originMainSha` must be an ancestor of `pinnedLocalDevSha`. Prime creates the
feature branch and worktree from that current committed local-dev feature base
and preserves it. The branch name is the workflow authority. Before each
stage, delivery resolves the latest committed branch head. A branch advance
follows the latest head and reruns affected evidence. SHAs observed during the
run are evidence, not cross-stage authority. The AI team fails closed on
missing or unprovable bootstrap/branch evidence and never resolves or guesses
a base independently.

### Foreign expertise

An exact AI authority may require a foreign-team engineering skill. Load that
skill read-only. An expertise provider is required only when the foreign team
will implement named files.

## Authored implementation routing

An AI Team Agent that authors TypeScript or JavaScript, including an executable
skill or its tests, loads and applies these read-only authorities before
editing:

- [Function ownership](../../shared/dynamic-skills/function-ownership.md)
  assigns every authored function to a meaningful owner. An unowned function
  is a P1 finding.
- [TypeScript explicit state](../web-dev/dynamic-skills/typescript-explicit-state.md)
  requires named state and normalizes authored absence. It forbids authored
  `null`, `undefined`, and value-or-`void` contracts.
- [Domain API integrity](../../shared/dynamic-skills/domain-api-integrity.md)
  routes named types, one-parameter requests, typed failures, and schema or
  migration decisions.
- [TypeScript domain structure](../web-dev/dynamic-skills/typescript-domain-structure.md),
  [concrete values](../web-dev/dynamic-skills/typescript-no-unknown.md),
  [single parameters](../web-dev/dynamic-skills/typescript-single-parameter.md),
  and [named call arguments](../web-dev/dynamic-skills/typescript-named-args.md)
  refine that TypeScript contract.
- [Source file size](../../shared/dynamic-skills/source-file-size.md) and
  [TypeScript and Rust automation only](../../shared/dynamic-skills/typescript-rust-automation-only.md)
  govern authored source structure and automation language.
- [Testing and regression coverage](../../shared/dynamic-skills/testing-pyramid-and-regression.md)
  governs behavior-focused tests and regression evidence.
- [Prefer popular libraries](../../shared/dynamic-skills/prefer-popular-libraries.md)
  applies when adding dependencies or replacing commodity code.

Load [secret lifecycle](../security/dynamic-skills/secret-lifecycle.md) for a
secret-bearing value. Load [UI design](../web-dev/dynamic-skills/ui-design-skills.md)
for user-visible copy or interaction; the explicit-state authority governs any
conflicting Svelte-state guidance. Load [Rust coding](../dev-core/dynamic-skills/rust-coding.md),
[Rust macro minimization](../dev-core/dynamic-skills/rust-macro-minimization.md),
[Rust-TypeScript separation](../dev-core/dynamic-skills/rust-typescript-code-separation.md),
and [WASM name coherence](../dev-core/dynamic-skills/rust-wasm-name-coherence.md)
when an explicit packet names Rust or a Rust/WASM boundary. Load [TypeScript
enums over booleans](../web-dev/dynamic-skills/typescript-enums-over-booleans.md)
for domain, state, policy, mode, configuration, or owned-contract booleans;
load [Svelte state modeling](../web-dev/dynamic-skills/svelte-state-modeling.md)
for authored Svelte; and load [serial operation queues](../web-dev/dynamic-skills/typescript-serial-operation-queues.md)
when authoring a serial async queue.

These links are the AI packet's minimal policy set. The AI team does not copy
or edit foreign-team policy. A missing required authority or an unprovable
policy load fails the packet closed.

## Owned responsibilities

- Cortex governance, structure, navigation, authoring, and consistency.
- Product-specification lifecycle and evidence-backed Cortex promotion.
- Loom commands, typed workflows, runtime implementation, and deterministic
  Cortex audits under `agentic-ai/loom/`.
- Canonical Cortex skill cards and their deterministic tooling.
- Module experts and structural-refactoring experts.
- Structural-refactoring evidence and synthesis.
- Dynamic-skill authoring and workflow implementation.
- AI-focused tests and preflight contracts.

## Forbidden responsibilities

- Gizmo delivery planning, Workbench state, shared-branch Git state, pull
  requests, review threads, readiness, merge state, or final PR verdicts.
- Portable product, cryptographic, authorization, or storage implementation.
- Browser presentation and frontend interaction behavior.
- CI/CD platforms, clusters, deployments, and provider operations.
- Security architecture, cryptographic policy, or security acceptance.
- Foreign-team Cortex edits without an explicit expertise contract.
- Independent mutation of external delivery state by a Team Agent.

## Complete team scope

For an assigned AI unit, own:

- the agent or documentation contract;
- implementation in AI-owned tools;
- focused tests and deterministic enforcement;
- AI Cortex updates;
- review and validation fixes caused by the AI change; and
- a bounded evidence handoff to Gizmo.

Report product-core, security, SRE, web, shared, or delivery dependencies to
Gizmo.

## Validation

Apply the [dev delivery stages](../../gizmo-prime/architecture/dev-delivery.md).
Author meaningful tests in feature work, but execute them only in the manager's
slow PR stage. Feature validation is remote build-only execution only. Local
feedback is limited to scoped rustfmt and bounded inexpensive TS diagnostics
or formatting. Older instructions to run Loom tests, audits, preflight, or
broad pre-push commands are not local or feature-stage permissions.

For an AI packet that authors TypeScript or JavaScript, the acceptance packet
must name the authoritative checks below:

- `task loom:verify` checks Loom and every executable-skill package. It does
  not replace repository-wide TypeScript state checks or semantic ownership
  review.
- `task preflight:typescript-state` checks authored `null`, `undefined`,
  value-or-`void`, generic optional-state, and closed-discriminant violations.
- `task preflight:source-architecture` checks source-language and source-size
  policy.
- A focused review against [function ownership](../../shared/dynamic-skills/function-ownership.md)
  checks TypeScript ownership because no static TypeScript checker proves
  semantic ownership. An unowned function or a missing required result is a
  P1 failure and the acceptance must fail closed.

The acceptance record must not claim that `task loom:verify` alone proves
authored-absence or TypeScript function ownership. Deferred checks execute only
in the manager's authorized remote slow stage.

Prove semantic policy with focused review. Prove deterministic invariants with
Loom or preflight tests. Markdown must never become executable workflow state.
