# Hive

Hive is Nook's single-task, Kata-isolated AI worker. Kubernetes maintains a
warm pool of four workers; each worker claims one runnable Neo4j task, runs one
embedded Codex thread, and owns Main-repair delivery through a green merged
revision. It commits the terminal result using its lease token and exits. The
Deployment then creates a clean microVM-backed replacement.

Hive deliberately has no separate message broker. Neo4j owns the DAG, claim
transaction, leases, attempts, and results. A narrow coordinator sidecar owns
the Neo4j credential and exposes only typed worker operations over one private
Unix connection; repository commands cannot issue raw graph queries.

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

No host `CODEX_HOME`, host path, or host Docker socket is mounted. A dedicated
reaper sidecar alone receives a projected, short-lived service-account token
with `get`/`delete` access to Pods in `hive-system`. It deletes the entire Pod
after the worker writes its terminal marker or if the worker container
restarts, so a second task cannot run in the same microVM. A create-once
workspace sentinel also prevents a restarted worker process from claiming
during the reaper's polling window. Workers receive no Docker socket.
On `SIGTERM`, a claimed worker transactionally releases its lease and marks the
attempt interrupted without consuming the task's retry budget before rollout.

A one-replica Kata dispatcher reconciles trusted `ready/agent` Workbench Main
incidents into Neo4j. The failed Main SHA is the idempotency key, so retries do
not duplicate work. A repository-scoped GitHub credential lives only in a
separate publication broker. Codex can request deterministic branch
publication, PR inspection, targeted review replies and resolution, exact-head
squash merge, and resulting Main verification, but cannot read the credential
or invoke arbitrary GitHub APIs. A short Git-ref lock serializes the base
recheck and merge; stale locks self-expire.

If Codex discovers blocking work, its structured result names the blocker.
Hive atomically creates a higher-priority task, adds a `DEPENDS_ON` edge, and
releases the original attempt without consuming its retry budget. Completing
the blocker promotes the original task back to `READY`.

The prototype fetches the task's full pinned Git object ID over HTTPS into a
disposable `emptyDir`; every task in one dependency DAG must target that same
revision. Before marking an implementation task complete, Hive collects a
bounded binary Git patch, stores its digest and content as an `Artifact` node
linked to the attempt, and commits that artifact in the same Neo4j transaction
as the terminal result. Main-repair tasks are not terminal until the broker has
squash-merged their PR and the resulting Main workflow is green. Deterministic
branches let replacement Pods resume an existing delivery instead of creating
duplicates.

Neo4j requires Bolt TLS. The deployment creates a private CA and
service certificate, configures the chart with `server.bolt.tls_level=REQUIRED`,
and stores the keys only in encrypted Kubernetes Secrets and the authenticated
recovery bundle. Only the coordinator gets the Neo4j credential and CA.

## Graph schema

Hive graph schema version `2` creates unique constraints for `Task`, `Agent`,
`Attempt`, and `Artifact`, plus the task-claim index. Migration records are
stored as `(:HiveSchemaMigration {version, applied_at})`. A worker refuses to
run when the stored version is newer than the binary supports. Because Neo4j
does not allow schema and data writes in one transaction, Hive applies the
idempotent `IF NOT EXISTS` schema statements first and records the version only
after every statement succeeds.

Version 2 adds the pinned `source_commit` task property. To roll it back, first
stop every Hive worker, back up
the Neo4j data volume, drop `hive_task_claim` and the four `hive_*_id`
constraints, then delete the version-2 `HiveSchemaMigration` node. Task and
attempt data do not need to be deleted. Restore the backup if any schema removal
step fails.

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
Main exports the graph only after both check and behavior tests pass.

Runtime operations use the binary directly:

```text
hive migrate
hive enqueue --id task-1 --source-commit <full-git-object-id> --prompt "Implement the feature"
hive worker
```
