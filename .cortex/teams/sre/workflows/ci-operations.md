# CI Operator and Agent Operations

## Agent delivery applicability

Follow the [dev delivery contract](../../../gizmo-prime/architecture/dev-delivery.md) for
feature compilation and the manually run dev manager's slow PR cycle.
Runtime workflow details below document current CI operations; they do not
grant permission to run local tests or restore superseded delivery stages.

## Overview

This authority owns CI storage reclamation, application-log inspection, secrets,
and provider operations. The core workflow graph and runner placement remain in
[CI / GitHub Actions Pipeline](ci-pipeline.md).

## Storage reclamation

ARC runner Pods are disposable. Kubelet image garbage collection reclaims Pod
runtime content. Each persistent rootless BuildKit shard applies its own cache
garbage collection. The repository does not run host Docker pruning from a
workflow and does not use the legacy registered `nook` runner.

Dependency-policy checks protect warm BuildKit layers from disposable outputs:

- Each workspace check retains its fresh `POLICY_RUN_NONCE`.
- The immutable policy-tools stage installs Dylint's declared nightly once.
  Its source is the owning lint crate's `rust-toolchain` file.
- Each check seeds a temporary Cargo home from the immutable tools home.
  Shell exit removes newly fetched crates and advisory databases before snapshotting.
- A hard process kill can bypass that cleanup.
- Fresh policy-data downloads still occur on each check.
  The cleanup prevents those downloads from accumulating in retained result layers.

### CI verification — always check app logs

After tests and static analysis (`task check`, clippy, Playwright report), **app
logs are the most important remaining signal.** They record vault session
lifecycle, sync, and WASM events that neither linters nor DOM assertions expose.

- **Remote e2e failure:** read Playwright attachment `nook-app-logs.json` from
  the CI artifact/report before changing code. The attachment is created for
  every e2e result; failures also print the same entries to test output.
- **E2e failure repair:** for every failed e2e test, analyze the underlying
  cause and write a focused unit test at the owning boundary before fixing the
  defect. Direct e2e-test edits are allowed only when a unit test is infeasible
  (rare).
- **Human local repro:** `E2E_SPEC=… task web:test:e2e:file`, then
  `fetchAppLogs(page)` or open `/app-logs?minLevel=debug&limit=1000`. Agents use
  the hosted remote catalog.
- **Human inspection:** `/logs` in the running app.

Full reference: [logging.md § Debugging, troubleshooting, and CI verification](../../../shared/references/logging.md#debugging-troubleshooting-and-ci-verification).

Local `task ci:pr` remains available as an optional warm-cache debug mirror.
See [pull request validation](../../../gizmo-prime/workflows/pull-requests.md)
and [mission delivery](../../../gizmo-prime/workflows/mission-delivery.md).

E2e serves **production `dist/`** on CI (`vite preview`) with `VITE_VAULT_SYNC_INTERVAL_MS=1000` for fast background sync. Main saves prod dist before e2e and restores after (`web:e2e:restore-prod-dist`).

- Headless UI-demo execution is temporarily disabled in PR and Main workflows.
- New UI-demo artifacts are not published.
- Demo implementations and the UI-demo contract remain available for later
  re-enable.
- Browser E2E remains an independent validation path.

## Registry transport performance

Main finishes repository preflight before native Rust verification begins.
Preflight and native cache exports stay in their verified jobs on the same
node-local shards that solved them.
Each explicit outcome feeds an independent required status gate.
Publication failures do not erase successful Rust evidence or suppress WASM,
web, and browser consumers.
Each publisher exports only its verified complete graph.
Preflight publishes `nook-preflight-v1`.
Native publishes the mode-max `nook-rust-native-source-v4` graph, which embeds
its rust-base and dependency lineage.
Isolated dependency readers prefer their exact `nook-rust-deps-v4` scope, then
fall back to that fresh Main source graph for dependency-only restores.
Main does not serially export overlapping native dependency or rust-base graphs;
those exports made BuildKit prepare and recompress the same complete lineage.
WASM dependency publication remains a distinct verified ref owned by its
dedicated proof path; native publication never owns or overwrites it.

Docker setup selects probes by the graph consumed by that job (`native`,
`wasm`, `preflight`, or `web-e2e`). Use `general` only for a caller that can
execute all of those graphs. The cache-export wrapper reports preparation,
registry-send, and total export seconds separately. A concurrent-map panic is
an actionable shard fault, and the native Main lane warns when BuildKit usage
reaches 100 GB ahead of the configured 112 GB GC maximum.
The portable WASM proof uses `wasm-proof` to compute the immutable dependency
fingerprint. It performs no availability probes because the proof owns its
explicit repair and verification refs.

### Network transport evidence

The OVH registry sender and home worker use TCP BBR for new connections.
The policy applies only to `ovh-us` and `bynull-servo`.
The registry keeps its public hostname and verified TLS path.

The September 2026 investigation measured 226.77 Mbps with Ookla on the home
worker. A registry transfer from its BuildKit namespace stalled under CUBIC.
The same 100 MB range completed in 9.25 seconds after changing the OVH sender
to BBR. This identifies congestion-control sensitivity on the measured path.
It does not establish deliberate ISP throttling or a defective MTU.

### Required actions

1. Apply `task infra:arc:network:configure` to the two named hosts.
   - Run this standalone task after the home BuildKit shard is running.
   - ARC deployment does not invoke this task or certify network performance.
   - The task installs the BBR module-load file and dedicated sysctl file.
   - Systemd loads the module before applying sysctls during boot.
   - It selects the running home BuildKit container independently of its ordinal.
   - A missing or ambiguous container match fails the task.
   - It verifies the existing namespace after updating its default.
   - New pod namespaces inherit the host's congestion-control default.
   - Existing TCP connections retain their original algorithm.
2. Verify `net.ipv4.tcp_congestion_control` on both hosts.
   - Also verify the actual BuildKit namespace and a fresh namespace.
   - Require at least two complete 100 MB transfers from the BuildKit namespace.
   - Record bytes, elapsed time, throughput, and the sender's TCP algorithm.
3. Restore scheduling after the sustained transfer checks pass.
   - Uncordon `bynull-servo` if it was excluded during diagnosis.
   - Confirm every intended node is Ready and schedulable.
4. To undo the policy, remove only the two dedicated configuration files.
   - Their paths are `/etc/modules-load.d/nook-tcp-congestion-control.conf`
     and `/etc/sysctl.d/99-nook-tcp-congestion-control.conf`.
   - Set `net.ipv4.tcp_congestion_control=cubic` on both hosts.
   - Restore that value in the existing home BuildKit namespace too.
   - Revert the repository policy before another explicit network apply.

### Prohibited actions

- Do not treat a short transfer or aggregate speed test as sustained registry proof.
- Do not change MTU, TCP buffers, or public DNS without separate evidence.
- Do not restart BuildKit merely to change the default for new connections.

## Secrets and env

- **`NOOK_GITHUB_PAT`**
  - Used by: `sync-live` e2e
  - Scope: Classic with `repo` scope or fine-grained with contents and pull requests write on this repository.
  - Requirement: PR creation must act as a user so normal workflows fire.
- **`NOOK_GITHUB_E2E_REPO`**
  - Used by: CI sets per run for live suites (one repo per container)
- **`CLOUD_FLARE_PAGES_TOKEN`, `CLOUD_FLARE_ACCOUNT_ID`**
  - Used by: PR preview deploy; main development deploy and domain verification
  - Scope: Account `Cloudflare Pages: Edit` plus `nokey.sh` zone `Zone: Read`, `DNS: Read`, and `Cache Purge`.
- **`GITHUB_TOKEN`**
  - Used by: PR comments, deployment records, portable Rust coverage comment

**Cloudflare credentials**

- Token requires account `Cloudflare Pages: Edit` plus `nokey.sh` zone `Zone: Read`, `DNS: Read`, and `Cache Purge`.
- Main purges stale development routes before live verification.
- PR CI records its preview as a successful `github-pages` deployment for ruleset enforcement.

Local live e2e: copy `nook-app/nook-web/.env.test.local.example` → `.env.test.local` with your PAT.

## Google Cloud operations

Discover the configured Google Cloud CLI and authenticated project at runtime.
Verify the exact account, project, and target resource before mutation.

OAuth browser-origin changes require the Google Auth Platform client
configuration to contain exact origins. Do not commit client secrets. Do not
assume per-PR Cloudflare preview hosts can be covered by wildcards. See
[auth-providers.md §7](../../dev-core/design-docs/auth-providers.md#7-oauth-origins-and-pr-previews).

## Agent execution policy

- GitHub Actions is the agent build/test environment and sole merge-validation
  pipeline.
- Feature teams author tests and return scoped commits.
- Feature Gizmos request only the required remote build-only capability.
- The dev manager alone requests the full slow dev-to-main PR checks.
- Local tests, Docker work, product compilation, and broad pre-push are prohibited.
- Missing build-only tooling is a visible runtime prerequisite.
- Repairs return through the feature path and serialized local dev integration.

## Agent checklist when touching CI or e2e

1. **Do not** move real GitHub API tests back into `main.yml` — extend stub coverage instead.
2. **Do** add new sync-provider integration tests to the `e2e` spec list first; add a small live smoke under `e2e/live/` if the provider has a real backend.
3. **Do** return a formatted Team Agent commit for Gizmo to integrate, push,
   and validate; never run heavy product work locally.
4. **Do** update this doc and
   [pull requests](../../../gizmo-prime/workflows/pull-requests.md) when workflow
   behavior changes.
5. Explicitly labeled PR CI runs Rust/WASM/JS unit tests, Svelte/type checks, lint, formatting, and builds.
   - UI-changing PRs must still add or update their focused headless demo specs.
   - PR and Main UI-demo execution is temporarily disabled.
   - New UI-demo artifacts are not published while execution is disabled.
   - Main-fix validation uses `task pr:validate PR=<number> FULL_E2E=1` and runs the Main-equivalent deterministic browser suites before merge.
   - Main runs the same local-provider and extension **e2e**.
   - Reconcile every actionable unsuccessful Main run through the feature path.
     - Browser E2E failures are included.
     - The repair follows the feature path into local dev.
     - The dev manager controls slow checks and fast-forward promotion.
     - Incident completion retains replacement Main verification.
   - Credentialed **sync-live** checks are explicit manual runs.
6. **Never** add Dockerfile `RUN --mount=type=cache`; dependency installs must use normal image layers. The repository-root Rust suite invoked by `task preflight` rejects violations before app setup.

See also: [ARCHITECTURE.md §7](../../../shared/architecture/system.md#7-the-engineering-harness), [pull requests](../../../gizmo-prime/workflows/pull-requests.md).
