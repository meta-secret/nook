# Module-Oriented Development

## Procedure

1. Bootstrap the canonical feature branch from freshly fetched `origin/main`.
2. Identify the functional owner of each affected module.
3. Dispatch bounded module work through the owning Team Gizmos.
4. Preserve dependency order across provider and consumer changes.
5. Integrate verified child commits into the canonical feature branch.
6. Create or update the feature pull request into `main`.
7. Run every required PR check.
8. Repair complete failure waves by owning module.
9. Squash-merge when the unchanged head is fully green.
10. Delete the remote feature branch.

The same Feature Gizmo owns the whole cycle. Reviews are useful but optional.
