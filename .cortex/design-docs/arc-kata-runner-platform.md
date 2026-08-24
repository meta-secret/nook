# ARC Persistent BuildKit Runner Platform

## Overview

Actions Runner Controller executes trusted GitHub Actions jobs in disposable
Kubernetes Pods.

The runner Pods use the ordinary k0s runtime. They do not use Kata. Each
qualified build node owns one persistent rootless BuildKit shard.

This document owns:

- ARC runner placement;
- the rootless BuildKit boundary;
- node-local cache persistence;
- cache distribution; and
- ARC credential ownership.

The broader Hive agent platform remains in
[Hive Isolated Agent Platform](hive-isolated-agent-platform.md).

## Runner boundary

Runner Pods are disposable and unprivileged.

They receive:

- the Docker CLI and Buildx client;
- a node-local BuildKit service address;
- an ephemeral work directory; and
- no Kubernetes service-account token.

They do not receive:

- a Docker daemon;
- Podman;
- DinD;
- a host Docker or containerd socket;
- a host path;
- a privileged security context; or
- a Kata runtime class.

The Docker CLI is a BuildKit client. It must not be treated as a general
container-runtime API.

Hive ARC runners add only the pinned Neo4j and Rust test-runtime sidecars. Those
helpers remain inside the disposable runner Pod.

## Compute and placement

ARC keeps no warm runner Pod. It creates one Pod for each queued job and removes
that Pod after completion.

Two scale sets serve trusted work:

- **`nook-k0s`**
  - Serves general trusted jobs.
  - Advertises `maxRunners: 25`.
- **`nook-k0s-hive`**
  - Serves Hive Rust verification.
  - Advertises `maxRunners: 10`.

The three qualified nodes use tier preferences:

1. Rise-S is `primary`.
2. The home 7950X3D worker is `secondary`.
3. KS-6 is `overflow`.

Topology spreading prevents all burst work from concentrating on one node. The
target aggregate envelope remains:

- Rise-S: about 8-10 runners;
- home worker: about 8-10 runners; and
- KS-6: about 5-7 runners.

The limits are queue ceilings. Kubernetes resource availability remains the
final admission boundary.

## Persistent local BuildKit shards

The `nook-buildkit` StatefulSet has three replicas. Required anti-affinity keeps
one replica on each qualified node.

Each replica uses:

- rootless BuildKit `v0.32.2`;
- a retained 64 GiB local persistent volume;
- the host path `/var/lib/nook-arc-buildkit/state` behind that volume;
- garbage collection with a 56 GB keep target;
- a 4 CPU request without a CPU limit; and
- an 8 GiB memory request with a 48 GiB limit.

The node-local Service uses `internalTrafficPolicy: Local`. A runner therefore
reaches only the BuildKit endpoint on its own node.

The cache survives:

- runner Pod deletion;
- concurrent jobs;
- BuildKit Pod recreation; and
- ARC controller restarts.

A node loss removes only that node's local shard. Zot remains the portable
fallback.

## Cache distribution

Multiple jobs on one node share one BuildKit content store. BuildKit owns
concurrency and content-addressed deduplication.

Jobs must keep publication identities separate:

- Main publishes shared refs under `nook/buildcache/**`.
- Pull requests use exact-commit refs under `nook/remote-buildcache/**`.
- Hive keeps its independent cache lineage.

A job scheduled on another node may miss the local shard. It imports from Zot
once. Later jobs on that node reuse the hydrated local state.

This design avoids copying a fixed-size cache image. Only referenced
content-addressed blobs move through Zot.

Production Dockerfiles name Zot directly where practical. BuildKit also mirrors
unqualified `docker.io` pulls through `registry.dev.nokey.sh`.

Zot is an on-demand Docker Hub mirror. It preserves upstream digests. A missing
public blob is fetched centrally once and then retained.

## Resource envelopes

General runner Pods may use up to 4 CPU and 6 GiB. Their ephemeral work volume
is limited to 32 GiB.

The persistent BuildKit shard performs compilation, layer extraction, import,
and export. It must not inherit fractional control-plane CPU limits.

Hive's Rust test-runtime sidecar receives 4 CPU and 4 GiB. The runner container
coordinates that work and remains smaller.

Zot may use up to 8 CPU and 12 GiB because it serves all nodes.

These are operational starting points. Live CPU, memory, disk, and network
measurements decide future changes.

## Credential ownership

The ARC controller token is repository scoped.

Store it in:

- the `arc-runners/nook-arc-github` Kubernetes Secret; and
- `~/.nook/github/arc-controller-token` with mode `0600`.

The token needs repository runner-registration authority. It receives no
organization permission.

Runner Pods do not receive that token.

BuildKit uses the existing narrow registry and compiler-cache credentials
provided by trusted workflows. Fork and Dependabot jobs remain on hosted
runners without private credentials.

Run `task infra:arc:fallback` before emergency ARC credential revocation.

## Operations and validation

Deploy the platform with:

```bash
task infra:arc:deploy
```

Inspect the live state with:

```bash
task infra:arc:status
```

Measure every node with:

```bash
task infra:arc:buildkit:benchmark
```

The benchmark must prove:

1. one ready BuildKit endpoint on each of three nodes;
2. a cold solve on each local shard;
3. a faster `CACHED` replay;
4. a new BuildKit Pod UID after restart;
5. the same node and persistent volume after restart; and
6. another `CACHED` replay after restart.

Repository contracts reject the retired Kata, Podman, seed-cloner, cache-primary
scale set, DinD, host socket, privileged runner, and runner host-path designs.
