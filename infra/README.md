# Nook infrastructure

This directory owns Nook's stateful server infrastructure:

- SeaweedFS on host loopback S3 (`127.0.0.1:8333`), protected by generated
  access/secret keys, with data under `/var/lib/nook/seaweedfs`.
- Traefik (host network) publishes HTTPS on port `443` with ACME for:
  - `https://sccache.dev.nokey.sh` → loopback SeaweedFS S3
  - `https://registry.dev.nokey.sh` → Zot ClusterIP `10.96.90.10:5000`
- A pinned Zot OCI registry runs in k0s with retained local storage at
  `/var/lib/hive/zot`. Zot requires htpasswd authentication. There is no host
  `:5000` listener and no `kubectl port-forward`.
- Pinned Actions Runner Controller scale sets run trusted jobs in disposable
  ordinary Pods. Each qualified node owns one retained 64 GiB rootless BuildKit
  shard. The node-local Service keeps a runner on its selected shard. There is
  no Docker daemon, Podman, DinD, Sysbox, host runtime socket, runner host path,
  privileged runner, or Kata runtime.
- Rootless BuildKit uses its required no-process-sandbox mode because ordinary
  unprivileged Pods cannot mount the nested `/proc` used by the OCI sandbox.
  Therefore only trusted same-repository jobs use ARC. Fork and Dependabot jobs
  remain hosted.
- The general `nook-k0s` set permits 35 concurrent jobs. The dedicated
  `nook-k0s-hive` set permits ten. Hive adds pinned Neo4j and non-root Trixie
  test-runtime sidecars.
- Kubernetes prefers either Rise-S worker, then the home 7950X3D node, then
  KS-6. Topology spreading expands the burst envelope across both primary
  NVMe workers without concentrating the queue on one machine.

Both public edge services live under the `*.dev.nokey.sh` namespace. SeaweedFS
and private `nook/**` Zot repositories require generated credentials. Zot's
pull-through `library/**` mirror is intentionally anonymous for read-only
upstream image pulls by kubelet, BuildKit, and Actions service containers.
Anonymous mirror writes and every private-repository read or write remain
denied.

Deploy and inspect the stack from the repository root:

```sh
# First deployment only: create separate repository-scoped fine-grained token
# files. The controller needs Administration read/write. The host verifier
# needs Actions read only. Both are persisted automatically under ~/.nook.
ARC_GITHUB_TOKEN_FILE=/secure/path/nook-arc-token \
  ARC_CACHE_VERIFIER_TOKEN_FILE=/secure/path/nook-arc-verifier-token \
  task infra:deploy

# Routine deployments retain the installed Secret.
task infra:deploy
task infra:status
task infra:sccache:credential:sync
task infra:sccache:check
task infra:registry:credential:ensure
task infra:registry:credential:sync
task infra:registry:check
task infra:registry:diagnose
task infra:arc:render:check
task infra:arc:deploy
task infra:arc:status
task infra:arc:diagnose
task infra:arc:activate
task infra:arc:fallback
task infra:arc:smoke
task infra:arc:hive:smoke
task infra:kubernetes-cache:prove

# Install or reconcile one reviewed OVH worker through provider API, host
# bootstrap, authenticated mesh, k0s, BuildKit, and ARC readiness.
task infra:ovh:server:deploy INFRA_OVH_SERVER=nook-rise-s-2
```

`task infra:kubernetes-cache:prove` runs the portable Kubernetes integration
proof. It creates one isolated k3d server and three agents, then applies
Kustomize patches to the production Zot, BuildKit, and NetworkPolicy manifests.
The proof validates node-local cache retention, cross-node Zot restoration,
stable-scope ACLs, isolated concurrent refs, and denied unlabeled clients. It
first proves an authorized BuildKit Service client, then uses StatefulSet
headless endpoints to bind each cache assertion to one exact shard. It cleans
up only its exact cluster and uses an isolated kubeconfig. The hosted
Remote task installs checksum-pinned k3d automatically. A local caller needs
k3d v5.9.0, Docker, Bun, and kubectl.

This proof covers portable Kubernetes workload behavior. The overlay uses
cluster-wide Service routing because hosted k3d does not reproduce production's
node-local `internalTrafficPolicy` path reliably. k0s lifecycle, node-local
Service routing, WireGuard routing, Kata isolation, ARC controller lifecycle,
node capacity, and production performance remain production-only evidence.

`INFRA_SSH_TARGET` and `INFRA_REMOTE_DIR` override the default server target and
remote deployment directory. The default target is
`debian@ssh-ovh-borg-1.bynull.link`. Deployment creates the SeaweedFS S3 and
registry credentials when needed and never copies them into the repository. The
containing `secrets/` directory is mode `0700`; credential files are mode
`0600`.

`task infra:sccache:credential:sync` copies the bucket-scoped build keys into
`~/.nook/cache/` (shared across checkouts; never into the repo), then upserts
GitHub Actions secrets `NOOK_SCCACHE_ENDPOINT`, `NOOK_SCCACHE_ACCESS_KEY`,
`NOOK_SCCACHE_SECRET_KEY`, and `NOOK_SCCACHE_BUCKET`. That identity has only
read, write, list, and tagging actions for `nook-sccache`; explicit Remote tasks
use a second identity limited to read/list actions on `nook-sccache`. A separate
administrative identity creates the bucket and remains server-side; its keys are
never copied to a checkout or GitHub.

`task infra:registry:credential:sync` copies the registry token into
`~/.nook/cache/`, runs `docker login` for `registry.dev.nokey.sh`, and upserts
GitHub Actions secrets `NOOK_REGISTRY_HOST`, `NOOK_REGISTRY_USERNAME`,
`NOOK_REGISTRY_PASSWORD`, `NOOK_REGISTRY_REMOTE_USERNAME`, and
`NOOK_REGISTRY_REMOTE_PASSWORD`. The Main identity administers the registry; the
Remote identity may update only `nook/remote-buildcache/**`. It can read all
public mirror repositories, including `nook/buildcache/**`, but cannot update
them. This keeps authenticated CI pulls equivalent to anonymous mirror pulls
without expanding the Remote identity's write boundary.

DNS for `sccache.dev.nokey.sh` and `registry.dev.nokey.sh` must point at the
Borg public IP (DNS-only A/AAAA, not proxied) before HTTPS verification can
succeed. Host-network Traefik requires an nftables INPUT accept for TCP `443`
(and `22` for SSH); `task infra:deploy` ensures those edge rules stay present
after k0s firewall updates. Public Redis `:6380` is retired.

Hosted Docker builds use BuildKit `type=registry` cache refs on
`registry.dev.nokey.sh`. Hosted fallback jobs publish shared cache manifests;
hosted pull requests restore them read-only after `docker login`. Explicit Remote tasks use
branch-and-task Zot refs with Main fallback and write only those Remote refs in
the separately authorized `nook/remote-buildcache/**` repository path. Zot
deduplicates identical layer blobs shared with Main. Remote Rust compiler vertices
read trusted Main SeaweedFS objects through a separate read-only identity and
stable BuildKit secret IDs; secret contents
never enter image layers or cache checksums.

`preflight`, `rust:ci`, and `arc:runtime` Remote selections use
`nook-k0s` through `NOOK_RUNS_ON`. Trusted Hive Rust uses `nook-k0s-hive`
through `NOOK_HIVE_RUNS_ON`. Unsupported tasks, forks, and Dependabot retain
hosted routing.

`task infra:arc:activate` configures both ARC routes.
`task infra:arc:fallback` restores both routes to `ubuntu-latest`.

ARC Buildx uses the remote driver against
`tcp://nook-buildkit.arc-runners.svc.cluster.local:1234`. BuildKit's local state
persists across runner and builder Pod recreation. Zot remains the authenticated
portable boundary for cold nodes and hosted builders.

Every qualified build node owns one local PV and one BuildKit Pod. Rise-S has
placement tier `primary`. The home 7950X3D node is `secondary`. KS-6 is
`overflow`. These tiers are preferences, so node pressure exposes the next
eligible node.

Node-to-node connectivity is a separate Cloudflare Mesh concern and is not used
by the compiler cache.

Each node's shared BuildKit Pod requests 4 CPU and 8 GiB, has no CPU limit, and
may use 48 GiB during a large parallel solve. Each disposable runner requests
0.5 CPU and 1 GiB and may use 4 CPU and 6 GiB, with a 32 GiB ephemeral work
volume. These are ordinary Pods, not per-job microVMs. Kubernetes admits work
from requests and live node pressure; the scale-set ceilings are queue limits,
not promises that one node can run every runner simultaneously.

Add and inspect a distinct Linux Mesh node through the repository Taskfile:

```sh
task infra:mesh:node:add
task infra:mesh:status
```

The target defaults to `ssh.bynull.link` and node name `nook-servo`; override
them with `INFRA_MESH_SSH_TARGET` and `INFRA_MESH_NODE_NAME`. It uses the
existing Wrangler OAuth session to create or reuse the Cloudflare node and
streams the one-time connector token to the remote installer without putting it
in Task output, local files, or SSH command arguments. The SSH account must have
passwordless `sudo` for `/usr/bin/apt-get`, `/usr/bin/gpg`, `/usr/bin/tee`, and
`/usr/bin/warp-cli`, because the Cloudflare One Client installs a system service
and manages a network interface and routes. Nodes created for direct Mesh-IP
connectivity are distinct and non-HA; subnet routing can be added later as an
explicit change.
