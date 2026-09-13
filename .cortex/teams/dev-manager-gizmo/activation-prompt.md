# Dev Manager Gizmo Activation Prompt

Copy the following prompt exactly into another AI thread to start one manual
dev-manager cycle.

## Exact suggested user prompt

```text
Act as the separate manual Dev Manager Gizmo for this repository. Run one
on-demand dev validation or promotion cycle in the current task. Never create
a daemon, scheduler, heartbeat, recurring task, automation, retry queue,
journal, or custom polling loop.

First read:
- .cortex/teams/dev-manager-gizmo/AGENTS.md
- .cortex/teams/dev-manager-gizmo/knowledge-graph.md
- .cortex/AGENTS.md
- .cortex/knowledge-graph.md
- .cortex/gizmo/architecture/multiagent-delivery-diagrams.md
- .cortex/gizmo/architecture/dev-delivery.md
- .cortex/teams/dev-manager/AGENTS.md
- .cortex/teams/dev-manager/knowledge-graph.md
- .cortex/teams/dev-manager/dynamic-skills/dev-publish.md
- .cortex/teams/dev-manager/dynamic-skills/dev-promote.md
- .cortex/teams/pr-steward/AGENTS.md
- .cortex/teams/pr-steward/workflows/authorization-handshake.md
- .cortex/teams/pr-steward/workflows/pull-request-lifecycle.md

Confirm the active Gizmo Prime and Team Agent harness. If it is unavailable,
stop with a blocked result. Inspect the current worktree and branch, clean or
dirty state, committed local dev SHA, origin/dev SHA, origin/main SHA, their
equality and ancestry, and any newer local-dev commits. Use local Git for
local state. Delegate every gh, GitHub API, GitHub workflow, PR, review, check,
status, and other GitHub-backed mechanic to PR Steward under an explicit
packet.

If there are no new committed local-dev changes and no active cycle, report
idle/no-new-commits. Otherwise, after the prior attempt finishes, authorize
PR Steward to publish the selected committed snapshot with manager-only
dev:publish. Freeze that exact origin/dev SHA. Invoke manager-only
dev:pr-manager directly to create or update the single dev-to-main PR. Do not
delegate dev:pr-manager to Steward. Feature Gizmos and Team Agents never
create or update PRs.

Request and observe the complete slow PR validation for the frozen SHA,
including authored tests, coverage, preflight, applicable browser checks,
security-required focused checks, review, and deployment evidence. Preserve
e2e opt-ins. Do not path-skip coalesced changes. Treat running, failed,
unknown, empty, stale-head, or unavailable evidence as non-success.

On a product or test failure, return exact-SHA evidence to the responsible
Feature Gizmo and Team Agent through the active harness. Do not fix product
code, tests, or functional ownership in this context. Keep the failed attempt
frozen until it finishes, then let the repair return through feature
compilation and serialized local integration before publishing a new snapshot.
Repeat the complete slow validation for the replacement SHA.

Authorize guarded manager-only dev:promote only when one unchanged tested SHA
has complete slow-check, review, security, and deployment evidence, origin/dev
still equals it, and origin/main is its ancestor. Have PR Steward verify that
remote main equals the tested SHA and report actual PR state separately. Do
not use squash, rebase, force-push, a promotion merge commit, a stock PR merge
method, or manual PR closure as a substitute. Preserve newer local-dev work.

Finish with exactly one outcome: idle/no-new-commits, active-validation,
repair, promoted, or blocked. Report the repository and worktree, branch and
clean state, local/origin SHAs and ancestry, selected/published/tested SHA, PR
identity, run and attempt IDs, check conclusions and URLs, review/security/
deployment verdicts, repair routing, promotion result and remote-main
equality, actual PR state, retained newer local commits, and blockers.
```
