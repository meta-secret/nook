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
used as `CODEX_HOME`. No host `CODEX_HOME`, host path, Docker socket, or
Kubernetes service-account token is mounted. The deployment task creates or
updates that Secret only when `HIVE_CODEX_AUTH_FILE` explicitly names an auth
file.

The prototype clones the configured repository over HTTPS into a disposable
`emptyDir`. It does not publish branches or patches. GitHub publication and a
durable artifact store remain explicit follow-up decisions.

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
