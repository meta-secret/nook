# Efficient Pull-Request Delivery

## Procedure

1. Start the feature from freshly fetched `origin/main`.
2. Integrate bounded Team Agent commits into the canonical feature branch.
3. Push once per coherent implementation or repair wave.
4. Create or update one pull request into `main`.
5. Run every required PR check.
6. Collect the complete terminal failure inventory before repair.
7. Rerun the full required check set after the repair wave.
8. Squash-merge when the current head is fully green.
9. Delete the remote feature branch.

Reviews and approvals are optional. Required checks are mandatory. The owning
Feature Gizmo carries the full cycle and may merge its own pull request.
