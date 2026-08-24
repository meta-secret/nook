# ARC Kata Runner Platform

## Overview

Status: Implemented in the repository and deployed through the infrastructure
Taskfile.

Actions Runner Controller executes trusted GitHub Actions jobs in single-use
Kata QEMU microVMs. This document owns runner isolation, placement, local
BuildKit cache promotion, and ARC credential boundaries. The broader Hive
control-plane design remains in
[Hive Isolated Agent Platform](hive-isolated-agent-platform.md).

## Runner isolation

The runner has no Kubernetes service-account token, host runtime socket, or
Docker daemon. Docker client tooling connects over Pod loopback to a private
BuildKit sidecar in the same microVM.

The general scale set also provides a rootful Podman Docker-compatible API over
Pod loopback. It executes job images inside the disposable Kata guest. BuildKit
and Podman are privileged only inside that guest.

The deployment contract prohibits:

- Docker-in-Docker and every `dockerd` process;
- Sysbox;
- host Docker or containerd sockets; and
- broad hostPath volumes.

The Hive scale set omits Podman. It provides pinned Neo4j and Rust test-runtime
sidecars in the same microVM instead.

## Compute and placement

ARC creates a new Pod and microVM for each job and removes it afterward. It does
not keep warm runners.

- `nook-k0s` serves parallel ordinary trusted jobs on every qualified node.
- `nook-k0s-cache` serves serialized Main cache producers on one primary node.
- `nook-k0s-hive` serves Hive Rust verification on every qualified node.
- The general scale set advertises `maxRunners: 25` across the three qualified
  nodes.
  - Rise-S targets roughly 8-10 runners.
  - The home worker targets roughly 8-10 runners.
  - KS-6 targets roughly 5-7 runners.
  - Placement retains the configured tier preference.
- The Hive scale set advertises `maxRunners: 10`.
- The cache-primary set advertises two runners, although workflow dependencies
  permit only one producer at a time.
- A preparation taint blocks an unqualified compute node.
- Preferred node affinity orders general and Hive placement: Rise-S is
  `primary`, the home 7950X3D worker is `secondary`, and KS-6 is `overflow`.
- Wide, soft hostname spreading remains a safety valve. It does not block a job
  when only one node has capacity.
- Only the cache-primary scale set requires
  `nook.nokey.sh/arc-cache-primary=true`.

Exactly one compute node owns the serialized Main cache lineage. New compute
nodes provide parallel general and Hive capacity without receiving the
cache-primary label. Moving the primary requires draining producers,
transferring or deliberately resetting the seed, and then changing the label.

The ordinary Pod requests about 1 CPU and 4 GiB. Its containers are capped at
about 4.1 GiB in aggregate. The Hive Pod requests about 2 CPUs and 4 GiB. Its
containers are capped at about 6.8 GiB. The QEMU RuntimeClass adds 1792 MiB of
Pod overhead.

One 64 GiB compute node can sustain ten ordinary microVMs or seven
memory-saturated Hive microVMs. A second compute node is required before ten
Hive jobs can run at their full memory limits without overcommit.

The home worker owns no durable service or cache authority. It establishes
WireGuard outbound from behind NAT, so neither a public address nor an inbound
home-router port is required. Loss of the home network removes only disposable
runner capacity; GitHub keeps queued jobs and Kubernetes schedules new Pods on
the remaining qualified nodes.

Every compute node also has a direct authenticated WireGuard peer for every
other compute node. The controller learns a roaming worker's NAT endpoint and
reconciles it to the other peers. A peer may route only that worker's mesh
address and Pod CIDR. The controller is the control-plane hub, but it is not a
worker-to-worker Pod data-plane hop.

## Job-scoped BuildKit state

The cache-primary node maintains a loop-backed Btrfs pool on local NVMe-backed
ext4 storage. Its sparse logical capacity is 768 GiB. Each job receives one
private 32 GiB ext4 state image. BuildKit garbage collection targets 24 GB.

Runner startup follows this order:

1. A trusted init container submits the Pod UID through a narrow request path.
2. A root-owned host helper validates the UID and active Kata sandbox.
3. The helper creates a metadata-only reflink clone of the current seed.
4. The private BuildKit sidecar receives only its Pod UID job subpath.
5. The sidecar loop-mounts that ext4 image inside the guest.
6. BuildKit uses overlayfs on the guest-mounted filesystem.

The runner never mounts the pool. Concurrent jobs use distinct state images
and BuildKit daemons. A Btrfs exclusive quota limits each job subvolume to
32 GiB of changed data.

## Authenticated promotion

A verified Main job writes its run ID, run attempt, and head SHA to a writable
in-guest `emptyDir`. Before untrusted job containers start, the trusted init
creates a root-owned, mode-`0700` request lane. The credential-free sidecar
mounts only that Pod-UID-scoped lane through `subPathExpr` and forwards its
candidate to the host. It cannot traverse another Pod's lane. It performs no
GitHub API call and receives no repository credential.

The root-owned host verifier uses a repository-scoped Actions-read credential
from `/etc/nook/arc-cache-verifier-token`. Deployment persists its reusable
source under `~/.nook/github/arc-cache-verifier-token` with mode `0600` and
installs it only on the cache-primary host. Credential bytes never enter runner
Pods, other build hosts, or repository publication surfaces.

Before creating a promotion intent, the host verifies:

- the run is a push to `main` in `meta-secret/nook`;
- the supplied SHA is the run's exact head;
- the exact run attempt contains an in-progress job; and
- that job's `runner_name` equals the candidate Pod name.

The intent lives under the cloner's mode-`0700` host runtime directory. That
directory is never mounted into a Pod. The Pod-mounted request lane contains
only an untrusted candidate and a host-created acceptance marker. A guest may
spoof its own view of acceptance, but it cannot create the host authority that
blocks cloning or promotes a seed.

Only then does the sidecar acknowledge the workflow step. A feature-branch,
fork, or unrelated runner cannot create a clone barrier by replaying a public
Main run identity.

After Pod teardown, the host queries the same runner job once more. It promotes
only a `success` conclusion. A failed reflink keeps the verified intent and job
state for retry until the intent expires. Failures, cancellations, missing
conclusions, and expired intents do not refresh the seed.

Both host-private intent and promotion barriers expire after two minutes.
Expiration removes only the barrier. Unsafe job state remains retained while the Pod directory,
containerd task, or Kata shim still exists.

Promotion waits for kubelet volume teardown, containerd task removal, and Kata
shim exit. The host then validates the backing inode and recorded seed
generation. It reflinks to a new seed path and atomically replaces the seed
under the same lock used for clone creation. A failed reflink never replaces
the valid seed. Stale concurrent jobs cannot overwrite a newer generation.

## Cache publication fallback

Trusted cache-primary Main jobs use local promotion. Hosted jobs and any job
without the local promotion capability publish the established Zot registry
cache instead. Hive retains its independent Zot lineage because its separate
workflow can overlap Main. This keeps fork, Dependabot, fallback, and recovery
paths independent from private node state.

Main cache producers are serialized in workflow dependencies. Hive publication
does not enter or overwrite that lineage. The cache-primary node selector
ensures Main dependencies cannot diverge across node-local seeds when the
cluster grows.

Every node labeled `nook.nokey.sh/arc-build=true` receives its own local pool,
cloner service, and pinned BuildKit image. General and Hive jobs may use any
qualified build node, including the KS-6 control-storage node. Exactly one node
also owns the host verifier credential and
`nook.nokey.sh/arc-cache-primary=true`. Only the Main producer scale set uses
that selector.

## Credential ownership

Two repository-scoped GitHub credentials have separate authority. Neither is
mounted into an ephemeral runner Pod.

- Store the ARC controller token in `arc-runners/nook-arc-github` and
  `~/.nook/github/arc-controller-token`. Limit it to `meta-secret/nook` and
  grant repository Administration read/write for runner registration.
- Store the verifier token in
  `~/.nook/github/arc-cache-verifier-token` and the cache-primary host file.
  Limit it to `meta-secret/nook` and grant only repository Actions read.
- Grant no organization permissions.
- Persist rotations automatically under `~/.nook`.
- Run `task infra:arc:fallback` before emergency revocation.
- Verify all three scale sets after rotation, then revoke the replaced token.
