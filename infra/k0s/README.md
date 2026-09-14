# Nook k0s infrastructure

This directory contains the k0s, ARC, Kata, and authenticated Zot registry
configuration retained by Nook. The removed autonomous-agent platform no longer
owns workloads, sidecars, queues, graph storage, or a dedicated ARC scale set in
this cluster.

## Retained services

- k0s provides the Kubernetes control plane and worker runtime.
- ARC runs trusted GitHub Actions jobs in disposable ordinary Pods.
- Each qualified build node owns a persistent rootless BuildKit shard.
- Kata remains available for independently maintained isolated workloads.
- Zot stores authenticated OCI build caches in the `nook-infra` namespace.
- Zot data is retained at `/var/lib/nook/zot`.

No Kubernetes API, kubelet, or registry backend port is exposed publicly.
Traefik publishes the authenticated registry at
`https://registry.dev.nokey.sh`; the cluster backend remains a ClusterIP.

## Storage and namespace migration

The extraction renames the pre-extraction shared data namespace to
`nook-infra` and the retained Zot storage root to `/var/lib/nook/zot`. Node labels now use the
`nook.nokey.sh/*` domain and the k0s encryption-provider configuration is named
`nook-encryption-provider.yaml`.

`task infra:k0s:install` migrates the deployed legacy provider from either its
live pki path or recovery copy before k0s starts with the generic config. It
compares every discovered provider byte-for-byte and fails closed if copies
diverge. A new key is generated only when neither a current nor legacy provider
exists, so Secrets encrypted by an existing cluster remain decryptable. The
legacy files are retained as rollback inputs; after verifying the API and
Secrets, operators may archive them outside the host.

`task infra:registry:deploy` stops the legacy Zot Deployment, moves the retained
host directory when the generic path is absent (or empty), releases the legacy
PVC/PV objects, and recreates them in `nook-infra` against the same data. It is
idempotent after cutover and refuses populated stores at both paths, PVCs in
both namespaces, or an orphaned legacy PV. On failure before the new Pod is
ready, recover by stopping Zot, moving `/var/lib/nook/zot` back to the legacy
path if needed, and reapplying the prior manifest; the retained PV policy means
the registry blobs are not deleted. Verify ownership (`10001:10001`), PVC
binding, registry authentication, and representative manifests before restoring
CI traffic.

## Operations

Use the repository Taskfile surfaces:

```bash
task infra:k0s:install
task infra:arc:deploy
task infra:registry:deploy
task infra:k0s:status
task infra:k0s:diagnose
```

The guarded uninstall requires `K0S_UNINSTALL_FORCE=1` and preserves
`/var/lib/nook/zot`.
