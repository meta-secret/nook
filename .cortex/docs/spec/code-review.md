# Code Review

Code review improves feature quality but is not an approval gate. The owning
Feature Gizmo may merge its own pull request after all required checks are
green.

## Required actions

- Review the current committed feature head.
- Route correctness and security findings to the owning team.
- Invalidate head-bound findings when the feature branch advances.
- Resolve known blocking defects before merge.
- Run the complete required PR check set after repairs.

## Prohibited actions

- Do not require a reviewer, approval count, or external sign-off.
- Do not treat absent review as a merge blocker.
- Do not allow review to substitute for required PR checks.
