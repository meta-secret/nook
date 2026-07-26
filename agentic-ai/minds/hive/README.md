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

The prototype clones the configured repository over HTTPS into a disposable
`emptyDir`. Before marking an implementation task complete, Hive collects a
bounded binary Git patch, stores its digest and content as an `Artifact` node
linked to the attempt, and commits that artifact in the same Neo4j transaction
as the terminal result. Direct GitHub publication remains an explicit
follow-up decision.

Neo4j requires Bolt TLS. The deployment creates a private host-persisted CA and
service certificate, configures the chart with `server.bolt.tls_level=REQUIRED`,
and gives workers only the CA certificate. Workers connect with `neo4j+s://`,
so both the service hostname and certificate chain are verified.

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
