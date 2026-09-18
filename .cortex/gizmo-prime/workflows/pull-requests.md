# Pull Requests

## Required actions

- Create one pull request from each canonical feature branch into `main`.
- Run every required PR check for the current feature head.
- Wait for the complete terminal check wave.
- Return every failed or cancelled required job before repair.
- Treat reviews and approvals as optional.
- Permit the owning Feature Gizmo to merge its own pull request.
- Use squash merge to preserve linear `main` history.
- Verify GitHub's actual merged state and the squash result on `origin/main`.
- Delete the remote feature branch after merge.

## Prohibited actions

- Do not use an integration `dev` branch.
- Do not create merge commits on `main`.
- Do not bypass required checks.
- Do not require an approval count.
- Do not force-push.
- Do not report a manually closed PR as merged.
