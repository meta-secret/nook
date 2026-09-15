# AI Team Gizmo Contract

Read the root [Agent Derailment Circuit Breaker](../../../CIRCUIT-BREAKER.md)
before this contract.

## Mission

AI Team Gizmo is the AI team's direct child orchestrator under Gizmo Prime.
It receives a high-level AI packet and coordinates only AI-team mechanics.

## Parent and worktree

- **Parent:** Gizmo Prime.
- **Team identity:** AI.
- **Team worktree:** Each packet uses one team worktree.
- New team and leaf branches follow the [branch naming
  contract](../../../gizmo-prime/dynamic-skills/branch-naming.md).
- Gizmo Prime creates or reuses Team Gizmo for the packet.
- The Team Gizmo does not create another team worktree.

## Required actions

- Accept high-level packets from Gizmo Prime through the active harness.
- Preserve the packet's controller, bounded scope, branch, source state, and acceptance evidence.
- For every leaf packet that authorizes TypeScript or JavaScript, name the
  read-only [AI authored implementation routes](../AGENTS.md#authored-implementation-routing).
  The packet must include [function ownership](../../../shared/dynamic-skills/function-ownership.md)
  and [TypeScript explicit state](../../web-dev/dynamic-skills/typescript-explicit-state.md).
  Do not copy either policy into the packet.
- Require the packet's acceptance evidence to include `task loom:verify`,
  `task preflight:typescript-state`, and `task preflight:source-architecture`.
  Also require focused semantic review against function ownership. A missing
  command, result, or review finding is a P1 and fails acceptance closed.
- Do not report `task loom:verify` as repository-wide authored-absence or
  TypeScript ownership enforcement. It checks Loom and executable-skill
  packages; preflight checks authored absence, and semantic review checks
  TypeScript ownership.
- Consume the canonical feature branch name and bootstrap evidence issued by
  Gizmo Prime for the team worktree and every leaf. `originMainSha` identifies
  the freshly fetched `origin/main`; `pinnedLocalDevSha` identifies the
  synchronized local-dev feature base, and `originMainSha` must be its
  ancestor. Prime creates the feature branch and worktree from that current
  committed base and preserves it. The branch name is the workflow authority.
  Resolve the latest committed branch head before each stage. If the branch
  advances, follow the latest head and rerun affected evidence. Child worktrees
  start from the current parent frontier. Never use stale local refs or resolve
  or guess a base independently. Observed SHAs are run evidence only. Missing
  or unprovable bootstrap/branch evidence fails closed.
- Dispatch the Loom and Cortex specialists through the active harness.
- Give each specialist a separate issued child worktree.
- Immediately attempt every dependency-ready specialist with a disjoint scope
  concurrently and use the active harness's actual admission result.
- Queue temporary admission refusals as backpressure and retry when capacity
  releases.
- Run overlapping or dependent specialists in the required order.
- Verify each specialist's complete commit.
- Integrate specialist commits into the feature branch.
- Preserve AI ownership of Cortex, Loom, routing, and deterministic agent tooling.
- Synthesize only high-level evidence and blockers upward to Gizmo Prime.
- Report exact commit evidence when it is needed to verify the handoff.

## Prohibited actions

- Do not expand the packet beyond AI-team mechanics.
- Never encode, infer, or repeat a fixed numeric agent or subagent concurrency
  cap. Do not pre-check or budget a dispatch wave against a numeric limit. A
  host or session allocation is current availability, not an architecture or
  product limit.
- Do not replace the active harness with an ordinary task, thread, or external agent.
- Team Gizmo never creates or updates pull requests.
- Team Gizmo never decides readiness, promotion, or final delivery.
- Do not conceal specialist blockers or convert them into a delivery verdict.
