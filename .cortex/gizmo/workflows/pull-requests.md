# Pull Request Workflow

## Authority and ownership

Follow [dev delivery](../architecture/dev-delivery.md) for the two-stage
contract. Feature Gizmos publish feature branches and obtain remote
build-only execution evidence. They authorize Steward's local integration for local dev.
The manually run dev manager selects snapshots and owns the slow PR cycle.

Another active task's branch and pull request are read-only without an
explicit handoff. Related scope does not transfer ownership. Follow
[agent feature ownership](../dynamic-skills/agent-feature-ownership.md).

## Required actions

- **PR ownership**
  - Maintain one open dev-to-main PR for the current validation cycle.
  - Reuse that open PR for replacement snapshots after failed attempts finish.
  - After promotion and confirmed merged status, create a new PR for a later cycle.
  - Keep the dev branch permanent.
  - The manager owns readiness and promotion verdicts.
  - PR Steward executes GitHub operations only under explicit packets.
- **Evidence**
  - Run the full existing slow PR checks for each selected dev SHA.
  - Preserve applicable browser checks, security-required focused e2e, and opt-ins.
  - Bind source checkouts and artifacts to the captured dev head SHA.
  - Freeze origin/dev during validation and promotion.
  - Local dev may continue accepting completed features.
  - Preserve complete review and security acceptance for the promoted SHA.
- **Scope**
  - Keep each feature cohesive and attributable to its owning Gizmo.
  - Record meaningful acceptance criteria and authored test coverage.
  - Record feature commits and local integration SHA in Workbench handoffs.
  - Minimize unnecessary changes without splitting merely to satisfy a size limit.

## Prohibited actions

- Do not execute tests, coverage, e2e, or preflight in the feature stage.
- Do not turn a feature push into full slow PR validation.
- Do not publish dev from a feature task.
- Do not rebase or squash agent delivery.
- Do not create a promotion merge commit, release branch, or snapshot PR.
- Do not use stock GitHub merge methods to approximate fast-forward promotion.
- Do not force-push, delete dev, or reset newer local dev work.
- Do not close a PR manually and claim it merged.
- Do not use per-push path filtering to reduce dev slow checks.
- Do not cancel an active dev validation run or introduce a custom scheduler.

## PR title and description

Describe the actual published dev snapshot. Use a concise capability title
between 3 and 120 characters on one line. Keep these description headings in
this order:

```markdown
## Summary

- <delivered capabilities in the published snapshot>

## Agent task provenance

- Harness: <execution surface>
- Task name: <human-readable task name>
- Task ID: <stable harness ID or unavailable with reason>

## Nook Workbench

- Focused issue: <public URL or unavailable with reason>
- Immutable plan: <public commit-pinned URL or unavailable with reason>
- Worklog: <public URL, pending, or unavailable with reason>

## Validation

- <published dev SHA and slow check results>
```

- Keep provenance for the constituent features discoverable through Workbench.
- Replace pending worklog values when records are published.
- Never invent IDs or evidence URLs.
- Never publish prompts, local paths, credentials, or private machine context.
- Refresh title, scope, links, and validation after each published snapshot.
- Re-read the complete promotion diff before the final verdict.

## Review and repair procedure

1. Have PR Steward collect submitted reviews, inline threads, and PR comments.
2. Disposition every substantive finding using
   [code review comments](../dynamic-skills/code-review-comments.md).
   - Evaluate a defect claim separately from its proposed remedy.
   - Accepted defects require scoped fixes.
   - Rejected claims require evidence.
   - Clarification-needed findings remain unresolved and block acceptance.
3. Route each accepted defect or failed slow check to a feature Gizmo.
   - The owning team authors the repair and meaningful regression tests.
   - The feature repeats remote compilation and serialized local integration.
4. Reply to handled review conversations before resolving them.
   - Do not resolve silently.
   - Outdated review markers do not make unresolved findings optional.
5. Once the prior validation attempt finishes, select a new local dev snapshot.
6. Authorize Steward's publication and repeat full slow PR validation.

A typecheck or compilation result never replaces behavioral tests or security
review. Missing evidence remains visible.

## Promotion and completion procedure

1. Require successful slow checks for the frozen origin/dev SHA.
2. Require completed review dispositions and functional/security verdicts.
3. Reconcile final GitHub state through PR Steward.
4. Authorize Steward's guarded fast-forward promotion.
   - Main must be an ancestor of the tested SHA.
   - Ordinary publication must move main to that exact SHA.
   - If ancestry or protection rejects publication, report the blocker.
   - Reconcile through dev and revalidate when a new candidate is necessary.
5. Verify remote main equals the tested SHA and obtain actual PR status.
6. Publish Workbench completion evidence.
7. Preserve any newer local dev work for the next manually selected cycle.

Follow [mission delivery](mission-delivery.md) for feature handoffs and
[dev promotion](../../teams/dev-manager/dynamic-skills/dev-promote.md) for
manager operations. Apply
[self-improvement](../../teams/ai/dynamic-skills/self-improvement.md#self-improvement-review)
only when the work reveals an evidence-backed durable lesson.

## Pull request size and modularity

Keep features focused on real module and ownership boundaries. The aggregate
dev PR may contain multiple complete features. Reviewability and clear
provenance guide decomposition; old per-feature sequential PR and numeric size
gates do not define this delivery flow.
