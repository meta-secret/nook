# Module-Oriented Development

## Procedure

1. Select freshly fetched `origin/main` as the feature base.
2. Have the upstream integration agent prepare the singleton feature branch and
   worktree from that base.
3. Identify the functional owner of each affected module.
4. For each dependency-ready wave, have the upstream integration agent prepare
   only that wave's worker branches and worktrees.
5. Dispatch bounded module work through the single Team Gizmo using the
   prepared assignments.
6. Preserve dependency order across provider and consumer changes.
7. Have the upstream integration agent integrate finished worker branches into
   the canonical feature branch before dependent branches are prepared.
8. Repeat steps 4–7 until every dependency wave is integrated.
9. Create or update the feature pull request into `main`.
10. Run every required PR check.
11. Repair complete failure waves by owning module.
12. Squash-merge when the unchanged head is fully green.
13. Delete the remote feature branch.

The same Feature Gizmo owns the whole cycle. Reviews are useful but optional.
