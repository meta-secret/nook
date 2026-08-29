# GitHub Actions Execution and Validation

## Purpose

Keep agent machines on the lightest possible local work.

Use the configured GitHub Actions runner for iterative builds and tests.
Trusted validation and delivery jobs use ARC. Build producers use the general
scale set with persistent node-local BuildKit. Browser jobs use ordinary Pods
on `nook-k0s-container`. Untrusted fork and Dependabot code stays on
GitHub-hosted runners without private credentials.

## Problem Pattern

Agents burn wall-clock and contend with other worktrees by running Docker builds
and tests locally.

Automatically starting the complete PR pipeline on every experimental push also
wastes hosted concurrency before the branch is ready.

## Preferred Pattern

Validation has three layers:

- **Required worker handoff:** an ordinary Team Agent formats every changed file
  in its allowed scope and returns one coherent exact commit without pushing or
  operating external delivery state.
- **Required integrated local hygiene:** after integrating accepted handoffs,
  Gizmo runs `task loom:pre-push` before every push. If host-applied formatting
  changes team-owned source or Cortex, Gizmo routes that exact diff to the
  responsible Team Agent for a fresh formatted commit, reintegrates it, and
  repeats pre-push rather than authoring or committing it.
- **Focused evidence:** after pushing an exact non-validation-ready branch head,
  immediately use `task remote TASK_NAME=<name>` for at least one relevant gate.
  - Do not batch broad gates sequentially before complete validation.
  - Use only selectors listed by `task remote:list`. A local Docker-backed task
    remains unavailable until it has a Kubernetes-native Pod implementation.
- **Required remotely:** explicitly trigger complete exact-head PR validation.
  Dispatch it immediately after pushing a validation-ready head. Focused tasks
  are optional for that head and never replace complete validation.
  - Trusted same-repository native Rust and Rust ecosystem PR jobs and Main
    build producers select ARC.
  - General ARC provides persistent BuildKit for image producers.
  - Container ARC creates an ordinary Kubernetes job Pod from each exact image.
  - Playwright executes directly inside that Pod. It never launches a nested Docker or Podman container.
  - BuildKit builds and exports images only. It does not execute workloads.
  - Main's portable WASM cache proof uses the general ARC scale set.
  - Fork and Dependabot code stays on secret-free GitHub-hosted workers.

Validate request example:

```yaml
prLand:
  validate:
    prNumber: 123
    runFullE2e: false
```

```bash
# Gizmo, after integrating accepted Team Agent handoffs
task loom:pre-push
git push -u origin HEAD
task loom:pr-land CONFIG=path/to/gizmo-owned/pr-land-validate.yaml
```

- For Main-fix PRs, set `runFullE2e: true` in the `prLand.validate` request.
- See [Loom tools](../../ai/references/loom-tools.md).
- Expensive remote tasks and complete PR validation:
  - refresh their base branch; and
  - refuse dispatch when the local head is stale.
- When the head is stale:
  1. merge the reported `origin/<base>`;
  2. run `task loom:pre-push`;
  3. push; and
  4. retry.
- On a red remote run:
  1. read `gh run view <id> --log-failed`;
  2. route the cause to its responsible Team Agent for one coherent exact fix
     commit;
  3. integrate the formatted handoff and run `task loom:pre-push`;
  4. route any team-owned source or Cortex formatter diff back to its owner,
     reintegrate the fresh formatted commit, and repeat pre-push; and
  5. after a clean pre-push, push and immediately dispatch complete validation
     when ready, or at least one relevant focused task when not ready.
- Ordinary pushes do not refresh complete PR checks.

## Scope

Applies to:

- Every normal implementation PR coordinated by Gizmo
- Coding-bro, pull-request, CI-pipeline, and quality workflow docs
- Pre-push hygiene and efficient PR delivery skills

Does not apply to:

- Humans who choose to run local mirrors for their own feedback
- Workbench issue, worklog, and statistics commits
- Read-only / question-only sessions with no commits
- Interactive development servers that require retained local state

## Examples

- Before: format → push → local `task check` while automatic PR CI consumes
  hosted workers.
- After: formatted Team Agent commit handoff → Gizmo integration → clean Loom
  pre-push → push → immediate Loom validate → Loom ready.
- Before: remote Verify fails → run full local `task ci:pr` before re-push.
- After: remote Verify fails → Team Agent exact fix commit → Gizmo integration
  and Loom pre-push → push → re-validate.

## Application Checklist

- [ ] Ordinary Team Agents format their allowed changed files and return one
      coherent exact commit without pushing.
- [ ] After integration, Gizmo runs `task loom:pre-push` unconditionally before
      every push.
- [ ] Gizmo routes team-owned source or Cortex formatter diffs back to the
      responsible Team Agent and reintegrates a fresh formatted commit.
- [ ] Do not require `task check`, `task ci:pr`, full suites, builds, or e2e
      on the agent machine.
- [ ] Every non-validation-ready pushed head immediately gets at least one
      relevant focused `task remote` run.
- [ ] Every validation-ready pushed head immediately gets complete validation;
      focused tasks are optional and never prerequisites.
- [ ] Gizmo triggers complete validation explicitly with Loom or
      `task pr:validate`.
- [ ] Gizmo re-validates after every push that replaces the validated head.

## Validation

Proof is a PR whose first Verify attempt is not wasted on format/demo misses,
whose every pushed head received immediate remote evidence, and whose complete
validation was requested immediately once the head was ready.
