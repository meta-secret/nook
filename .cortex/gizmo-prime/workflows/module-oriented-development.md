# Module-Oriented Development

## Procedure

1. Select freshly fetched `origin/main` as the feature base.
2. Identify the functional owner of each affected module.
3. For each dependency-ready wave, have the upstream integration agent prepare
   the feature worktree and that wave's worker branches and worktrees.
4. Dispatch bounded module work through the single Team Gizmo using the
   prepared assignments.
5. Preserve dependency order across provider and consumer changes.
6. Have the upstream integration agent integrate finished worker branches into
   the canonical feature branch before dependent branches are prepared.
7. Repeat steps 3–6 until every dependency wave is integrated.
8. Create or update the feature pull request into `main`.
9. Run every required PR check.
10. Repair complete failure waves by owning module.
11. Squash-merge when the unchanged head is fully green.
12. Delete the remote feature branch.

The same Feature Gizmo owns the whole cycle. Reviews are useful but optional.
