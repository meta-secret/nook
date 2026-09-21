# Team-Oriented Development

Each functional team owns its implementation and tests. The single Team Gizmo dispatches
bounded Team Agents and integrates their commits into the canonical feature
branch.

The owning Feature Gizmo owns readiness and complete delivery. Delivery
Pipeline routes PR mechanics to PR Lifecycle Agent. One feature branch creates
one PR into `main`, runs all required checks, squash-merges, and is deleted
from the remote.

Reviews and approvals are optional. Known defects and failed required checks
remain blocking.
