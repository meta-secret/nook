# Feature Compilation and Dev Promotion

## Status and authority

### Supersession

This is the approved delivery contract for concurrent feature development.
It supersedes feature-stage full validation, direct feature publication to dev,
and squash delivery to main. Runtime owners implement the command contracts
below as part of the feature. Delivery requires their integrated implementation;
this Cortex document alone does not establish command availability.

Missing capability blocks the affected stage. Do not substitute tests or full
slow validation for feature compilation.

### Slow-stage boundary

The existing `.github/workflows/pr.yml` supplies the slow checks. In this
architecture, only the dev manager's dev-to-main cycle uses that workflow.
Routing, captured-SHA checkouts, and concurrency still require runtime alignment.

### Primary model

The [multiagent delivery visual model](multiagent-delivery-diagrams.md) is the
mandatory first read and primary end-to-end explanation. Its diagrams define
stage ownership, component communication, feedback loops, and exact-SHA
handoffs. Read it completely before selecting a stage in this detailed
contract. This document supplies the authorization, evidence, and failure rules
behind that architecture.

## Hierarchy and stage ownership

Gizmo Prime is the mission/root coordinator. Every team has a Team Gizmo that
reports upward to Prime, receives high-level packets, decomposes only its
team's mechanics, dispatches internal Team Agents through the active harness,
and returns consolidated exact-SHA evidence or blockers. A Team Gizmo is not a
second Prime and never decides functional ownership, readiness, promotion, or
final delivery.

Delivery Pipeline is the operational team for CI, pull-request lifecycle, dev
publication, workflow execution, local landing, evidence, and guarded
promotion. Delivery Pipeline Team Gizmo owns Level 1 delivery-pipeline
orchestration and commit handoffs. Gizmo Prime authorizes the canonical feature
branch name; its packet authorizes PR Lifecycle to re-fetch and resolve the
latest committed head, push that branch, and invoke the remote build-only task.
PR Lifecycle also
performs packetized external GitHub, PR, check, review, status, and bounded dev
mechanics. Neither creates or updates pull requests or replaces the active
harness.

Feature Gizmos remain feature owners. The Dev Manager remains the policy owner
for dev snapshots, dev validation, readiness, promotion, and manager-only
`dev:pr-manager`.

## Runtime command contracts

- **`build:compile`**
  - Repeatable remote build-only execution for the latest committed head of the
    canonical feature branch.
  - Gizmo Prime authorizes the canonical feature branch name in the remote-task
    packet. Delivery Pipeline Team Gizmo forwards that packet unchanged to PR
    Lifecycle Agent, which re-fetches the branch, resolves its latest head,
    pushes the branch, and performs the bounded dispatch.
  - PR Lifecycle Agent must not push a temporary leaf branch or dispatch while
    checked out on one.
  - Feature bootstrap evidence must carry `originMainSha` and
    `pinnedLocalDevSha`. Require `originMainSha` to be an ancestor of
    `pinnedLocalDevSha`.
  - After mandatory `git fetch --prune origin`, synchronize canonical local
    `main` to fetched `origin/main`, then synchronize canonical local `dev` to
    include that main baseline. If either synchronization cannot be proved,
    fail closed.
  - Only after synchronization, resolve the latest committed
    `refs/heads/dev^{commit}`. Record that exact commit as `pinnedLocalDevSha`
    for bootstrap evidence. Every new feature mission, feature branch, and
    worktree must use that exact latest committed canonical local `dev` commit
    as its base.
  - A previously pinned or otherwise older local-dev SHA, `origin/dev`,
    `origin/main`, or another alternate base is invalid. If the recorded
    `pinnedLocalDevSha` does not equal post-synchronization `refs/heads/dev`,
    fail closed. Preserve the base after feature creation.
  - The canonical branch name remains the later-stage workflow authority.
    Observed SHAs are evidence only. Resolve the latest committed
    feature-branch head before each stage. A branch advance follows the latest
    head and reruns affected evidence; it is not a stale-authority failure.
  - Missing or unprovable branch/bootstrap evidence fails closed.
  - No tests, coverage, e2e, or preflight may execute transitively.
- **`dev:land`**
  - Serialized feature fast-forward into local `dev`, accepting only the
    canonical feature branch as public input.
  - Gizmo Prime authorizes Delivery Pipeline Team Gizmo's packet; PR Lifecycle
    Agent performs the bounded invocation.
  - Verify positive remote build evidence for the current canonical branch head
    by default. A local proof may replace that remote proof only for one
    explicitly authorized landing operation when Gizmo Prime records the exact
    source SHA, allowlisted Task target, proof artifact digest, and
    `gizmo-prime-one-off-local-build` authority in the packet. The short-lived
    artifact must independently prove a successful exit and freshness. Merely
    setting a local-proof path or using the generator's `one-off-local` marker
    grants no landing authority.
  - At the merge boundary, fetch and prune origin, resolve current
    `origin/main`, local `main`, and local `dev`, and discover a unique existing
    checked-out `dev` worktree from canonical Git metadata when present. A
    checked-out worktree uses clean `merge --ff-only`; an un-checked-out or
    absent local ref uses compare-and-swap `update-ref`. Require the necessary
    main/dev/feature ancestry and preserve prior dev commits; never force,
    squash, or create an empty merge.
  - Do not publish dev.
- **`dev:publish`**
  - Publish the current committed local dev head directly to origin/dev and
    record that exact commit SHA for validation.
  - Only the Dev Manager authorizes the Delivery Pipeline packet to PR Lifecycle
    Agent.
  - Preserve any newer local dev commits. The recorded published SHA is
    immutable validation evidence; it does not freeze or replace the local dev
    branch.
- **`dev:pr-manager`**
  - Create or update the single dev-to-main pull request from the exact
    published origin/dev SHA.
  - Only the dev manager invokes this manager operation. Feature Gizmos and
    Team Agents never invoke it or create PRs.
  - The workflow packet must name controller `dev-manager` and carry the exact
    published SHA; the manager compares that SHA with freshly fetched
    `origin/dev` before any PR mutation.
- **`dev:promote`**
  - Guarded ordinary fast-forward publication of the tested dev SHA to main.
  - Move main directly to that unchanged, fully validated commit; promotion
    evidence must name its exact commit SHA.
  - Only the Dev Manager authorizes the Delivery Pipeline packet to PR Lifecycle
    Agent.
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
  - Have Gizmo Prime authorize the canonical feature branch name.
  - Have Delivery Pipeline Team Gizmo route the packet to PR Lifecycle, which
    re-fetches and resolves the latest committed head, pushes the branch, and
    repeatedly invokes the remote build-only task.
  - Record the observed branch head with compilation evidence. If the branch
    advances, follow the latest head and rerun affected evidence.
  - The task builds and checks type compilation without running tests,
    coverage, e2e, or preflight, including transitively through Docker stages.
  - Fast agents review code and route corrections through the owning team.
  - A completed feature has passing compilation for its current branch head and
    resolved required review and security findings.
- **Local integration**
  - Gizmo Prime authorizes Delivery Pipeline Team Gizmo to route bounded local
    integration to PR Lifecycle Agent for local dev.
  - The task verifies positive GitHub compilation evidence for the current
    canonical branch head unless the current Gizmo Prime packet carries the
    fully bound one-off local-build authorization defined by `dev:land` above.
    That exception is per-operation, auditable, and never inferred or reused.
  - Serialize all mutations of the shared local dev checkout and index.
  - Task tooling owns the integration exclusion across concurrent Gizmos.
  - Record the observed feature commit and resulting local dev SHA.
  - Feature completion ends at this local integration handoff.
  - Keep dev permanent and preserve every previously integrated feature.
- **Slow stage ownership**
  - A manually started [dev manager](../../teams/delivery-pipeline/dev-manager/AGENTS.md) is the
    sole publisher of local dev to `origin/dev`.
  - The manager selects each snapshot and authorizes Delivery Pipeline Team
    Gizmo to route PR Lifecycle Agent's snapshot publication.
  - The dev manager owns one open `dev` to `main` PR per validation cycle;
    `dev:pr-manager` creates or updates it. Delivery Pipeline Team Gizmo routes
    the manager packet to PR Lifecycle Agent, which observes and reports the
    resulting state but does not create or update the PR.
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

1. Select a committed local dev snapshot and authorize Delivery Pipeline Team
   Gizmo to route PR Lifecycle Agent's snapshot publication.
   - Publish by ordinary fast-forward push to `origin/dev`.
   - Stop on an unexpected remote advance or ancestry mismatch.
2. Invoke manager-only `dev:pr-manager` to create or update the dev-to-main PR,
   then run the full slow checks.
   - Freeze the published SHA until this attempt has an outcome.
   - Keep review and security verdicts bound to that SHA.
3. On failure, delegate the repair to a feature Gizmo.
   - Wait for the validation wave to reach terminal state before starting repair.
   - Require PR Lifecycle's terminal evidence to list every failed or cancelled
     required GitHub Actions job, with its diagnostics and captured source SHA.
     A first-failure-only report is incomplete.
   - Forward the complete inventory to Gizmo Prime. Prime groups diagnostics by
     owning team and coherent competence area.
   - Prime dispatches affected Team Gizmos in parallel through the active
     harness. Each Team Gizmo gives one Team Agent the consolidated list for its
     area. Use multiple agents only for genuinely distinct, disjoint areas.
   - Each Team Agent fixes all known test, compiler, and static-analysis errors
     in its area in one iteration and commits the complete result.
   - Team Gizmos integrate their committed area results and report one cluster
     or blocker to Prime.
   - Prime integrates all team clusters into local dev through the normal
     branch-authoritative Levels 1 through 4 path.
   - Do not push or rerun validation after an individual fix or before the
     complete repair wave is integrated.
   - After integration, publish one new snapshot and rerun full validation once
     through Dev Manager -> Delivery Pipeline Team Gizmo -> PR Lifecycle Agent.
   - If that new terminal wave fails, collect its complete job inventory before
     opening another repair wave.
4. On success, authorize fast-forward promotion for the tested SHA.
   - Require all slow checks and required review/security verdicts to pass.
   - An older success does not validate a newer local or remote dev SHA.
5. Record the observed promotion result and any remaining local dev changes.

## Fast-forward promotion procedure

1. Capture the successful dev commit SHA and its complete validation evidence.
2. Re-read remote main, remote dev, and the PR identity.
   - Remote dev must still equal the tested SHA.
   - Remote main must be an ancestor of the tested SHA.
   - If main is not an ancestor, reconcile it into local dev through the normal
     feature path, publish a fresh snapshot, and repeat full validation.
3. Authorize Delivery Pipeline Team Gizmo to route PR Lifecycle Agent's
   guarded fast-forward promotion to push the tested SHA to main.
   - Move remote main directly to the exact validated dev commit object; remote
     main must acquire that same SHA without manufacturing a commit from its
     tree.
   - This is an actual fast-forward ref move preserving the tested commit SHA.
   - It preserves the complete graph, including existing feature merge commits.
   - It does not promise a linear commit graph.
   - Do not create a synthetic replacement commit (snapshot, merge, or
     tree-equivalent).
   - Protection rejection stops promotion visibly.
   - A concurrent main change requires fresh ancestry and evidence review.
4. Verify that remote main equals that exact validated commit SHA.
5. Have PR Lifecycle Agent verify the remote PR status through Delivery
   Pipeline Team Gizmo.
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
  - Implement the manager-only `dev:pr-manager` command for the single
    dev-to-main PR.
  - Implement guarded fast-forward promotion with ordinary pushes and evidence checks.
  - Verify protection rules permit the authorized fast-forward publication.
  - The manually run manager may use the already authorized ADMIN identity
    through the guarded exact-SHA tasks and Delivery Pipeline packets.
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
