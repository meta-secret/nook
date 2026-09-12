# Feature Compilation and Dev Promotion

## Status and authority

This is the approved delivery contract for concurrent feature development.
It supersedes feature-stage full validation, direct feature publication to dev,
and squash delivery to main. Runtime owners implement the command contracts
below as part of the feature. Delivery requires their integrated implementation;
this Cortex document alone does not establish command availability.

Missing capability blocks the affected stage. Do not substitute tests or full
slow validation for feature compilation.

The existing `.github/workflows/pr.yml` supplies the slow checks. In this
architecture, only the dev manager's dev-to-main cycle uses that workflow.
Routing, captured-SHA checkouts, and concurrency still require runtime alignment.

## Runtime command contracts

- **`build:compile`**
  - Repeatable remote build-only execution for the pushed feature SHA.
  - Gizmo authorizes PR Steward's remote dispatch.
  - No tests, coverage, e2e, or preflight may execute transitively.
- **`dev:land`**
  - Serialized feature merge into the shared local dev checkout.
  - Gizmo authorizes Steward's bounded invocation.
  - Verify positive remote build evidence for the exact feature SHA.
  - Do not publish dev.
- **`dev:publish`**
  - Publish the manually selected local dev snapshot to origin/dev.
  - Only the dev manager authorizes Steward's invocation.
  - Preserve newer local dev commits and freeze the published SHA for validation.
- **`dev:promote`**
  - Guarded ordinary fast-forward publication of the tested dev SHA to main.
  - Only the dev manager authorizes Steward's invocation.
  - Require full slow PR checks, review/security verdicts, and main ancestry.
  - Verify remote main equality and actual PR state without manually closing it.

## Required actions

- **Feature ownership**
  - Each concurrent feature has its own Gizmo, feature branch, and worktree.
  - Gizmo Prime means the delivery owner of that feature, not a global writer.
  - Each Gizmo issues isolated Team Agent children from its committed frontier.
  - Preserve scoped commits, functional ownership, and dependency ordering.
  - Author meaningful Rust behavior tests and targeted web flow tests.
  - Type safety never replaces test authoring, security acceptance, or review.
- **Fast feature stage**
  - Permit only scoped local rustfmt and bounded inexpensive TS diagnostics or
    formatting as implementation feedback.
  - Push the feature branch and repeatedly request remote build-only execution.
  - Bind compilation evidence to the pushed feature SHA.
  - The task builds and checks type compilation without running tests,
    coverage, e2e, or preflight, including transitively through Docker stages.
  - Fast agents review code and route corrections through the owning team.
  - A completed feature has passing compilation for its final SHA and resolved
    required review and security findings.
- **Local integration**
  - Gizmo authorizes PR Steward to invoke bounded local integration for local dev.
  - The task verifies positive GitHub compilation evidence for the feature SHA.
  - Serialize all mutations of the shared local dev checkout and index.
  - Task tooling owns the integration exclusion across concurrent Gizmos.
  - Record the feature SHA and resulting local dev SHA.
  - Feature completion ends at this local integration handoff.
  - Keep dev permanent and preserve every previously integrated feature.
- **Slow stage ownership**
  - A manually started [dev manager](../../teams/dev-manager/AGENTS.md) is the
    sole publisher of local dev to `origin/dev`.
  - The manager selects each snapshot and authorizes Steward's snapshot publication.
  - PR Steward maintains one open `dev` to `main` PR per validation cycle.
  - After a merged cycle, create the next PR for a later published snapshot.
  - A merged PR is never reused. The dev branch itself remains permanent.
  - Run the full existing slow PR checks, including authored tests, coverage,
    preflight, and applicable browser checks.
  - Preserve existing e2e opt-ins and security-required focused e2e.
  - Do not silently enable every costly optional suite for every dev snapshot.
  - Freeze remote dev while that SHA is checked and promoted.
  - Local dev may continue accepting features during remote validation.
- **Validation execution**
  - Serialize dev PR validation with native GitHub concurrency.
  - Use `cancel-in-progress: false` and the default single pending slot.
  - Retain one active run and the latest pending request.
  - Explicitly check out the captured source SHA in every job.
  - PR jobs use the captured dev head SHA, not the synthetic PR merge ref.
  - Slow checks run solely through the dev PR validation path.
  - Do not add an automatic dev-push validation pipeline.
  - Pass that same immutable SHA through reusable jobs and artifact handoffs.
  - Record run, attempt, source SHA, and result as evidence.
  - Run the complete slow suite for every selected snapshot.
  - A latest-push path diff cannot cover changes from coalesced earlier pushes.

## Prohibited actions

- **Feature stage**
  - Do not run local tests, including focused Loom tests.
  - Do not run local product compilation, Docker work, coverage, or preflight.
  - Do not run remote tests, coverage, e2e, or preflight at the feature stage.
  - Do not treat existing `rust:ci`, `web:verify`, or `loom:verify` as build-only.
  - Feature Gizmos must not push dev or main.
  - Do not require full tests to pass before landing a completed feature locally.
- **Shared state**
  - Do not mutate the shared dev checkout outside serialized local integration work.
  - Do not let publication or promotion reset local dev to the tested snapshot.
  - Do not force-push any delivery branch.
  - Do not rebase or squash in the new agent delivery flow.
  - Ordinary feature integration merge commits are allowed.
  - Do not create a daemon, custom scheduler, polling loop, or automation.
  - Do not use `queue: max` or cancel validation already in progress.
  - Do not reduce dev checks using per-push path filters.
- **Promotion**
  - Do not create release branches or snapshot PRs.
  - Do not squash, rebase, or create a promotion merge commit.
  - Do not use a stock GitHub PR merge method as a fast-forward substitute.
  - Do not close a PR manually and report it as merged.
  - Do not use unauthorized protection bypasses or fabricate validation.
  - The authorized ADMIN publication path still requires every slow-stage gate.

## Manager validation and repair procedure

1. Select a committed local dev snapshot and authorize Steward's snapshot publication.
   - Publish by ordinary fast-forward push to `origin/dev`.
   - Stop on an unexpected remote advance or ancestry mismatch.
2. Have PR Steward update the dev-to-main PR and run the full slow checks.
   - Freeze the published SHA until this attempt has an outcome.
   - Keep review and security verdicts bound to that SHA.
3. On failure, delegate the repair to a feature Gizmo.
   - The repair follows the same feature compilation and local integration path.
   - Local dev can accumulate the repair alongside other complete features.
   - Select and publish a new snapshot only after the prior attempt finishes.
   - Repeat full validation for the newly published SHA.
4. On success, authorize fast-forward promotion for the tested SHA.
   - Require all slow checks and required review/security verdicts to pass.
   - An older success does not validate a newer local or remote dev SHA.
5. Record the observed promotion result and any remaining local dev changes.

## Fast-forward promotion procedure

1. Capture the successful dev SHA and its complete validation evidence.
2. Re-read remote main, remote dev, and the PR identity.
   - Remote dev must still equal the tested SHA.
   - Remote main must be an ancestor of the tested SHA.
   - If main is not an ancestor, reconcile it into local dev through the normal
     feature path, publish a fresh snapshot, and repeat full validation.
3. Authorize Steward's guarded fast-forward promotion to push the tested SHA to main.
   - This is an actual fast-forward ref move preserving the tested commit SHA.
   - It preserves the complete graph, including existing feature merge commits.
   - It does not promise a linear commit graph.
   - Protection rejection stops promotion visibly.
   - A concurrent main change requires fresh ancestry and evidence review.
4. Verify remote main equals the tested SHA.
5. Have PR Steward verify the remote PR status.
   - Report an unmerged or unavailable PR status as a distinct incomplete result.
   - Never emulate GitHub's merged status with a manual close.
6. Preserve local dev, even when it is ahead of the promoted SHA.

## Runtime dependencies and acceptance

- **SRE task implementation**
  - Provide a genuinely isolated remote build-only execution execution graph.
  - Existing remote selectors include testing and are not substitutes.
  - Wire complete dev PR validation, native concurrency, and captured checkouts.
  - Keep main push routing separate from the dev PR slow-stage contract.
- **Integration and publication tooling**
  - Implement serialized local integration and manager-only snapshot publication.
  - Implement guarded fast-forward promotion with ordinary pushes and evidence checks.
  - Verify protection rules permit the authorized fast-forward publication.
  - The manually run manager may use the already authorized ADMIN identity
    through the guarded exact-SHA tasks and Steward packets.
  - Its existing repository bypass does not authorize skipping required checks.
  - Do not introduce a broad automatic administrator fallback.
  - Disable squash and rebase PR methods and branch deletion in repository policy.
  - Preserve protection against non-fast-forward updates.
  - Existing history includes merge commits. Promotion preserves that graph.
  - A dedicated GitHub App is optional future credential hardening.
  - Role authorization is policy-enforced, not credential isolation.
  - If the authorized identity is still rejected, report the protection failure.
  - Verify actual GitHub PR state after the ref move.
- **AI and policy implementation**
  - Align Loom admission, readiness, prompts, and Workbench contracts with these
    roles and stages.
  - Preserve child-worktree ownership assertions in
    `preflight/tests/workbench.rs` around `agents_mutate_only_their_owned_feature_and_issue_set`.
  - Replace obsolete passive-Gizmo and main-based sequential-only assertions.
  - Update old squash, local pre-push, and feature full-validation contracts.
  - Run behavior-focused runtime tests only in the authorized slow stage.
