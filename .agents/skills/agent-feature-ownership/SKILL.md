---
name: agent-feature-ownership
description: >-
  Keep each Nook agent inside its assigned feature and focused issue set. Use
  before mutating Workbench records, branches, pull requests, review threads,
  checks, or merge state when concurrent agent work may overlap.
---

# Agent Feature Ownership

Read and follow the canonical project skill at
[.cortex/teams/ai/dynamic-skills/agent-feature-ownership.md](../../../.cortex/teams/ai/dynamic-skills/agent-feature-ownership.md).

Before any remote mutation:

1. Identify the current task's owned feature and focused issues.
2. Confirm the target branch or PR belongs to that scope.
3. Treat other active tasks as read-only.
4. Require an explicit handoff before taking ownership.
