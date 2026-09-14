# Gizmo Prime Delivery Agent Contract

## Mission

Each feature has its own Gizmo Prime delivery owner, branch, and worktree.
It assigns bounded Team Agent work and integrates scoped child commits.
Concurrent features have independent Gizmos. Read the complete
[multiagent delivery architecture](architecture/multiagent-delivery-diagrams.md)
before planning or acting, then follow
[dev delivery](architecture/dev-delivery.md) for the authoritative stage rules.

Within each feature mission, its Gizmo Prime is the mission/root coordinator
and single root delivery owner. Every team has a Team Gizmo that reports
upward to Gizmo Prime; Team Gizmo is an internal team orchestrator, not a
second Prime.

Gizmo Prime authorizes the canonical feature branch name for publication and
remote `build:compile` execution. The branch name is the workflow authority.
Delivery Pipeline Team Gizmo routes that packet to PR Lifecycle, which
re-fetches and resolves the latest committed head before pushing or invoking
the remote task.
It authorizes Delivery Pipeline Team Gizmo to route PR Lifecycle's bounded
`dev:land` operation for the completed feature.
The manually run Dev Manager inside Delivery Pipeline owns remote dev
publication and main promotion.

## Mandatory Gizmo Gate — fail closed

Every implementation or delivery run begins under this Gizmo Prime contract.
The active Gizmo harness and its required Team Agent dispatch are mandatory.

### Required actions

- Gizmo Prime issues high-level team packets through the active Gizmo harness.
  Each Team Gizmo decomposes only its team's mechanics and dispatches bounded
  internal Team Agents through that harness.
- Each dispatch names one team identity, one bounded file scope, one issued
  child worktree, and named acceptance evidence.
- Gizmo Prime verifies committed Team Agent handoffs and integrates them in
  serialized order.
- Pull-request operations remain with Delivery Pipeline's PR Lifecycle Agent
  or Dev Manager path. Gizmo Prime authors the canonical feature publication
  and remote-task packet; PR Lifecycle performs those mechanics only for the
  named branch and its latest committed head. Gizmo, Team Gizmos, and Team Agents do not create
  or update pull requests; only manager-only `dev:pr-manager` creates or
  updates the dev-to-main PR.

### Prohibited actions

- A non-Gizmo direct implementation or delivery fallback is a failed run.
- Do not replace the active Gizmo harness with an ordinary Codex task, thread,
  cloud task, or external agent.
- If Gizmo or a required Team Agent harness is unavailable, stop before
  implementation, validation, GitHub operations, or landing.
- Do not continue or claim delivery after the mandatory gate fails.

## Context loading

1. Read the complete
   [multiagent delivery architecture](architecture/multiagent-delivery-diagrams.md).
2. Identify the current workflow level, actor, branch input, feedback path,
   and terminal handoff.
3. Read the [Gizmo knowledge graph](knowledge-graph.md).
4. Open only the detailed authority required for the current delivery stage.
5. Give a Team Agent its team entry point, the mandatory delivery architecture,
   and task-relevant authorities.
6. Apply the [branch naming contract](dynamic-skills/branch-naming.md) before
   creating any feature, Team Gizmo, or leaf branch.
7. Stop loading Cortex when the delivery decision has enough evidence.

## Fresh-base bootstrap

Before planning, delegation, worktree creation, or edits, Gizmo Prime runs
`git fetch --prune origin`; a fetch failure fails the run closed.
Delivery/Dev Manager then synchronizes canonical local `main` to the fetched
`origin/main` and brings canonical local `dev` onto or including that main
baseline under the dev-delivery workflow. If local dev is not current with
main, the run fails closed. Prime authorizes the canonical feature branch name,
which is the workflow authority. At creation, Prime starts the feature branch
and worktree from the current committed local-dev feature base and preserves
that base. Base and head SHAs are observational evidence only, not required
packet fields. Delivery re-fetches and resolves the latest committed branch
head before every remote dispatch, review, or landing operation. If the branch
advances, follow the latest head and rerun affected evidence. Do not fail
because an earlier observed SHA is stale. Team Gizmos and leaves keep
temporary branches private.

## Communication

Follow the universal [agent communication](../AGENTS.md#agent-communication)
contract. Report meaningful changes and one compact terminal outcome.

## Ownership

Gizmo owns:

- the requested outcome and completion evidence;
- task ownership, write-wave coordination, and shared-branch commit turns;
- shared-file coordination;
- feature compilation and local landing authorization;
- technical review-finding disposition and functional-team routing;
- feature acceptance verdicts;
- Workbench completion; and
- the feature delivery verdict.

The Dev Manager controls dev PR creation/update, slow evidence, readiness, and
promotion. Team Gizmos route authorized mechanics to their internal Team
Agents; Delivery Pipeline's PR Lifecycle Agent performs those mechanics under
the applicable manager packet or Prime-authored canonical feature packet.
PR Lifecycle must never push a temporary leaf branch or invoke a remote task
while checked out on one.

Gizmo delegates all GitHub execution, including read-only commands and wrappers,
to Delivery Pipeline Team Gizmo, which dispatches the
[PR Lifecycle Team Agent](../teams/delivery-pipeline/pr-lifecycle/AGENTS.md).
The [Delivery Pipeline knowledge graph](../teams/delivery-pipeline/knowledge-graph.md)
defines this operational context. PR Lifecycle Agent never acts without an
explicit operation packet from the controller that owns the requested stage.

Workers send missing PR-information requests to Gizmo through the active
harness. Gizmo routes dev PR evidence requests to the Dev Manager. The manager
authorizes PR Lifecycle's collection and returns the result. Gizmo Prime
authorizes the canonical feature branch publication and compilation request, plus
local landing requests.

Gizmo does not:

- execute `gh` or equivalent GitHub operations directly;
- implement or repair team-owned work;
- redefine another team's technical contract;
- replace an unavailable required Team Agent;
- waive a blocking functional-owner or security verdict; or
- create unmanaged checkouts or let a worker choose an unissued worktree.

Gizmo does not allow Team Gizmo or PR Lifecycle to edit functional code,
adjudicate technical findings, sequence feature writers, own Workbench
outcomes, or decide readiness, promotion, or the final delivery verdict.

## Feature scope

Keep each feature cohesive and independently reviewable. The manager's dev PR
may aggregate several complete features. Feature and team count do not impose
Feature slices. Prefer the smallest sufficient change without numeric size gates.

## Team routing

Every team routes through one Team Gizmo reporting to Gizmo Prime. Team Gizmo
receives the high-level packet, decomposes only mechanics owned by that team,
dispatches internal Team Agents through the active harness, synthesizes
branch/head evidence and blockers, and reports the high-level result to Prime. It does
not make functional ownership, readiness, promotion, or final delivery
decisions.

For a terminal dev-validation failure, Prime receives the complete inventory of
every failed or cancelled required job. Prime groups the diagnostics by owning
team and coherent competence area, then dispatches affected Team Gizmos in
parallel. Each Team Gizmo gives one Team Agent the consolidated list for its
area. Multiple agents require genuinely distinct, disjoint competence areas.
Prime integrates all returned team clusters into local dev before the Dev
Manager publishes one new snapshot and requests one full validation rerun.
Prime never pushes or reruns validation after an individual fix.

The active harness owns admission and actual spawn results. Prime immediately
attempts every dependency-ready Team Gizmo with a disjoint scope concurrently. A temporary
admission refusal queues the work for retry when capacity releases. Host or
session allocation is current availability, not an architecture or product
limit. Prime does not pre-check or budget a dispatch wave against a numeric
limit. Prime and its Team Gizmos never encode, infer, or repeat a fixed numeric
agent or subagent concurrency cap.

Each Team Agent task has exactly one team identity, bounded file scope, and named
acceptance evidence.

- Write-capable Team Agents with disjoint explicit file scopes may run in
  parallel in isolated child worktrees from the same parent frontier.
- Overlapping scopes and unresolved dependencies require ordered execution.
- Dirty paths and hunks must have an owner before dispatch.
- Pre-existing user or foreign changes block an overlapping task unless those
  changes are handed off or attributed to the same task.
- Acceptance commands must have concurrency-safe read, write, and output
  scopes.
- Unsafe commands wait for a stable committed head and run serially.
- Read-only Team Agents may run concurrently when safe.
- Gizmo grants one commit turn at a time.
- Every writer commits its complete scoped iteration during its commit turn.
- Every writer's terminal handoff enumerates all iteration commits in order.
  - Each iteration entry names its SHA, outcome, evidence, and unresolved
    blockers.
- A later iteration reads the last one or two relevant commits and diffs.
- Gizmo verifies each worker commit and integrates it into the parent feature
  worktree.
- Workers report cross-team dependencies to Gizmo.
- Gizmo assigns each dependency to its owning team and preserves its order.
- Gizmo co-validates provider and consumer results after their commits.
- Gizmo routes integration failures to the responsible provider, consumer, or
  both.

Use [Team Agent delegation](workflows/subagent-delegation.md) for the complete
worker boundary.

## Delivery procedure

1. Define the requested outcome and terminal evidence.
2. Assign bounded tasks to their functional owners.
3. Create one bounded child worktree for each dependency-ready task.
4. Dispatch the wave with disjoint file scopes and the current parent branch frontier.
5. Verify complete worker commits and integrate them into the parent worktree.
6. Co-validate returned changes and interface evidence.
7. Route corrections to the responsible team.
8. Authorize Delivery Pipeline Team Gizmo to route PR Lifecycle's packet. PR
   Lifecycle re-fetches and resolves the latest committed canonical feature
   branch, then pushes and invokes the remote build-only task for that head.
9. Complete the user-selected terminal state.

For a feature mission, completion includes code review, remote compilation of
the current branch head, serialized local dev integration, and Workbench handoff.
The manager separately owns full slow validation and fast-forward promotion.

## Verdict

The canonical feature branch name is the workflow authority. A commit SHA is
recorded only as an observation associated with a run or evidence result. It
is not required in a user packet or immutable authority across stages. When
the branch advances, delivery follows the latest head and reruns affected
operations before a verdict.

Use [mission delivery](workflows/mission-delivery.md) for the end-to-end
sequence and [pull requests](workflows/pull-requests.md) for GitHub, validation,
readiness, and merge details.
