# Branch Naming Contract

This contract defines branch names for every new feature, Team Gizmo, and leaf
task. Branch identity stays tied to the feature, team, role, and bounded
outcome.

## Outcome

A compliant branch name identifies one owner and one bounded delivery outcome.

- The Prime feature branch is the only feature remote branch.
- A Team Gizmo or leaf branch identifies one child packet and its work.
- Every new child branch complies with this contract.
- Existing branches are not retroactively renamed during an active task.

## Branch forms

Use one of these two forms.

- **Prime feature branch:** Use `codex/<feature>`.
- **Team Gizmo or leaf branch:** Use
  `codex/<feature>/<team>/<role>/<work>`.

The Team Gizmo role segment is `gizmo`. A leaf uses its canonical leaf role.
The child form must contain both the team and role segments.

## Segment constraints

- **Feature:** The `feature` segment is 10–20 characters. It uses lowercase
  kebab-case.
- **Team:** The `team` segment is one canonical team slug from this registry.
- **Role registry:** Each team allows the following role segments.
  - **AI (`ai`):** `gizmo`, `loom-specialist`, or `cortex-specialist`.
  - **Development Core (`dev-core`):** `gizmo`, `rust-core-developer`, or
    `rust-auth2-developer`.
  - **Security (`security`):** `gizmo`, `cryptography-specialist`, or
    `security-review-specialist`.
  - **SRE (`sre`):** `gizmo`, `provisioning`, or `cloud-native`.
  - **Web Development (`web-dev`):** `gizmo`, `typescript-specialist`, or
    `svelte-specialist`.
  - **Delivery Pipeline (`delivery-pipeline`):** `gizmo`, `dev-manager`, or
    `pr-lifecycle`.
- **Role:** The `role` segment is `gizmo` or the canonical leaf role listed in
  the registry for the selected team.
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
- Do not duplicate an agent-type segment, such as
  `cortex-specialist/cortex-specialist`.
- Do not create a child branch that omits either its team or role segment.
- Do not create an empty commit, an empty merge commit, or a commit with
  `--allow-empty`.
- Do not integrate with `--no-ff`.
- Do not squash, rebase, or force-push a feature or child branch.

## Ownership and integration

- A leaf branch maps one-to-one to its issued child worktree and task.
- A Team Gizmo branch maps one-to-one to its team packet and team worktree.
- Team Gizmo verifies that a child delta is non-empty before integration.
- A no-op child returns evidence and is cleaned up without a commit.
- When the feature frontier has not moved, prefer `git merge --ff-only`.
- Otherwise, cherry-pick only non-empty leaf commits without merge commits.
- Team Gizmo integrates leaf commits into the feature branch in a
  commit-preserving manner.
- After verified integration, remove the child worktree and delete its local
  child branch. This keeps `git log --all` free of retained duplicate-looking
  refs.
- Internal child branches are not PR branches.
- Do not push an internal child branch unless an explicitly authorized remote
  mechanism requires it.
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
- Prime's `pinnedLocalDevSha` is the source state for new feature work. Prime
  records `originMainSha`, `pinnedLocalDevSha`, and `featureHeadSha` for every
  feature frontier. The required chain is `originMainSha` ancestor of
  `pinnedLocalDevSha` ancestor of `featureHeadSha`; initial equality between
  the latter two is valid and later descendants are valid for reruns.
- The existing canonical feature ref and detached implementation HEAD must
  equal `featureHeadSha` exactly. Team Gizmos and leaves consume all three
  pinned identities and never resolve or guess a base independently. Missing,
  stale, mismatched, or unprovable evidence fails closed.

Follow [Team Agent Delegation](../workflows/subagent-delegation.md) for packet,
worktree, and integration sequencing.

## Examples

All examples use the valid 15-character feature segment `agent-branching`.

### AI

```text
codex/agent-branching/ai/gizmo/coordinate-ai-child-delivery
codex/agent-branching/ai/cortex-specialist/define-branch-naming-contract
```

### SRE

```text
codex/agent-branching/sre/gizmo/coordinate-sre-child-delivery
codex/agent-branching/sre/provisioning/define-runner-branch-contract
```

### Development Core

```text
codex/agent-branching/dev-core/gizmo/coordinate-core-child-delivery
codex/agent-branching/dev-core/rust-core-developer/define-core-branch-contract
```

### Security

```text
codex/agent-branching/security/gizmo/coordinate-security-child-delivery
codex/agent-branching/security/cryptography-specialist/define-crypto-branch-contract
```

### Web Development

```text
codex/agent-branching/web-dev/gizmo/coordinate-web-child-delivery
codex/agent-branching/web-dev/typescript-specialist/define-web-branch-contract
```

### Delivery Pipeline

```text
codex/agent-branching/delivery-pipeline/gizmo/coordinate-pipeline-child-delivery
codex/agent-branching/delivery-pipeline/pr-lifecycle/define-remote-branch-contract
```

## Validation

1. Before creating a branch, verify its form and segment lengths.
   - Verify the canonical team and role.
   - Verify the bounded work outcome.
   - Verify the total length.
2. Before integration, verify that the child delta is non-empty.
   - Preserve the non-empty commit history.
