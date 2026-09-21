# Branch Naming Contract

This contract adds Nook naming rules to the upstream
[local feature workflow](../../../.meta-cortex/agents/teams/delivery-team/integration-agent/skills/local-feature/SKILL.md).
Branch identity stays tied to the feature, team, role, and bounded outcome.

## Outcome

A compliant branch name identifies one owner and one bounded delivery outcome.

- The Prime feature branch is the only feature remote branch.
- A worker branch identifies one assigned task and its work.
- Every new worker branch complies with this contract.
- Existing branches are not retroactively renamed during an active task.

## Branch forms

Use one of these two forms.

- **Prime feature branch:** Use `codex/<feature>`.
- **Worker branch:** Use
  `codex/child/<team>/<role>/<feature>/<work>`.

The literal `child` namespace is required for private worker branches. It is
shorter than the minimum feature length, so a worker ref cannot
be the path prefix of a canonical `codex/<feature>` branch. The team and role
segments therefore precede the variable feature and work segments. Use the
worker's canonical role segment.

## Segment constraints

- **Feature:** The `feature` segment is 10–20 characters. It uses lowercase
  kebab-case.
- **Team:** The `team` segment is one canonical team slug from this registry.
- **Role registry:** Each team allows the following role segments.
  - **AI (`ai`):** `loom-specialist` or `cortex-specialist`.
  - **Development Core (`dev-core`):** `rust-core-developer` or
    `rust-auth2-developer`.
  - **Security (`security`):** `cryptography-specialist` or
    `security-review-specialist`.
  - **SRE (`sre`):** `provisioning`, `cloud-native`, or `docker-cache-specialist`.
  - **Web Development (`web-dev`):** `typescript-specialist`,
    `svelte-specialist`, or `web-designer`.
  - **Delivery Pipeline (`delivery-pipeline`):** `pr-lifecycle`.
- **Role:** The `role` segment is the canonical worker role listed for the team.
- **Work:** The `work` segment is 20–50 characters. It uses lowercase
  kebab-case and describes a bounded outcome.
- **Full name:** The complete branch name is at most 120 characters,
  including the `codex/` prefix and separators.

Lowercase kebab-case uses lowercase letters or digits in words separated by
single hyphens. Do not use leading, trailing, or repeated hyphens.

## Prohibited naming and delivery forms

- Do not append opaque attempt suffixes such as `v2`.
- Do not use a generic work label such as `cleanup` as the bounded outcome.
- Do not encode UUIDs or timestamps in a branch name.
- Do not omit the literal `child` namespace from a Team Gizmo or leaf branch.
- Do not place the feature segment before the team and role segments.
- Do not duplicate an agent-type segment, such as
  `cortex-specialist/cortex-specialist`.
- Do not create a child branch that omits either its team or role segment.
- Do not force-push a feature or child branch.

## Ownership and integration

- A worker branch maps one-to-one to its assigned task worktree.
- Follow upstream local feature integration for commits, merges, and cleanup.
- Worker branches are local integration inputs, not PR branches.
- Push and publish only the Prime feature branch as the feature remote branch.

## Dispatch and follow-up

- Prime dispatches every dependency-ready Team Gizmo with a disjoint scope
  concurrently and uses the active harness's actual admission result.
- A temporary admission refusal queues the task for retry when capacity releases.
- A host or session allocation is current availability, not an architecture or
  product limit.
- Do not pre-check or budget a dispatch wave against a numeric limit.
- Never encode, infer, or repeat a fixed numeric agent or subagent concurrency
  cap.
- A follow-up user message does not stop Team Gizmos or leaf agents that are
  already delegated.
- Prime routes additions concurrently when dependencies are ready and scopes are
  disjoint.
- Prime remains the user-facing mission coordinator and root, not a subagent.
- Prime authorizes the canonical feature branch name. The branch name is the
  workflow authority for publication and remote work.
- After the mandatory fetch, Prime selects `origin/main` as the feature base.
  The upstream integration agent receives that base and the authorized branch
  names when it creates the feature and worker worktrees.
- Delivery re-fetches and resolves the latest committed branch head before
  remote dispatch, PR mutation, or merge. If the branch advances, follow the
  latest head and rerun affected evidence instead of failing on stale SHA
  observations.
- Temporary Team Gizmo and leaf branches are private. Only the canonical
  feature branch is published or used as a remote workflow ref.
- After every required PR check is green, squash-merge the canonical feature
  branch into `main` and delete the remote feature branch.

Follow [Team Agent Delegation](../workflows/subagent-delegation.md) for Nook
assignment scope and the upstream integration skill for Git sequencing.

## Examples

All examples use the valid 15-character feature segment `agent-branching`.

### AI

```text
codex/child/ai/cortex-specialist/agent-branching/define-branch-naming-contract
```

### SRE

```text
codex/child/sre/provisioning/agent-branching/define-runner-branch-contract
```

### Development Core

```text
codex/child/dev-core/rust-core-developer/agent-branching/define-core-branch-contract
```

### Security

```text
codex/child/security/cryptography-specialist/agent-branching/define-crypto-branch-contract
```

### Web Development

```text
codex/child/web-dev/typescript-specialist/agent-branching/define-web-branch-contract
codex/child/web-dev/web-designer/agent-branching/design-shared-browser-interface
```

### Delivery Pipeline

```text
codex/child/delivery-pipeline/pr-lifecycle/agent-branching/define-remote-branch-contract
```

## Validation

1. Before creating a branch, verify its form and segment lengths.
   - Verify the canonical team and role.
   - Verify the bounded work outcome.
   - Verify the total length.
2. Before creation, verify the complete branch name against the constraints.
