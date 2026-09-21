# Module-Oriented Development

## Procedure

1. Select freshly fetched `origin/main` as the feature base.
2. Identify the functional owner of each affected module.
3. Have the upstream integration agent prepare the feature worktree and each
   dependency-ready worker branch and worktree.
4. Dispatch bounded module work through the single Team Gizmo using the
   prepared assignments.
5. Preserve dependency order across provider and consumer changes.
6. Have the upstream integration agent integrate finished worker branches into
   the canonical feature branch.
7. Create or update the feature pull request into `main`.
8. Run every required PR check.
9. Repair complete failure waves by owning module.
10. Squash-merge when the unchanged head is fully green.
11. Delete the remote feature branch.

The same Feature Gizmo owns the whole cycle. Reviews are useful but optional.
