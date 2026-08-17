# Hive

Hive is Nook's single-task, Kata-isolated AI worker. Kubernetes maintains a
warm pool of four workers; each worker claims one runnable Neo4j task, runs one
embedded Codex thread, and owns Main-repair delivery through a green merged
revision. It commits the terminal result using its lease token and exits. The
Deployment then creates a clean microVM-backed replacement.

Nested subagents are disabled inside that thread.

Future multi-agent graphs must create separate durable tasks.

Each reached task runs in its own disposable Pod.

Hive deliberately has no separate message broker. Neo4j owns the DAG, claim
transaction, leases, attempts, and results. A narrow coordinator sidecar owns
the Neo4j credential and exposes only typed worker operations over one private
Unix connection; repository commands cannot issue raw graph queries.

Every embedded turn is pinned to `gpt-5.6-terra` with `low` reasoning effort,
which
is the CLI/config representation of Codex Light. The binary and Kubernetes
deployment carry the same explicit defaults so a platform-default change
cannot silently change the worker pool's model or intelligence level.

## Stored readiness invariant

Task readiness is stored explicitly:

- `BLOCKED` means at least one direct dependency is not `COMPLETED`.
- `READY` means every direct dependency is `COMPLETED`.
- completion promotes newly unblocked tasks in the same write transaction.
- claim always revalidates every dependency, so stale readiness cannot authorize
  execution.

Claiming first obtains a write lock by incrementing `claim_lock` inside the
Neo4j transaction, then revalidates state, dependencies, retries, and lease
expiry before creating an attempt. Completion and heartbeat require the current
unexpired lease token.

## Authentication and repository boundary

Only the auth-broker container mounts the `hive-codex-auth` Kubernetes Secret.
It loads and refreshes the credentials in a broker-only `emptyDir`, accepts
exactly one Unix connection from Hive, unlinks the socket before repository
commands can run, and returns short-lived access tokens over that established
channel. The worker's `CODEX_HOME` contains no credentials and tool subprocesses
cannot reconnect to the broker. The k0s API server encrypts Kubernetes Secrets
in etcd with a host-generated AES-GCM key. Rotating the auth file changes a
Pod-template checksum and replaces the warm pool.

No host `CODEX_HOME`, host path, or host Docker socket is mounted. The reaper
sidecar receives only an opaque credential for a dedicated controller service;
it has no Kubernetes API token. That controller runs under a separate workload
identity restricted to `get`/`delete` labeled Hive Pods. It deletes the entire
Pod after the worker writes its terminal marker and reloads both its projected
Kubernetes token and opaque credential for every request. A create-once workspace
sentinel makes a restarted worker write that marker before exiting, so a second
task cannot run in the same microVM. The worker Pod identity can patch only the
Codex-auth Secret, and its projected token is mounted only into the auth broker.
Workers receive no Docker socket.
The worker image includes Rust, Bun, Node, and Task; the normal `task format`
entrypoint selects native sealed-guest formatting, so no nested Docker daemon
or privileged builder is required.
On `SIGTERM`, a claimed worker transactionally releases its lease and marks the
attempt interrupted without consuming the task's retry budget before rollout.

A one-replica Kata dispatcher keeps a bounded shallow public Workbench Git
snapshot, prunes superseded Git objects, and reconciles trusted `ready/hive`
Main incidents into Neo4j only when that snapshot changes. Incident bodies are
cached by content, so an updated run attempt in the same file is evaluated
again. The failed Main SHA is the idempotency key, so retries do not duplicate
work. It requires the referenced Actions run to be the exact
`meta-secret/nook` Main push on `main` at that SHA before enqueueing, so a
successful rerun makes a stale incident a no-op. A repository-scoped
GitHub credential is exposed directly to the trusted Main-repair Codex agent as
`GH_TOKEN`. The runtime includes the standard `gh` CLI, and Codex uses ordinary
`git`, `gh`, and repository Taskfile commands for deterministic branch
publication, PR inspection, review replies and resolution, exact-head
squash merge, resulting Main verification, and Workbench completion. Review,
comment, repair-PR, and check histories must be traversed completely. Hive does
not add a custom publication broker, mailbox, signing protocol, or private
checkout to hide this credential from the agent.

If Codex discovers blocking work, its structured result names the blocker.
Hive atomically creates a higher-priority task, adds a `DEPENDS_ON` edge, and
releases the original attempt without consuming its retry budget. Completing
the blocker promotes the original task back to `READY`.

The prototype fetches the task's full pinned Git object ID over HTTPS into a
disposable `emptyDir`; every task in one dependency DAG must target that same
revision. Before marking an implementation task complete, Hive collects a
bounded binary Git patch, stores its digest and content as an `Artifact` node
linked to the attempt, and commits that artifact in the same Neo4j transaction
as the terminal result. Main-repair agents do not return their completed result
until they have squash-merged the PR and verified the resulting Main workflow.
Deterministic branches and GitHub inspection let replacement Pods resume an
existing delivery instead of creating duplicates.

The complete Main-repair lifecycle has a six-hour execution bound. Embedded
Codex validation commands append typed, secret-sanitized local execution events
outside the repository checkout. The agent includes their command identity,
category, timestamps, duration, outcome, and reason in the immutable Workbench
statistics record.

Neo4j requires Bolt TLS. The deployment creates a private CA and
service certificate, configures the chart with `server.bolt.tls_level=REQUIRED`,
and stores the keys only in encrypted Kubernetes Secrets and the authenticated
recovery bundle. Only the coordinator gets the Neo4j credential and CA.

## Control Center

The read-only Hive Control Center makes the durable task graph and live worker
activity visible without exposing credentials, prompts, model reasoning, or raw
command output. A token-free HTTP container talks only to a narrowly typed
Unix-socket coordinator sidecar; only that sidecar holds the Neo4j credential
and reads over the existing private TLS boundary. The observer serves:

- worker presence and lease state,
- a bounded typed alert projection for failed, dependency-blocked,
  stale-running, and stuck-cancellation tasks,
- the bounded task queue and dependency graph,
- sanitized semantic activity such as validation, changes, retries, and results.

The Service remains cluster-private. Operators reach it through an SSH-backed
local port-forward:

```text
task infra:hive:dashboard
```

The browser opens `http://127.0.0.1:18080` by default and refreshes every
15 seconds. Set `HIVE_DASHBOARD_PORT` to use a different local port. The
existing `task infra:hive:queue:status` command remains the compact terminal
view, while `task infra:hive:diagnose` includes bounded observer logs.

## Graph schema

Hive graph schema version `9` retains unique constraints for `Task`, `Agent`,
`Attempt`, and `Artifact`, adds `TaskActivity` identity and timeline indexes,
and retains the task-claim index. Migration records are
stored as `(:HiveSchemaMigration {version, applied_at})`. A worker refuses to
run when the stored version is newer than the binary supports. Because Neo4j
does not allow schema and data writes in one transaction, Hive applies the
idempotent `IF NOT EXISTS` schema statements first and records the version only
after every statement succeeds.

Version 2 adds the pinned `source_commit` task property. Version 3 initializes
the original one-time retry marker. Version 4 replaces that marker with
`last_retry_release`, allowing one explicit three-attempt recovery per deployed
Hive image digest and atomically rearming failed blocker dependencies. Version
5 adds the current task scheduling indexes. Version 6 adds bounded, sanitized
`TaskActivity` events for the observer. Version 7 backfills and maintains each
task's newest activity timestamp so bounded overview polling does not aggregate
the retained activity graph. Version 8 initializes the explicit `obsolete`
retirement marker on every `Task` and `Attempt`; new writes always persist the
boolean so obsolete dependency revival is durable and queryable. Version 9
flattens blocker-chain descendants directly onto each non-blocker consumer.
The flattened relationships retain their prior dependency depth so child
artifacts apply before parent artifacts. It then detaches every blocker-owned
dependency edge and rearms blocked parents as `READY` dependency leaves. That
also prevents an obsolete completed blocker from restoring a nested chain.

To roll version 9 back to a version-8 binary, first stop every Hive worker,
coordinator, observer, and dispatcher and back up the Neo4j data volume. The
removed blocker-owned dependency edges cannot be reconstructed from the migrated
graph. Either restore the pre-version-9 backup, or drain the entire active queue
with schema-9 Hive until this query returns zero:

```cypher
MATCH (task:Task)
WHERE task.status IN ['READY', 'RUNNING', 'CANCELLING', 'BLOCKED']
RETURN count(task)
```

Only after the queue is drained may an operator delete the version-9
`HiveSchemaMigration` node and start a version-8 binary. Do not delete the
version-9 marker while any active task remains.

To roll version 8 back to a version-7 binary, first stop every Hive worker,
coordinator, observer, and dispatcher and back up the Neo4j data volume. Delete
no schema marker or property until
`MATCH (task:Task {obsolete: true}) RETURN count(task)` returns zero. A nonzero
count prohibits rollback: restart schema-8 Hive and rearm or genuinely complete
those retired prerequisites first. Once no retired task remains, delete only the
version-8 `HiveSchemaMigration` node, remove `obsolete` from `Task` and `Attempt`
nodes, and retain the version-7 marker and `latest_activity_at`.
To roll version 7 back further, keep Hive stopped, delete only the version-7
marker, and remove `latest_activity_at` from `Task` nodes. Keep
`last_retry_release` so a later forward migration cannot repeat a recovery for
the same deployed image.

## Commands

From the repository root:

```text
task hive:check
task hive:test
task hive:build
task hive:image
```

The repository-owned `Hive` GitHub Actions workflow runs these pinned Docker
checks only when Hive or its infrastructure changes. Pull requests restore the
trusted Main GHA BuildKit scope read-only, and only Main publishes that scope.
The Dockerfile uses the same pinned cargo-chef planner/recipe/cook boundary as
`nook-app`, then warms real-lock debug/test and release profiles before copying
authored sources. `hive:check` and `hive:test` share one Buildx builder.
Dependency changes rebuild those layers; ordinary source changes reuse them.
Main exports the graph only after both check and behavior tests pass. Trusted
repository runs also mount the existing direct-TLS Redis credential into Rust
compile steps and report `sccache` statistics under the isolated `nook-hive`
key prefix. Forks and local runs without the credential compile normally; the
credential is never copied into an image or BuildKit cache layer.

Runtime operations use the binary directly:

```text
hive migrate
hive enqueue --id task-1 --source-commit <full-git-object-id> --prompt "Implement the feature"
hive worker
hive observer
```
