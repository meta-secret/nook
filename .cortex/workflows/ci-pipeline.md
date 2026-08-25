# CI / GitHub Actions Pipeline

## Overview

System of record for how Nook validates changes in GitHub Actions. Agents must understand this split before changing workflows or e2e.

Agent worklogs and statistics live in `meta-secret/nook-workbench`, so they do
not create Nook branches, PRs, product validation, or recursive Main builds.
See [issues.md](issues.md), [agent-statistics.md](agent-statistics.md), and
[main-build-statistics.md](main-build-statistics.md).

## Workflow map

- **[`remote.yml`](../../.github/workflows/remote.yml)**
  - Trigger: Manual allowlisted task dispatch
  - Purpose: Focused command batch; no merge authorization
  - GitHub PAT: No
- **[`pr.yml`](../../.github/workflows/pr.yml)**
  - Trigger: Explicit `ci:validate` / `ci:full-e2e` label
  - Purpose: Exact-head PR gate, including Rust ecosystem jobs
  - GitHub PAT: No
- **[`repository-policy.yml`](../../.github/workflows/repository-policy.yml)**
  - Trigger: Every PR; path-filtered Main changes
  - Purpose: Source architecture plus conditional Loom verification
  - GitHub PAT: No
- **[`web-research.yml`](../../.github/workflows/web-research.yml)**
  - Trigger: Path-filtered PR/Main changes or manual dispatch
  - Purpose: Research check, build, Cloudflare deploy, and PR preview
  - GitHub PAT: No
- **[`rust-ecosystem.yml`](../../.github/workflows/rust-ecosystem.yml)**
  - Trigger: Schedule, manual, minds-only PR
  - Purpose: Specialist Rust ecosystem entry points
  - GitHub PAT: No
- **[`pr-validation-handoff.yml`](../../.github/workflows/pr-validation-handoff.yml)**
  - Trigger: Successful same-repository PR workflow
  - Purpose: Promote trusted PR artifacts
  - GitHub PAT: No
- **[`linear-ui-demo.yml`](../../.github/workflows/linear-ui-demo.yml)**
  - Trigger: Successful PR workflow / PR close
  - Purpose: Publish PR demo WebMs to Linear
  - GitHub PAT: No
- **[`main.yml`](../../.github/workflows/main.yml)**
  - Trigger: Push to `main`
  - Purpose: Product + ecosystem verify, e2e, dev deploy
  - GitHub PAT: No
- **[`main-build-stats.yml`](../../.github/workflows/main-build-stats.yml)**
  - Trigger: Completed `Main` attempt
  - Purpose: Commit Main build stats to Workbench
  - GitHub PAT: Yes (`NOOK_GITHUB_PAT`)
- **[`main-failure-handoff.yml`](../../.github/workflows/main-failure-handoff.yml)**
  - Trigger: Failed `Main` attempt
  - Purpose: Create Hive Workbench incident
  - GitHub PAT: Yes (`NOOK_GITHUB_PAT`)
- **[`hive.yml`](../../.github/workflows/hive.yml)**
  - Trigger: Hive/infra PR changes and Main pushes
  - Purpose: Hive format/Clippy/tests
  - GitHub PAT: No
- **[`release.yml`](../../.github/workflows/release.yml)**
  - Trigger: Semver tag `v*.*.*` or manual version + ref
  - Purpose: Production verify, deploy, release
  - GitHub PAT: No
- **[`rust-dependency-updates.yml`](../../.github/workflows/rust-dependency-updates.yml)**
  - Trigger: Weekly Monday 09:00 UTC + manual
  - Purpose: Audit and AI-update Rust deps
  - GitHub PAT: Yes (`NOOK_GITHUB_PAT`, `CURSOR_API_KEY`)
- **[`agent-implement.yml`](../../.github/workflows/agent-implement.yml)**
  - Trigger: Explicit issue-path or prompt dispatch
  - Purpose: Claim Workbench issue or run prompt → implement → PR
  - GitHub PAT: Yes (`NOOK_GITHUB_PAT`, `CURSOR_API_KEY`)
- **[`ci-agent-smoke.yml`](../../.github/workflows/ci-agent-smoke.yml)**
  - Trigger: Manual
  - Purpose: ci-agent unit tests and open-handle exit smoke
  - GitHub PAT: No
- **[`e2e-pr.yml`](../../.github/workflows/e2e-pr.yml)**
  - Trigger: Manual
  - Purpose: Debug e2e on a PR branch
  - GitHub PAT: Only for `sync-live`
### Workflow details

**`remote.yml`**

- One or more selected Taskfile commands on one configured ARC runner.
  Browser selections use the container scale set.
- Checkout, Docker setup, and cache connection happen once per batch.
- Selected tasks run sequentially and report individual results.
- Git-commit-scoped Zot writes (`-git-<sha>`), with Main used only while the
  exact scope is absent.
- Read-only SeaweedFS compiler-object access.
- No merge authorization.

**`pr.yml`**

- Rust domain unit tests + coverage, no-opt WASM, web/unit tests, all three web builds.
- Shared Rust ecosystem gates via `rust-ecosystem-checks.yml`.
- Those ecosystem jobs run in parallel with native Rust, WASM, and verify.
- Ordinary pushes do not start this workflow.
- Only `ci:validate` / `ci:full-e2e` label events start it.
- Changed headless UI demo specs run beside web verification when UI changes.
- Those demos retain a 90-day artifact.
- Internal harness plus isolated native Pages aliases.
- `github-pages` deployment status.
- `ci:full-e2e` additionally runs the Main-equivalent local-provider + extension browser suite.
- Keep independent long-running gates on separate ARC Pods.
- Combine jobs only when measured setup savings exceed lost parallelism.

**`repository-policy.yml`**

- Runs source architecture enforcement on every pull request.
- Classifies PR paths and runs Loom checks only when Loom, its Task wrapper,
  Cortex, or related preflight sources change.
- Runs on Main only for those Loom-relevant paths.
- Verifies Loom formatting, lint, types, tests, authored TypeScript state, and
  Loom API contracts.
- Remains separate from Main product orchestration.
  - Cortex and agent-only merges require Loom but intentionally skip product Main.
- Enforces the authored source-file limit.
- Enforces Rust unit-test colocation.

**`web-research.yml`**

- Checks and builds the isolated research package.
- Deploys path-applicable PR previews and Main updates to Cloudflare Pages.
- Records the deployment and comments the PR preview URL.

**`rust-ecosystem.yml`**

- Thin entry points outside the product PR pipeline.
- Weekly schedule and `workflow_dispatch`.
- Labeled `agentic-ai/minds/**` PRs only, because `pr.yml` ignores `agentic-ai/**`.
- Calls the same `rust-ecosystem-checks.yml` jobs as labeled product PRs and Main.
- Ordinary PR pushes do not start it.

**`pr-validation-handoff.yml`**

- Runs from trusted default-branch code.
- Receives only completed labeled validation runs because PR close is not a `PR` workflow trigger.
- Verifies the successful source run and required jobs.
- Validates native/WASM artifact shapes, attaches provenance.
- Publishes exact-input handoffs that later PRs may trust.

**`linear-ui-demo.yml`**

- Runs from the trusted default branch.
- Claims the shared `pr-<number>` concurrency group on close to cancel in-flight validation.
- Downloads the PR demo artifact.
- Publishes its 10 largest WebMs to Linear.
- Updates the PR comment and completes/cancels the matching Linear issue.

**`main.yml`**

- Calls the shared Rust ecosystem jobs in parallel with product verification.
- Includes `agentic-ai/minds/**` so product-only, minds-only, and mixed pushes use one merged-head ecosystem orchestrator.
- Classifies changed paths and skips the product job chain for minds-only pushes.
- Owns merged-head ecosystem cache seeding, statistics, and failure handoff.
- Native Rust, WASM, and browser-free web verification use the configured ARC scale set.
- Each lane serially exports its already-solved local BuildKit graph after validation.
- Local-provider web e2e, extension e2e, and headless UI demos consume verified WASM on separate runners.
- Each browser solve is read-only.
- The successful UI-demo lane publishes the warm browser-image graph.
- 90-day artifact + 10 largest recordings on the merged PR's Linear issue.
- Deploy to `dev.nokey.sh` / `*.dev.nokey.sh` after web verify, web e2e, and
  the portable WASM cache publication proof.

**`main-build-stats.yml`**

- Collects run/job/step timing and conclusions.
- Commits one `stats/main-build/**` record directly to Nook Workbench.

**`main-failure-handoff.yml`**

- Creates or refreshes one ready automated Workbench incident per failed Main revision.
- Uses run metadata and failed job names only.
- Includes browser E2E and UI-demo failures.

**`hive.yml`**

- Installs, checks, and browser-tests the Hive Control Center.
- Fork and Dependabot console changes receive the same install, check, build,
  and browser journey on a secret-free GitHub-hosted runner.
- Runs pinned Docker format/Clippy and behavior tests against Neo4j.
- Checks k0s manifests and the Taskfile command surface.
- Main alone publishes the shared Hive dependency cache.

**`release.yml`**

- Restores scoped BuildKit caches, pins an immutable tag, verify/e2e.
- Deploys `nokey.sh` plus independent `simple.nokey.sh` and `sentinel.nokey.sh` artifacts.
- Publishes GitHub Release.

**`rust-dependency-updates.yml`**

- Audits every direct dependency in each Rust root.
- The roots are `nook-app/nook-platform/`, its fuzz workspace, `agentic-ai/minds/`, and `preflight/`.
- When an update exists, an AI agent updates all outdated Rust dependencies.
- Runs the full deterministic suite and opens a PR for explicit review.

**`agent-implement.yml`**

- Requires exactly one explicit `issue_path` or `prompt`.
- Resolves and atomically claims only the requested ready agent issue.
- Requires an assigned Nook GitHub collaborator for issue mode.
- Cursor SDK implement → PR opened → owner assigned and mentioned → Workbench
  progress/worklog published → workflow exits.

**`ci-agent-smoke.yml`**

- Runs the maintained npm-based ci-agent unit suite through Task.
- Proves that `exitCiAgent` terminates open handles.

**`e2e-pr.yml`**

- Debug e2e on a PR branch (`e2e-pr` / `e2e` / `sync-live`).

```mermaid
flowchart LR
  branch[Exact pushed branch head] --> remote_yml[remote.yml focused task batch]
  PR[Ready pull request] --> label[Validation label]
  label --> pr_yml[pr.yml]
  pr_yml --> preview[Cloudflare isolated aliases]
  pr_yml --> pr_deployment[github-pages deployment status]

  merge[Squash merge to main] --> main_yml[main.yml]
  main_yml --> main_verify[Verify + build + e2e]
  main_yml --> cf_dev[Cloudflare Pages isolated dev]
  main_yml --> main_stats[Persist completed run metrics]
  main_stats --> workbench_stats[Commit metrics to Nook Workbench]
  main_yml -->|any actionable failure| main_failure[Queue Workbench incident]
  main_failure --> hive_dispatcher[Isolated Hive dispatcher]
  hive_dispatcher --> hive_worker[One end-to-end repair task]

  release[Semver tag or manual version + ref] --> release_yml[release.yml]
  release_yml --> release_verify[Verify + build + e2e]
  release_yml --> pages[GitHub Pages public site]
  release_yml --> simple_cf[Cloudflare Simple Vault]
  release_yml --> sentinel_cf[Cloudflare Sentinel Vault]

  manual_e2e[Manual PR e2e] --> e2e_live[sync-live e2e]

```

## Workflow concurrency policy

Cancellation is scoped to work that a newer run actually supersedes:

- PR validation uses `pr-<number>`: a new commit cancels the older run for that PR.
- Separate PRs continue to receive independent required checks.
- Do not replace this with a global PR group, which would cancel other contributors' required checks on push.
- Main is serialized: an active run completes to protect its cache writers, while the single pending slot coalesces bursts to the newest merged revision.

### Concurrency scopes

- **PR (`pr.yml`)**
  - Scope: PR number (`pr-<number>`)
  - Cancel active run: Yes
  - Reason: Only the newest commit on the same PR needs validation.
- **Main (`main.yml`)**
  - Scope: `main`
  - Cancel active run: No (one pending)
  - Reason: Finish active cache publication and coalesce bursts to the newest pending revision.
- **Main failure handoff (`main-failure-handoff.yml`)**
  - Scope: Failed Main head SHA
  - Cancel active run: No (one pending)
  - Reason: Serialize retries that update the same Workbench incident.
- **Main build stats (`main-build-stats.yml`)**
  - Scope: Main run ID + attempt
  - Cancel active run: No
  - Reason: Every completed attempt is immutable evidence; separate runs never supersede it.
- **Manual PR e2e (`e2e-pr.yml`)**
  - Scope: PR number + suite
  - Cancel active run: Yes
  - Reason: A repeated run of the same suite supersedes its older debug build.
- **Web research (`web-research.yml`)**
  - Scope: PR number or ref
  - Cancel active run: Yes
  - Reason: Keep only the newest build for the same preview or branch.
- **CI agent smoke (`ci-agent-smoke.yml`)**
  - Scope: Global smoke group
  - Cancel active run: Yes
  - Reason: Only the newest smoke result matters.
- **Agent implement (`agent-implement.yml`)**
  - Scope: Issue number (manual runs are unique)
  - Cancel active run: No
  - Reason: An active run may already have pushed a branch or opened a PR.
- **Production release (`release.yml`)**
  - Scope: Global production release group
  - Cancel active run: No
  - Reason: Serialize stateful publication without interrupting a deployment.
## Production release strategy

Production releases use immutable semantic-version tags. The tag records the
exact source commit; the GitHub Release records that the tagged build passed the
production gate and was deployed atomically as the public `nokey.sh` site plus
the `simple.nokey.sh` and `sentinel.nokey.sh` vault applications.

Preferred release flow:

1. Open **Actions → Release production → Run workflow** on the default branch.
2. Enter the new semantic version (`1.2.0`; a leading `v` is optional) and the
   branch, tag, or commit to release (`main` by default).
3. The requested source passes the main-equivalent production gate. For a new
   manual release, the workflow creates `v1.2.0` only after that gate succeeds;
   existing tags are verified against the requested commit and never moved.
4. The tagged source is deployed to GitHub Pages and writes its version and
   commit to `nokey.sh/release.json`.
5. Only after deployment succeeds does the workflow publish the GitHub Release.

Pushing a `v*.*.*` tag manually is also supported and enters the same validation
and deployment path. A rerun is idempotent when the version and source commit are
unchanged. If a deployment fails, keep the tag and rerun it after fixing the
workflow or infrastructure; the absence of a GitHub Release shows that the tag
has not completed production release. Rollbacks use a new patch version targeting
the last compatible commit, never a moved or reused tag.

The workflow does not rewrite Cargo or package manifest versions. The deployment
version is the immutable tag, avoiding a CI-generated source mutation that would
make the deployed artifact differ from its tagged commit.

## Provider selection (`NOOK_E2E_SYNC_PROVIDER`)

The **same sync spec files** run against different backends. CI swaps providers by setting one environment variable per job:

- **`NOOK_E2E_SYNC_PROVIDER`**
  - Supported values: `file`, `local`, `google-drive`, `github`
  - Default value: `file`

Registry and factories live in `nook-app/nook-web/nook-web-app/e2e/sync-provider.ts`:

- **`createSyncTarget()`** — isolated e2e remote (reads provider from env)
- **`connectSyncGenesisDevice()` / `connectSyncVault()`** — provider-aware connect
- **`live/sync.smoke.spec.ts`** — explicit real-provider smoke
- **`live/google-drive-shared-grant.smoke.spec.ts`** — opt-in real Drive
  shared-folder create + `permissions.create` (+ optional joiner verify);
  skips unless `NOOK_GOOGLE_E2E_ACCESS_TOKEN` and `NOOK_GOOGLE_E2E_JOINER_EMAIL`
  are set. Distinct from private `drive.appdata` sync smoke.
- **`local` is a legacy alias for `file`** in e2e; new tests should use
  `file` when they need the default local file-backed provider explicitly.

**Main and release CI (`e2e`):** default to the `file` provider. The e2e remote stores
event files in a real temp directory while Playwright serves the oauth-file HTTP
calls, so default sync tests exercise local file-backed replication without
external API quota.

**Manual (`sync-live`):** dispatch `e2e-pr.yml` with the `sync-live` suite.
The workflow defaults `NOOK_E2E_SYNC_PROVIDER` to `github`; local runs may
select another configured provider explicitly.

Live credentials per provider:

- **`github`**
  - Credential: `NOOK_GITHUB_PAT`
- **`google-drive`**
  - Credential: `NOOK_GOOGLE_E2E_ACCESS_TOKEN` (private sync smoke, when wired)

Shared-folder grant live smoke environment (issue #289; not the private sync matrix row):

- **`NOOK_GOOGLE_E2E_ACCESS_TOKEN`**
  - Purpose: Owner token with `drive.file`
- **`NOOK_GOOGLE_E2E_JOINER_EMAIL`**
  - Purpose: Email granted writer on the folder
- **`NOOK_GOOGLE_E2E_JOINER_ACCESS_TOKEN`**
  - Purpose: Optional joiner token to verify access under that folder ID

No-live-provider mode uses Playwright route handlers (`sync-stub.ts`,
`drive-stub.ts`, `file-sync-stub.ts`) — no API quota. For the default `file`
provider, those handlers read and write real event files under a temp directory.

## Runner placement

Trusted same-repository PR native Rust plus Rust ecosystem jobs and Main build
producers use the configured ARC scale set. Focused `preflight`,
`rust:ci`, and `arc:runtime` selections use the same scale set. Trusted
`hive:verify` uses the dedicated
`nook-k0s-hive` scale set with private native Neo4j and test-runtime sidecars.
Trusted browser runtime jobs use `nook-k0s-container`. ARC's Kubernetes
lifecycle hooks create a regular job Pod from the exact image built by the
general scale set. Fork and Dependabot pull requests retain GitHub-hosted
isolation. The typed placement inventory prohibits every other hosted route.
ARC scales single-use Pods instead of queueing work on one persistent Docker
host.
Main's portable WASM cache writer/proof uses the general ARC scale set.

**Zot cache policy:**

- Cold or cross-node delivery builds restore distinct private Zot BuildKit cache refs.
- Main ARC producers publish shared Zot refs after verification. Persistent
  node-local BuildKit shards accelerate repeated solves.
- Trusted PR jobs that publish registry cache write only immutable git-commit scopes
  and cannot replace Main.
- Trusted ARC PR verification reuses the persistent BuildKit shard on its node.
- Exact-SHA handoffs retain commit-scoped registry identity.
- Native ARC exports that handoff during the verified solves. A second
  post-verification solve is prohibited because it reconstructs the same Rust
  graphs before exporting them.
- A cold PR scope restores trusted Main or a dependency-fingerprint scope.
- Once an exact PR scope exists, setup imports that scope alone.
- BuildKit merges cache importers; list order is not fallback precedence.
- Exact-input handoffs own repeat-run acceleration without mutable branch refs.
- WASM consumers read the verified dependency ref instead of competing with the larger native dependency lineage.
- Main ARC prepares native dependency/source and WASM source targets as cache-only outputs.
- The verified Main ARC solve owns the WASM dependency exporter.
- Only a `push` event on `refs/heads/main` may write the shared scopes.
- Release, agent, and manual workflows are read-only unless they use an
  explicitly isolated git-commit publisher.
- Cache-publishing PR and Remote jobs write git-commit refs, use Main only while
  their exact scope is absent, and cannot replace shared Main manifests.
- Hive ARC PR jobs use the local shard and may import Main when needed. Main
  remains the only workflow writer of the shared Hive registry seed.
- The legacy registered `nook` runner is not used.

**Focused remote jobs:**

- `preflight`, `rust:ci`, and `arc:runtime` may use disposable ordinary Pods in
  the configured general ARC scale set. Trusted `hive:verify` may use the
  dedicated Hive ARC scale set. Each job reaches the persistent BuildKit shard
  on its selected node.
- `arc:runtime` proves a remote BuildKit result can be exported without a
  Docker daemon, Podman, DinD, or host socket.
- Runtime-backed selectors build a run-scoped image on the general ARC set.
  They then execute their internal daemonless task inside an ordinary Pod
  created by `nook-k0s-container` hooks.
- These selectors are `web:build`, `web:e2e`, `extension:e2e`, `check`,
  `ci:pr`, and `ci:pr:e2e`.
- Each runtime-backed selector must be dispatched alone. Mixed batches are
  rejected before repository commands execute.
- Other `remote.yml` selections use the general or Hive ARC scale set. Browser
  tasks use the container scale set.
- Common Rust test and web/extension check routes use smaller source-sealed image targets.
- Their solve graphs stop before unrelated coverage, WASM-test, browser, full-verification, and production-build stages.
- These remote-only routes preserve the exact check command while reducing preparation work.
- Complete trusted PR, Main, manual, agent, and release graphs run on ARC.

**BuildKit cache propagation:**

- Cache records imported by a named target are local to that target's solve.
- They do not propagate through a named build context into an outer source leaf.
- Importing exact and Main together can select Main's parent and orphan an exact
  source leaf, even when the exact importer is listed first.
- An exact-only importer replays the leaf across both linked and internal parents.
- Product dependency and source stages therefore live together in
  `nook-app/nook-platform/docker/rust/product.Dockerfile`.
- Product source Bake targets must not override those internal stages with
  `target:` contexts.
- Standalone dependency restore and publisher targets use the same Dockerfile.
- `nook-app/nook-platform/docker/rust/docker-bake.hcl` owns the Rust Zot
  cache scopes and the direct WASM consumer import.
- `nook-app/nook-web/docker/web.docker-bake.hcl` owns final web/e2e image
  cache scopes.
- `nook-app/nook-web/docker/toolchain.docker-bake.hcl` owns the web-deps
  cache scope.
- `preflight/docker-bake.hcl` owns the preflight Zot cache scope.
- Loadable `nook-web*` tags live in
  `nook-app/nook-web/nook-web-app/docker-bake.hcl`.
- Loadable `nook-rust*` tags live in the platform core/wasm bake files.
- `nook-app/docker-bake.hcl` stays thin: shared GHA/registry/sccache
  variables, `_sccache`, and cross-lineage prepare groups.
- Main publishes the portable WASM dependency fingerprint from its verified ARC solve.
- Repository invariants in `preflight/tests/sccache_s3.rs` and `preflight/tests/vault_app_isolation.rs` enforce the topology and proof.

**Exact-input handoffs:**

- Split native and WASM producers restore small validated handoffs by exact input hash.
- Keys cover Rust sources and manifests, toolchain and Docker definitions, Task entry points, Docker setup, and the PR workflow itself.
- PR workflows upload only same-run artifacts.
- After the entire run succeeds, default-branch-only `pr-validation-handoff.yml`:
  - verifies the source workflow and all required jobs;
  - recreates the validated base/head merge tree;
  - validates artifact shapes, adds provenance;
  - republishes immutable trusted artifacts.
- The current attempt must contain a successful consumer.
- Each producer must succeed in the current attempt when scheduled.
- A failed-job rerun that omits an already-successful producer may reuse that producer job and run-stable artifact from an earlier attempt.
- Promotion requires the immutable PR snapshot attached to the completed workflow-run event.
- There is no post-merge or manual fallback to mutable PR metadata.
- A later PR skips a producer only after resolving an exact artifact by ID and verifying that its successful workflow run used this trusted default-branch promotion workflow.
- PR-writable caches never bypass required validation.
- Repository invariant preflight still runs on every PR head.
- On a native producer miss, preflight must finish before the native application Docker solve begins.
- `Web verification` declares `needs` on the WASM build producer.
- It downloads the run-stable WASM artifact directly after that job succeeds.
- `Headless UI demo` declares `needs` on the WASM build producer.
- Required demos therefore overlap browser-free web verification.
- `Verify and preview` waits for Native Rust, web verification, and WASM Node tests.
- It also waits for the UI demo job.
- That keeps the merge-gate check red when Native fails.
- Preview deploys from a host dist handoff with pinned wrangler.
- No consumer polls GitHub for a sibling producer.
- Changed inputs must execute and complete the full workflow before a new handoff can be promoted.
- If promotion cannot prove its provenance, consumers treat the artifact as a miss and run the producers.
- The required-job budget is four to five minutes for exact handoff hits and ordinary source-changing PRs.
- Measure it from the first required job start through the last required job completion.
- Report GitHub-hosted runner queue time separately.

The web dependency stage runs `bun install --frozen-lockfile` directly in its
Dockerfile layer. It has no host or BuildKit daemon cache mount; the frozen
lockfile and immutable Docker layer are the cache and reproducibility boundary.

PR web solves normally use browser-free `web-base`. UI-changing PRs, main,
and explicitly requested browser e2e also build `web-e2e-base` with Debian's
`chromium` and `ffmpeg` packages. Playwright is pointed at `/usr/bin/chromium`,
and its revisioned recording path links to `/usr/bin/ffmpeg`; do not install
its bundled Chromium + headless-shell payload, which creates a roughly 1.3 GB
image layer (about 432 MB compressed) on cold runners.
The preparation solve runs once. The small final web-image solve retries once
after the known immediate BuildKit frontend/Dockerfile-load flake, without
repeating the multi-minute Rust/WASM and dependency graph.
The ARC S3 health probe is a separate uncached solve. It retries once only when
the Dockerfile frontend vertex itself reports a transient authorization TLS
timeout. Later build vertices and genuine S3 health failures fail closed.

### Browser validation for Main-fix PRs

PRs that fix a failure observed on `main` must carry the `ci:full-e2e` label.

- **Label effect:** Adds two `Full browser e2e shard (N/2)` jobs, the stable `Full browser e2e (main fix)` join, and `Full extension e2e (main fix)` to the PR workflow.
- **WASM artifact sharing:**
  - A dedicated producer verifies WASM once and uploads only its generated package.
  - Preview and both browser jobs download that artifact instead of recompiling Rust.
- **Parallel browser jobs:**
  - Two web shards run deterministic halves of every fully-parallel local-provider and split-app Playwright project.
  - Extension e2e runs independently in a third Kubernetes job Pod.
  - Browser commands execute directly inside the exact-source image built by
    the verified PR web job.
- **Exact-head cache policy:**
  - PR browser consumers publish only isolated exact-head cache refs.
  - Each consumer probes its exact browser ref.
  - An available exact ref is imported alone.
  - A missing exact ref falls back to the browser-image seed owned by trusted Main.
  - Neither web shard nor its join writes a low-reuse exact-head browser cache.
  - Trusted Main remains the reusable browser-image seed.
  - The UI-demo publisher consumes the exact run image without writing cache refs.
- **Readiness requirement:**
  - Adding or removing the label retriggers PR Actions for the current head.
  - A labeled PR cannot be ready while this job is queued, failing, or cancelled.
- **Extension e2e environment:**
  - Extension e2e starts an automatically selected Xvfb display.
  - It waits for readiness and prevents resets between Playwright retries.
  - It uses one Kubernetes job Pod so persistent-context smoke does not compete with headed Chromium tests.

### Runner allocation

- **`pr.yml`, `main.yml`, `release.yml`**
  - Runner: trusted jobs use general, Hive, or container ARC scale sets. Fork
    and Dependabot code alone uses GitHub-hosted isolation.
  - Purpose: Elastic delivery with persistent node-local BuildKit and private Zot recovery.
- **`repository-policy.yml`, `hive.yml`**
  - Runner: ARC for trusted sources; GitHub-hosted only for untrusted sources.
  - Purpose: Independent architecture and package verification
- **`agent-implement.yml`, `ci-agent-smoke.yml`**
  - Runner: general ARC
  - Purpose: Background implementation and bounded smoke work
- **`e2e-pr.yml`, `web-research.yml`**
  - Runner: general ARC plus container ARC for Playwright
  - Purpose: Manual and research work scales independently
## Why local-provider e2e vs sync-live

Real provider API calls are slow and brittle at CI scale. Nook therefore:

1. **`e2e` project** — IndexedDB flows plus sync-provider specs through isolated e2e remotes. One Playwright process, fully parallel, one preview server.
2. **`stable` project** — IndexedDB-only specs for fast manual/debug runs. It starts at 3 workers.
3. **`unstable` project** — local provider/sync specs. It runs separately at 2 workers so their shared preview-server and WASM pressure stays bounded.
4. **`sync-live` project** — Specs under `e2e/live/` hit the **real provider API** using `NOOK_GITHUB_PAT`. Minimal smoke; explicit manual runs only.

When adding Google Drive or other sync providers, add local e2e remote specs to
the `e2e` list and thin live smoke specs to `e2e/live/`.

## Parallelism and isolation

Do **not** set `workers` in `playwright.config.ts` — use Playwright defaults locally and override with `--workers=N` when you want more parallelism than the default. Spec files that need ordering use `test.describe.configure({ mode: 'serial' })` within the file only.

`sync-live` keeps `fullyParallel: false` because CI assigns one `NOOK_GITHUB_E2E_REPO` per container; parallel live files would share that remote. The local `stable` and `unstable` groups use `fullyParallel: true`, but run in separate invocations with 3 and 2 workers respectively.

## Rust dependency updates

[`rust-dependency-updates.yml`](../../.github/workflows/rust-dependency-updates.yml)
runs weekly and can be started manually. It installs the pinned
`cargo-outdated` orchestration tool and runs it with `--workspace
--root-deps-only` in every Rust root. Those roots are:

- `nook-app/nook-platform/`;
- `nook-app/nook-platform/fuzz/`;
- `agentic-ai/minds/`;
- `preflight/`.

The audit covers every direct library declared in those `Cargo.toml` manifests.
It does not audit only the current lockfile's transitive graph.

If any audit reports a newer release, the workflow starts the existing
isolated CI agent on the general ARC scale set. The agent updates **all** outdated direct
Rust dependencies and makes compatibility fixes. It runs the required
validation before the CI-agent harness commits, pushes, and opens the PR:

```bash
WASM_BUILD_MODE=prod task ci:pr:e2e VITE_BASE=/ VITE_VAULT_SYNC_INTERVAL_MS=1000
task docker:ecosystem:fuzz FUZZ_SECONDS=20
task hive:verify
```

`ci:pr:e2e` validates the product path:

- repository preflight;
- Rust coverage and unit tests;
- WASM checks;
- web checks, unit tests, and builds;
- the complete local-provider Playwright suite;
- extension e2e.

- The additional targets validate the separate fuzz workspace.
  - They also compile, lint, and test Hive and Lace in the Minds workspace.
- Credentialed real-provider `sync-live` e2e remains a separate manual
  validation.
  - It creates disposable external-provider state.
  - It requires provider secrets.
- No workflow merges the harness-owned PR from a check event.
  - A task-owning agent runs the standard readiness audit.
  - The agent squash-merges when readiness succeeds.

**One web server per Playwright process is enough.** CI serves static `dist/` via `vite preview`; workers share that HTTP endpoint. Isolation is at the browser layer:

- Each test gets a fresh browser context → separate IndexedDB / `localStorage`.
- Local e2e sync uses `page.route()` with a unique remote id per suite — no shared remote state.
- The Nook server is stateless; vault data never lives on the server in e2e.

Do **not** spin up multiple Nook servers for parallel e2e unless debugging port conflicts locally with `reuseExistingServer`.

## PR UI demo videos

UI demo rules:

- UI-facing changes under web apps, shared vault UI, or extension browser
  surfaces must add or update a focused
  `nook-web-app/e2e/demos/*.demo.spec.ts`.
- The PR contract rejects a UI change without a changed demo.
- Only changed demo specs run.
  - They run serially with one worker.
  - PR CI avoids the cost of the full browser suite.

**Run the contract on the host before the first push** (and after any later UI
edit) so Verify does not discover a missing demo:

```bash
git fetch origin main
.github/scripts/ui-demo-contract.sh "$(git rev-parse origin/main)"
```

Combine with unconditional `task format` — see
[pre-push-hygiene.md](../dynamic-skills/pre-push-hygiene.md).

The `ui-demo` Playwright project runs Chromium headlessly at 1280x720.
It always records WebM video.
The pull-request demo job starts beside web verification.

- The demo job starts after the WASM handoff is ready.
- Its browser-image solve is read-only.
- After Playwright succeeds, a cache-only publisher exports the warm graph to
  the isolated exact-head scope.
- Demo-only waits may hold meaningful before and after states for review.
  - Ordinary regression specs remain full-speed.
- CI retains the Actions result for 90 days.
- After successful recording, CI uploads the 10 largest WebMs to Linear's
  private file storage.
  - One deterministic `nook-ui` issue owns all recordings for a GitHub PR.
  - One idempotent comment represents each head SHA.
  - The PR comment links the Actions fallback and Linear archive.
  - Merge completes the issue; close without merge cancels it.
  - Linear publication is best-effort and cannot invalidate Playwright
    assertions or block the product gate.

- Main runs the complete UI-demo project.
  - It retains every WebM in the 90-day Actions artifact.
  - It adds only the 10 largest recordings to the associated Linear issue.
  - It leaves the issue in Done.

The trusted post-workflow and Main workflow require the repository Actions
secret `LINEAR_API_KEY`; the unmerged `pull_request` workflow never receives it
or loads secret-consuming code from the PR checkout. Never put that value in
workflow YAML, logs, comments, artifacts, or agent statistics. The local Linear
MCP OAuth connection is useful for interactive issue management but is separate
from this unattended CI credential. Use `task ui:demo` from the repository root
or `cargo ui-demo` from `nook-app/` to reproduce a recording locally.

Playwright DOM/state assertions decide pass or failure. Humans and multimodal AI
agents may review the video as supporting evidence, but visual AI review is
advisory: timing, animation, font rendering, and compression can make frame-only
judgments flaky. A future AI reviewer should consume the video plus assertion
results and traces, and must not receive real vault secrets.

## Playwright projects

Defined in `nook-app/nook-web/playwright.config.ts`:

- **`stable`**
  - Specs: IndexedDB-only specs (3 workers)
  - CI: `main.yml`, `e2e-pr.yml` (manual/debug)
- **`unstable`**
  - Specs: Local-provider and sync specs (2 workers)
  - CI: `main.yml`, `e2e-pr.yml` (manual)
- **`sync-live`**
  - Specs: `e2e/live/**/*.spec.ts`
  - CI: `e2e-pr.yml` (manual)
- **`ui-demo`**
  - Specs: `e2e/demos/**/*.demo.spec.ts` (1 worker)
  - CI: UI-changing PRs

The `test:e2e` script runs `stable` then `unstable`; `test:e2e:local` runs `stable`, and `test:e2e:sync-stub` runs both groups.

## Task commands

Product checks run remotely in containerized jobs. The mandatory local format
command reuses one content-addressed tool-only image across worktrees. The root
`Taskfile.yml` is the repo entrypoint; app commands are included through
`nook-app/Taskfile.yml`, with
cross-package app tasks in `nook-app/ci/Taskfile.yml`, Docker tasks in
`nook-app/nook-platform/docker/Taskfile.yml`, and web-family tasks in
`nook-app/nook-web/Taskfile.yml` and package Taskfiles under
`nook-web-extension/` / `nook-platform/`:

```bash
# Agent-required local action before every push
task format                         # host-applied format only

# Optional local mirrors (humans / deep debug — not agent merge gates)
task check                          # format, clippy, unit tests, wasm-bindgen tests, web build (dev/no-opt wasm)
WASM_BUILD_MODE=dev task ci:pr       # prepare → no-opt WASM → verify ‖ build (no browser e2e)
task ci:pr:e2e                       # full local-provider web e2e + extension e2e

# E2e projects
task web:test:e2e                   # full local-provider e2e (main gate; optional local debug)
task web:test:e2e:pr                # fast e2e-pr subset (manual/debug only)

# WASM tests
task wasm:test                      # wasm-bindgen smoke tests in Node (PR/main gate)
task wasm:test:browser              # browser-only wasm tests (manual/debug)

# Single spec — preferred during optional fix/debug (E2E_SPEC paths relative to nook-app/nook-web/)
E2E_SPEC=e2e/connect.spec.ts task web:test:e2e:file

# Main CI equivalent
task ci:main:e2e                    # one container, full e2e project

# Manual live GitHub (needs NOOK_GITHUB_PAT in env or .env.test.local)
task web:test:e2e:sync-live

# Legacy aliases
task web:test:e2e:github            # → sync-live
```

## Portable Rust crate coverage export

The portable Rust coverage gate runs during the `builder-debug` stage in
`nook-app/nook-platform/docker/rust/product.Dockerfile`. It covers
`nook-app-common`, `nook-authenticator-domain`, `nook-auth2`,
`nook-replication`, `nook-event-log`, `nook-companion-core`, and `nook-core`.

**Image build:**

- Source-sensitive layers are ordered by Rust dependency edge.
- Leaf and foundation crates are copied in dependency order. This includes
  `nook-app-common`, `nook-authenticator-domain`, `nook-auth2`,
  `nook-replication`, `nook-event-log`, and `nook-companion-core`. Each is
  linted and coverage-tested before `nook-core`.
- The `nook-core` coverage run uses `--no-clean`.
- The final report across all seven portable crates enforces the committed
  floor. It writes reusable artifacts to `/opt/nook/coverage/nook-core` in the
  image.

**PR CI split:**

- PR CI uses independent native Rust and WASM producers.
- Native Rust runs the portable Rust nextest/coverage branch and uploads its small coverage handoff.
- The WASM build producer runs clippy/build once and uploads the generated package under a run-stable artifact name.
- `WASM Node tests` depends on that build job and finishes the producer gate.
- `Web verification` depends on the build job and downloads the package with `actions/download-artifact`.
- It can run browser-free web validation while Node tests continue.
- It exports host dist trees for preview deploy.
- `Headless UI demo` also depends on the WASM build job.
- It runs changed demo specs in parallel with web verification.
- `Verify and preview` waits for Native Rust, web verification, and WASM Node tests.
- It also waits for the UI demo job.
- Optional web and extension e2e consumers need both WASM jobs and receive only a fully verified handoff.
- A separate `Rust coverage report` job declares `needs: rust`, downloads the native handoff directly, and performs reporting without occupying or delaying the preview runner.

**Rerun and artifact rules:**

- `needs` reuses a successful producer omitted from a failed-job-only rerun.
- Consumers download the exact-head run artifact after that producer edge is satisfied.
- Do not serialize the **PR** producers or move Rust coverage into preview: a cold Rust cache must not dominate the PR web critical path.
- Coverage reporting must depend on the native producer instead of starting from the preview job.

**Main serialization:**

- Main serializes native, WASM, and web producer lanes so they advance one
  verified default-branch lineage.
- ARC jobs reuse the persistent BuildKit content store on their selected node.
- Verified Main ARC jobs publish portable source, tool, and WASM dependency refs.
- Zot exports provide cold-node recovery.
- `task docker:extract:coverage` remains a copy-only path that invokes neither BuildKit nor Rust tests.
- It also serves workflows that already have a sealed `nook-web:local` image, including main's commit-keyed coverage artifact.
- `task setup` gets those files into the slim web image through the same temporary host artifact directory as generated WASM.
- It does not copy them directly from the multi-GB Rust builder snapshot.

**Main artifact handoff:**

- After Main's native lane succeeds, `main.yml` uploads those four files plus a manifest as `nook-core-auth-coverage-<commit SHA>`.
- PR lookup trusts that commit-keyed artifact as soon as it exists, even while later Main jobs are still running or after an unrelated later job fails.
- It authenticates the workflow, push event, default branch, and exact SHA before use.
- A PR with changed Rust coverage inputs downloads and validates that artifact instead of rebuilding the base app image.
- If the artifact is missing or invalid, the report reuses the floor-validated current coverage as its comparison and emits a warning.
- It never launches a second cold Docker coverage build.
- PRs without Rust/Cargo/source changes — including changes only to coverage reporting plumbing — also reuse current coverage because the measured source is unchanged.

**Coverage input detection:**

- Compares the merge-base diff between the pull request event's explicit base and head SHAs.
- Must not compare the base to the checked-out synthetic merge; Main can advance after the event snapshot.
- Must not use a two-dot snapshot diff; a behind-base branch would then count Main-only changes as pull request changes.

## Agent host vs GitHub-hosted execution

**Trusted delivery CI uses isolated ARC with persistent BuildKit layers.**

- Trusted same-repository PR native Rust plus Rust ecosystem jobs and Main build
  producers run in disposable ARC Pods.
- Fork and Dependabot pull requests run on fresh `ubuntu-latest` VMs. Trusted
  container workloads use the dedicated `nook-k0s-container` scale set.
- On ARC, the shared setup creates a `remote` Buildx builder connected to the
  persistent rootless BuildKit shard on the selected node.
- Browser runtime jobs use a two-stage Kubernetes path. `nook-k0s` builds and
  pushes the exact-source image. ARC lifecycle hooks then create an ordinary
  job Pod from that immutable run tag on `nook-k0s-container`.
- Main's portable WASM cache writer uses the verified ARC solve. Static
  contracts require the release, clippy, and test dependency vertices in its
  exact Dockerfile lineage. Zot then proves child manifest digest/size plus
  every declared blob's size and SHA-256 by streaming it completely. The
  separate Bake+Zot simulation proves clean-builder import behavior. Main does
  not create an ephemeral BuildKit daemon merely to repeat that simulation.
- Cold nodes restore separate Zot scopes for stable and source-sensitive
  Rust/WASM layers, web dependencies, browser-free web, and e2e web. ARC jobs
  reuse their node-local persistent BuildKit shard.
- Neither placement uses GitHub Actions cache storage for BuildKit layers.
- PR CI assigns native Rust to one runner and WASM to another.
- The small generated WASM package feeds parallel browser-free preview validation as soon as clippy/build finishes.
- Required Node tests continue on the producer; preview deployment is blocked until that producer succeeds.
- Optional browser-e2e consumers wait for the fully verified producer.
- Native Rust separately uploads the coverage handoff consumed by the small Rust-dependent reporting job.
- The preview job never waits for native coverage.
- It runs without browser e2e. Trusted sources deploy Cloudflare previews and
  record a successful `github-pages` deployment status for the PR head SHA.
- Fork and Dependabot validation remains secret-free. It succeeds without a UI
  demo when the UI demo contract is not required, and it never attempts a
  credentialed preview deployment.
- A `ci:full-e2e` PR also runs the parallel artifact-backed web and extension browser jobs.
- The preview deploy reuses that prepared sealed image and must not declare another `setup` dependency.
- PR coverage always checks the current portable Rust artifact against the floor.
- Changed Rust/Cargo/source inputs reuse the exact base commit's trusted Main artifact when available.
- Missing or unchanged base coverage reuses the current artifact for comparison without another Docker solve.
- Use remote CI as the **sole PR product validation gate**.

**Agent remote commands:**

- Agents use `task remote TASK_NAME=<name>` for one focused command.
- Agents use `task remote TASK_NAMES=<a>,<b>` to reuse one job for a batch.
- When the branch is ready, agents run `task pr:validate PR=<number>` or add
  `FULL_E2E=1`.
- Validation dispatches repository-owned checks immediately.
- It then requests one idempotent exact-head Cloud review.
- The request prefers Codex and falls back to Cursor Bugbot when Codex reports
  a usage limit.
- Review-request failure does not block those checks.
- They wait only for applicable repository-owned exact-head PR checks.
- Ordinary pushes do not start `pr.yml`.
- Every later push requires another explicit validation before readiness.
- Every actionable comment already present must be addressed and resolved.
- The GitHub Actions runtime is the Cloud review window.
- If no review feedback exists when checks finish, agents proceed without waiting.
- Claude, CodeRabbit, and other optional services are not requested or
  awaited. Cursor Bugbot is requested only when Codex reports a usage limit.
- The local ci-agent image tag is derived from the worktree path, preventing parallel worktrees from replacing each other's review/readiness binaries.

**Ephemeral but cache-aware delivery jobs:**

- Trusted same-repository PR jobs, Main, releases, and manual jobs use ARC.
- Main verifies each lane and publishes portable source, tool, and WASM dependency refs.
- Cold ARC nodes use the same portable Zot contract.
- Empty `cache-from=` and `cache-to=` overrides are prohibited across Taskfiles and scripts.
- Protected default-branch Zot refs remain available to every node and hosted
  job. ARC jobs reuse a warm local shard before registry transfer.
- Same-repository PR jobs authenticate with the Remote registry identity; Zot ACLs deny that identity write access to `nook/buildcache/**`.
- PR Bake exporters write only git-commit refs under `nook/remote-buildcache/**`.
- Docker setup probes each full-graph exact ref separately.
- Existing exact refs are imported alone. Missing refs use dependency
  fingerprints and trusted Main.
- Fork pull requests receive no registry credentials.
- Native coverage and WASM source-sensitive layers have separate Zot refs in addition to the manifest-only dependency refs, so non-Rust pushes do not repeat unchanged Cargo compilation.

**SeaweedFS sccache:**

- Trusted Main Rust/WASM producers and explicitly dispatched same-repository Remote tasks use authenticated SeaweedFS S3 `sccache`.
- Compiler vertices receive the bucket-scoped build identity only through stable optional BuildKit secret IDs.
- Secret contents do not participate in Docker cache checksums, so secret-free solves can still restore Main's exported vertices.
- Same-repository PR Rust producers and Rust ecosystem Docker jobs mount SeaweedFS `sccache` with the Main build identity (matching Hive).
- Release, browser-only, and arbitrary-ref workflows do not receive those credentials.
- Fork pull requests also stay secret-free.
- SeaweedFS remains an optimization and never a correctness input.
- Each workflow run and retry loads its sealed web and e2e results under run-scoped Docker image tags; concurrent jobs must never replace one another's runtime image between build and deploy.
- `task sccache:ensure` fails closed when credential files are missing or SeaweedFS is unhealthy, so a local misconfiguration cannot silently cold-compile.
- Secret-free fork jobs set `SCCACHE_OPTIONAL=1` through `nook-cache-connect`; the wrapper then bypasses sccache without replacing cargo-chef or changing build correctness.

**Hive workflow cache:**

- Manual e2e, research, and AI-agent jobs use isolated ARC Pods and may restore the same scoped BuildKit layers.
- The path-filtered Hive workflow uses its own `nook-hive-linux-amd64-v2` scope.
- Its pinned cargo-chef planner/recipe/cook stages match the `nook-app` strategy, then warm real-lock test and Clippy profiles in independent BuildKit stages before authored sources are copied.
- The stages execute in parallel, so Cargo metadata and linking for the two verification graphs do not form one serial critical path.
- Each parallel Cargo branch is capped at two jobs, matching the shared
  four-CPU Hive BuildKit envelope. BuildKit requests 4 GiB and may burst to
  6 GiB for compiler and linker peaks.
- Pull requests restore Main's scope read-only and may publish only a
  quarantined exact-head cache. Only Main exports both shared graphs, in a
  final step after check and behavior tests pass.
- Hive check and test tasks use the same job-scoped Buildx builder, so the behavior image reuses the dependency graph produced earlier in the run without allowing parallel PRs or failed validation to replace the trusted cache.
- Unlike the product delivery graph, trusted same-repository Hive runs also mount `NOOK_SCCACHE_ACCESS_KEY` / `NOOK_SCCACHE_SECRET_KEY` into compiler steps and use SeaweedFS S3 `sccache` with the isolated `nook-hive` key prefix.
- GitHub withholds those secrets from forked pull requests, and the shared wrapper then falls back to direct compilation.
- The credentials are BuildKit secrets or read-only runtime mounts, never image content.

**Deploy and release:**

- Main deploys `dist/site`, Simple, and Sentinel independently to `dev.nokey.sh`,
  `simple.dev.nokey.sh`, and `sentinel.dev.nokey.sh` from the verified handoff.
- Deployment uses pinned host-native Wrangler with Node. It does not require a
  Docker runtime or a second image solve.
- The combined `dist` tree is reserved for the internal PR/local/e2e harness; `/site/`, `/simple/`, and `/sentinel/` are not routes on the public development landing origin.
- `release.yml` runs the main-equivalent gate, deploys an immutable semantic-version tag to GitHub Pages for the public `nokey.sh` site and to independent Cloudflare Pages projects for Simple and Sentinel, then verifies app identity, security headers, exact commit, and extension-route presence/absence before publishing the GitHub Release.

**Zot registry policy:**

- Delivery BuildKit caches use authenticated `type=registry` refs on `registry.dev.nokey.sh` (Zot behind Traefik HTTPS + htpasswd), not GitHub Actions cache storage.
- Local Task Bake restores git-commit remote-buildcache scopes when remote registry credentials exist.
- Explicit local build tasks may upload source-free Rust/WASM dependency stages
  to unique candidate tags. The shared formatter never reads or writes those
  caches.
- The Main-defined allowlisted Remote workflow completely downloads each
  candidate.
- It uploads and downloads a hosted-normalized tag before atomically assigning
  the stable content-fingerprint tag in the same OCI repository.
- PR jobs import only the verified stable tag, never a local candidate.
- The sealed web source stage changes the parent of `COPY . .` for every commit.
  A Main final-image cache therefore cannot substitute a stale source snapshot.
- Main and release jobs import neither candidate nor stable formatter tags.
- Hosted promotion independently fingerprints the exact committed source SHA.
- Agents still run build, test, proof, and validation tasks remotely. Local
  execution remains available only for explicit rare-case debugging.
- Commit-scoped local publish requires a clean worktree. Dirty builds remain
  local and cannot poison the committed PR scope.
- The formatter dependency candidate is the exception because its targets
  contain no authored source.
- It still skips upload whenever the Dockerfile, Bake graph, publisher,
  promotion workflow, or guard is dirty.
- A failed candidate upload or hosted validation leaves the prior stable tag
  unchanged and PR jobs fall back to Main.
- Opt out with `NOOK_REGISTRY_CACHE=0`.
- Cache restoration is an optimization: an unavailable cache falls back to a correct cold build.
- Main ARC producers publish shared Zot cache manifests after lane verification.
- Explicit Remote tasks import a present git-commit ref alone.
- If that scope is absent, they seed it from source-free dependencies and Main.
- They export only Remote refs.
- The Remote credential can update only `nook/remote-buildcache/**`. It has read-only access to Zot's public mirror repositories, including Main's `nook/buildcache/**` path and mirrored tool images used to bootstrap hosted BuildKit.
- Same-repository Remote tasks use that registry identity for git-commit
  exporters under `nook/remote-buildcache/**`.
- General ARC pull requests remain registry-read-only and reuse Main plus
  SeaweedFS sccache. Hive keeps its small minimal exact-SHA handoff.
- Release and label-gated browser e2e jobs remain BuildKit-read-only.
- Fork pull requests do not receive credentials.
- Hive images also publish and pull through Zot.
- There is no host `:5000` listener and no `kubectl port-forward` for the registry.

**Main deploy verification:**

- `main.yml` attaches and upserts the three custom domains.
- It points the landing and both vault domains at their projects' `development` branch aliases so the main-channel build cannot replace a production deployment.
- It verifies landing-only routing, app identity markers, security headers, and the Simple/Sentinel extension boundary.
- It records one `development` deployment whose primary URL is `https://dev.nokey.sh/` and whose payload contains all three origins.
- Before live probes, the workflow purges the affected URLs so a cached fallback cannot survive a deployment switch.
- Extension metadata, ZIP, and checksum verification adds an attempt-specific exact-commit query to every mutable artifact URL and retries convergence on PR, main, and release.
- This prevents a fresh metadata response from being paired with an older edge-cached archive that reused the same channel filename.

## CI operator and agent operations
[CI Operator and Agent Operations](ci-operations.md) owns cleanup, logs,
secrets, providers, automation agents, and the remote-only execution rules.
