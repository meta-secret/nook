# Hive

Hive is Nook's single-task, Kata-isolated AI worker. Kubernetes maintains a
warm pool of four workers; each worker claims one runnable Neo4j task, runs one
embedded Codex thread, commits the terminal result using its lease token, and
exits. The Deployment then creates a clean microVM-backed replacement.

Hive deliberately has no application-level coordinator or message broker.
Neo4j owns the DAG, claim transaction, leases, attempts, and results.

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

Codex authentication is mounted from the `hive-codex-auth` Kubernetes Secret
into `/run/secrets`, then copied by an init container into a per-Pod `emptyDir`
used as `CODEX_HOME`. The k0s API server encrypts Kubernetes Secrets in etcd
with a host-generated AES-GCM key. Rotating the auth file changes a Pod-template
checksum and replaces the warm pool.

No host `CODEX_HOME`, host path, or host Docker socket is mounted. A dedicated
reaper sidecar alone receives a projected, short-lived service-account token
with `get`/`delete` access to Pods in `hive-system`. It deletes the entire Pod
after the worker writes its terminal marker or if the worker container
restarts, so a second task cannot run in the same microVM. The worker receives
an isolated rootless Docker daemon inside its Kata guest for repository-owned
validation.

The prototype clones the configured repository over HTTPS into a disposable
`emptyDir`. It does not publish branches or patches. GitHub publication and a
durable artifact store remain explicit follow-up decisions.

## Graph schema

Hive graph schema version `1` creates unique constraints for `Task`, `Agent`,
`Attempt`, and `Artifact`, plus the task-claim index. Migration records are
stored as `(:HiveSchemaMigration {version, applied_at})`. A worker refuses to
run when the stored version is newer than the binary supports. Because Neo4j
does not allow schema and data writes in one transaction, Hive applies the
idempotent `IF NOT EXISTS` schema statements first and records the version only
after every statement succeeds.

Version 1 is additive. To roll it back, first stop every Hive worker, back up
the Neo4j data volume, drop `hive_task_claim` and the four `hive_*_id`
constraints, then delete the version-1 `HiveSchemaMigration` node. Task and
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

Runtime operations use the binary directly:

```text
hive migrate
hive enqueue --id task-1 --prompt "Implement the feature"
hive worker
```
