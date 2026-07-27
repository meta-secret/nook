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
GitHub credential lives only in a
separate publication broker. Codex can request deterministic branch
publication, PR inspection, targeted review replies and resolution, exact-head
squash merge, and resulting Main verification, but cannot read the credential
or invoke arbitrary GitHub APIs. Review, comment, and repair-PR history is
paginated, as are exact-head check runs. Automated-reviewer comments remain
actionable, outdated threads do not block delivery, and resolution requires the
task's authenticated reply marker to be visible first. A short Git-ref lock
serializes the base recheck and merge; stale locks self-expire.
Before Codex starts, the worker creates that capability only for Main-repair
tasks and exposes no capability path to any other task kind. The capability is
a random `0600` Unix socket inside a private temporary directory; its relay
preconnects one fresh typed broker stream for each sandboxed `hive github`
command. This avoids relying on inherited descriptors that Codex correctly
closes at its shell exec boundary. Codex retains its deny-network policy, and
an interrupted command cannot desynchronize later replies. Publication uses a
broker-owned private Git checkout populated from the worker's read-only tree;
task-controlled hooks and repository Git configuration therefore never execute
in the token-bearing broker.

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
duplicates. Binding returns a recovered merge commit to the replacement worker,
which resumes post-merge Main verification without opening another PR.

The complete Main-repair lifecycle has a six-hour execution bound. Embedded
Codex validation commands append typed, secret-sanitized local execution events
outside the repository checkout; the publication broker includes their command
identity, category, timestamps, duration, outcome, and reason in the immutable
Workbench statistics record.
The record is first published at the successful squash-merge boundary and is
retried idempotently during post-merge verification, completion, and recovered
binding.

Neo4j requires Bolt TLS. The deployment creates a private CA and
service certificate, configures the chart with `server.bolt.tls_level=REQUIRED`,
and stores the keys only in encrypted Kubernetes Secrets and the authenticated
recovery bundle. Only the coordinator gets the Neo4j credential and CA.

## Graph schema

Hive graph schema version `4` retains unique constraints for `Task`, `Agent`,
`Attempt`, and `Artifact`, plus the task-claim index. Migration records are
stored as `(:HiveSchemaMigration {version, applied_at})`. A worker refuses to
run when the stored version is newer than the binary supports. Because Neo4j
does not allow schema and data writes in one transaction, Hive applies the
idempotent `IF NOT EXISTS` schema statements first and records the version only
after every statement succeeds.

Version 2 adds the pinned `source_commit` task property. Version 3 initializes
the original one-time retry marker. Version 4 replaces that marker with
`last_retry_release`, allowing one explicit three-attempt recovery per deployed
Hive image digest and atomically rearming failed blocker dependencies. To roll
version 4 back, first stop every Hive worker and back up the Neo4j data volume,
then delete only the version-4 `HiveSchemaMigration` node. Keep
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
```
