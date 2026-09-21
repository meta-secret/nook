# Module-Oriented Development

## Procedure

1. Select freshly fetched `origin/main` as the feature base.
2. Identify the functional owner of each affected module.
3. Dispatch bounded module work through the single Team Gizmo.
4. Preserve dependency order across provider and consumer changes.
5. Have the upstream integration agent integrate finished worker branches into
   the canonical feature branch.
6. Create or update the feature pull request into `main`.
7. Run every required PR check.
8. Repair complete failure waves by owning module.
9. Squash-merge when the unchanged head is fully green.
10. Delete the remote feature branch.

The same Feature Gizmo owns the whole cycle. Reviews are useful but optional.
