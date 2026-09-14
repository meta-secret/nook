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

Operators must migrate retained registry data and the encryption-provider file
before deploying this revision on an existing host. Stop k0s and the registry,
move the prior retained registry directory to `/var/lib/nook/zot`, rename the
provider file under `/var/lib/k0s/pki`, then deploy. Do not create an empty new
directory over an existing retained store. Verify ownership (`10001:10001` for
Zot), namespace resources, PVC binding, and registry authentication before
restoring CI traffic.

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
