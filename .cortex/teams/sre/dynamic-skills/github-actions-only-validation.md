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

- **Required handoff:** Team Agents format and commit without pushing. Gizmo
  integrates, runs `task loom:pre-push`, and owns publication.
- **Focused evidence:** after Gizmo pushes a non-ready head, use
  `task remote TASK_NAME=<name>` for one relevant gate.
  - Do not batch broad gates sequentially before complete validation.
  - Use only selectors listed by `task remote:list`. A local Docker-backed task
    remains unavailable until it has a Kubernetes-native Pod implementation.
- **Required remotely:** Gizmo triggers complete exact-head PR validation.
  - Dispatch every required hosted check immediately.
  - Never wait for GitHub review before dispatch.
  - After dispatch, request one circuit-guarded Codex review bound to the
    current head and base without waiting for its result.
  - Collect review while hosted validation runs.
  - After both settle, batch current review findings and failed checks into one
    repair iteration.
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
  2. obtain the responsible Team Agent's formatted fix commit;
  3. Gizmo integrates, runs pre-push, and pushes; and
  4. Gizmo validates when ready or runs relevant focused proof.
- Ordinary pushes do not refresh complete PR checks.
- Product PR and Main validation skip only all-AI change sets.
  - The explicit canonical AI-only inventory lives in the product workflow
    classifiers. Neither PR nor Main uses native exclusions because trigger
    filters discard rename source paths before a workflow can fail closed.
  - PR, Main, minds-specialist, and CI-agent readiness use the same inventory.
  - Repository policy covers every inventory entry on Main.
  - Rename classification reports both real paths and always restores product
    validation; it never injects a synthetic path into readiness evidence.
  - One path outside the inventory restores product validation.
  - The PR classifier paginates the complete file list.
  - API failures, empty results, the API cap, and `changed_files` mismatches
    restore product validation.
  - Unsupported statuses and missing rename sources also restore product
    validation.
  - AI-only PRs retain the cheap explicit-request check on a GitHub-hosted
    runner. Every product job depends directly on its classifier output.
  - Trusted handoff and Linear demo consumers classify the completed source run
    on GitHub-hosted runners and reserve ARC only when its product sentinel ran.
  - Main uses a GitHub-hosted, read-only checkout classifier with `--no-renames`.
    It resolves the latest successful Main run whose Native Rust sentinel
    succeeded and classifies the complete range from that validated product
    frontier. Missing or uncertain run, job, commit, or history state requires
    complete validation. It resolves a separate successful ecosystem sentinel
    frontier so minds-only success advances ecosystem evidence without
    advancing product evidence. Accumulated minds changes therefore keep
    ecosystem validation without admitting the product graph.
  - The Main classifier checkout sets `persist-credentials: false`; hosted
    classifier security contracts reject credential persistence.
  - Main statistics and failure consumers reserve ARC only for product runs or
    uncertain/failed source state.
  - Every GitHub-hosted classifier declares explicit read-only job permissions
    and remains credential-free.
  - The minds specialist workflow has no native PR path filter. Its hosted
    classifier uses the authoritative file count and supported status set. It
    admits specialist ARC only for a complete, non-renamed canonical AI-only
    minds change. Known renames use the product ecosystem suite; uncertain
    inventories fail closed to specialist validation.
  - Web research has no native PR path filter. Its API-only hosted classifier
    expands rename sources and destinations and gates every research worker;
    incomplete or unsupported inventories fail closed to research validation.
- Markdown-only Cortex changes use the repository-policy workflow.
  - The workflow runs `task loom:cortex-audit`.
  - Main pushes classify from the latest successful run whose full-policy
    sentinel succeeded. Canceled, failed, and lightweight Cortex-only runs do
    not advance that frontier; missing history or inventory fails closed.
  - The classifier is GitHub-hosted, read-only, source-aware for PR renames, and
    checks out push history without persisting credentials.
  - It skips Rust setup, BuildKit connection, preflight, and full Loom package
    verification.
  - A change limited to `repository-policy.yml` and Cortex Markdown skips the
    product PR and Main workflows.
  - Any non-Markdown Cortex file keeps the complete repository-policy path.
  - Any mixed change keeps the complete repository-policy path.
  - Any product-impacting mixed change keeps the product PR and Main workflows.
  - CI-agent changes automatically run its full npm tests and build. Workflow
    CJS sources and contracts automatically run `.github/scripts/*.test.cjs`;
    readiness requires this policy check instead of manual smoke evidence.

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
- After: Team Agent commit → Gizmo pre-push → push → Loom validate → ready.
- Before: remote Verify fails → run full local `task ci:pr` before re-push.
- After: Team Agent fix commit → Gizmo pre-push → push → re-validate.

## Application Checklist

- [ ] Team Agents format and commit without pushing; Gizmo integrates them.
- [ ] Gizmo runs `task loom:pre-push` before every push.
- [ ] Do not require `task check`, `task ci:pr`, full suites, builds, or e2e
      on the agent machine.
- [ ] A non-ready head requires a relevant focused `task remote`. Usefulness
      decides focused tasks only after the head is validation-ready.
- [ ] Gizmo triggers complete validation with Loom or `task pr:validate`.
- [ ] Complete validation dispatches hosted checks before requesting review.
- [ ] Exact-head review runs concurrently with hosted validation.
- [ ] Gizmo re-validates after every push that replaces the validated head.

## Validation

Proof is a ready PR whose hosted validation dispatched without a review wait.
Its exact-head review ran during the hosted validation window.
