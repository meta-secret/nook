# Review Request Workflow

## Stage ownership

Follow [dev delivery](../architecture/dev-delivery.md). Fast feature agents
review code alongside repeatable remote build-only evidence. The manually run
dev manager owns review and full slow checks for the published dev SHA.
Missing build-only capability is a blocker, never permission to run slow
feature checks.

## Required actions

- **Review requests**
  - PR Steward executes GitHub review operations under the owning controller's packet.
  - Codex is the sole automatic review provider.
  - Preserve the existing final-head review opt-in for the manager's slow PR cycle.
  - An eye reaction is liveness evidence only.
  - Inspect existing feedback from every provider regardless of who requested it.
- **Dispositions**
  - Follow [code review comments](../dynamic-skills/code-review-comments.md).
  - Record a disposition for every substantive finding, including older heads.
  - Evaluate the defect claim separately from the proposed remedy.
  - Treat regressions caused by the change as relevant regardless of their consumer.
  - Implement accepted defects through the responsible feature team.
  - Reject claims only with evidence.
  - Keep clarification-needed findings unresolved and acceptance-blocking.
  - Reply to the original conversation before resolving it.
  - Preserve submitted review bodies and top-level comments in the evidence.
  - Do not treat an outdated marker as resolution.
- **Acceptance**
  - Required functional and security verdicts remain binding.
  - Compilation and type safety do not replace authored behavior tests.
  - The manager requires complete slow checks and review for the frozen dev SHA.
  - Confirm actual remote review state through Steward before promotion.

## Prohibited actions

- Do not run local tests, audits, broad pre-push checks, or product compilation.
- Do not dispatch full slow validation for a feature branch.
- Do not cancel an active dev validation batch when feedback arrives.
- Do not replace the frozen origin/dev head during that batch.
- Do not request optional review providers without user direction.
- Do not interpret feedback as permission to implement unrelated enhancements.
- Do not waive a confirmed security or authority violation.

## Repair procedure

1. Collect the current review inventory through PR Steward.
2. Route alleged security violations to the authorized security owner.
   - Confirm findings against code and evidence.
   - A confirmed violation blocks acceptance and promotion.
3. Classify each defect and proposed remedy independently.
4. Send accepted repairs to a feature Gizmo with bounded team scopes.
5. Author regression tests and obtain build-only evidence for the repaired feature SHA.
6. Integrate the accepted repair into local dev through the serialized path.
7. After the prior slow attempt finishes, let the manager select a new snapshot.
8. Repeat full slow checks and required review for that published SHA.
9. Record targeted replies and resolve only fixed or invalidated findings.

A rejected-only batch does not create replacement commits. Keep missing
evidence visible. Three automated finding batches require a coherent
stabilization review before another automated request, without local test
execution or cancellation of active checks.

## Handoff

Return the source SHA, substantive finding inventory, dispositions, required
team/security verdicts, and unresolved blockers. Feature Gizmo owns feature
acceptance; the dev manager owns promotion acceptance. A changed SHA
invalidates evidence that is not stable across that change.
