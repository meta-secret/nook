# Promote Tested Dev

## Scope

Use under dev-manager authority with complete slow-stage evidence. Follow the
[canonical promotion procedure](../../../gizmo/architecture/dev-delivery.md#fast-forward-promotion-procedure).

## Procedure

1. Freeze the tested SHA and successful review/security verdicts.
2. Authorize PR Steward to invoke guarded fast-forward promotion.
3. Require `origin/dev` to equal the exact frozen tested SHA before publication.
   - Merely observing an unchanged remote head is insufficient.
   - Require remote main to be an ancestor of that exact SHA.
   - If main is not an ancestor, return reconciliation to the feature path.
   - Validate the resulting new dev snapshot before another promotion.
4. Verify remote main equals the tested SHA.
5. Obtain actual GitHub PR status through PR Steward.
6. Report completion or the exact remaining blocker.

## Prohibited actions

- Do not replace the fast-forward ref move with a GitHub merge method.
- Do not rewrite local dev or discard newer local features.
- Do not close the PR to simulate merged status.
- Do not use unauthorized protection bypasses or force-push.
- The authorized ADMIN identity still requires all checks and revision guards.

## Evidence

Retain the frozen tested SHA, equal origin/dev SHA, observed main ancestry,
ordinary push outcome, resulting
remote main SHA, and actual PR status. A ref update and a PR-state observation
are distinct evidence items.
