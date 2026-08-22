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
- Pinned Actions Runner Controller scale sets run focused and opted-in trusted
  Rust merge jobs in single-use `kata-qemu-runtime-rs` Pods. Each 16 GiB microVM
  carries Docker client tooling and its own privileged BuildKit sidecar on Pod
  loopback. Its overlayfs builder state uses a private 32 GiB ext4 image.
  General runners also give Podman a sparse, private 24 GiB ext4 image so its
  native overlay driver does not depend on FUSE over the Kata shared volume.
  The image is a metadata-only reflink clone of a trusted seed in the
  Task-managed Btrfs pool. There is no full-size copy at runner startup. There
  is no Docker daemon, DinD, Sysbox, shared builder, or host runtime socket.
  The runner container cannot mount the pool or another job's writable state.
  No runners stay warm: ARC creates one fresh microVM per job. Both `nook-k0s`
  and the dedicated `nook-k0s-hive` set permit ten concurrent jobs. Hive adds
  pinned Neo4j and non-root Trixie test-runtime native sidecars. Kubernetes
  stops both helpers when the runner exits. The runtime executes exported tests
  through a private exchange volume. It does not introduce a Docker daemon.

Both public edge services live under the `*.dev.nokey.sh` namespace. Do not
expose anonymous S3 or registry access; every client authenticates with the
generated credentials.

Deploy and inspect the stack from the repository root:

```sh
# First deployment only: create a repository-scoped fine-grained token file
# with Administration read/write, then bootstrap the controller Secret.
ARC_GITHUB_TOKEN_FILE=/secure/path/nook-arc-token task infra:deploy

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
```

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
Remote identity may update only `nook/remote-buildcache/**` and can read but not
update `nook/buildcache/**`.

DNS for `sccache.dev.nokey.sh` and `registry.dev.nokey.sh` must point at the
Borg public IP (DNS-only A/AAAA, not proxied) before HTTPS verification can
succeed. Host-network Traefik requires an nftables INPUT accept for TCP `443`
(and `22` for SSH); `task infra:deploy` ensures those edge rules stay present
after k0s firewall updates. Public Redis `:6380` is retired.

Hosted Docker builds use BuildKit `type=registry` cache refs on
`registry.dev.nokey.sh`. Main publishes shared cache manifests; pull requests
restore them read-only after `docker login`. Explicit Remote tasks use
branch-and-task Zot refs with Main fallback and write only those Remote refs in
the separately authorized `nook/remote-buildcache/**` repository path. Zot
deduplicates identical layer blobs shared with Main. Remote Rust compiler vertices
read trusted Main SeaweedFS objects through a separate read-only identity and
stable BuildKit secret IDs; secret contents
never enter image layers or cache checksums.

`preflight`, `rust:ci`, and `arc:runtime` Remote selections use `nook-k0s`
through the repository variable `NOOK_RUNS_ON`. Trusted Main jobs also select
that scale set. Each general Kata guest has private loopback BuildKit and
Podman services plus a shared runner work volume, so `type=docker`, `docker
run`, and bind-mounted artifacts stay job-scoped without DinD or a host runtime
socket. The Podman image is sparse, grows only with runtime data, and is
discarded with the job. Trusted Hive Rust verification uses `nook-k0s-hive` through
`NOOK_HIVE_RUNS_ON`; its browser job stays hosted. Unsupported focused tasks,
forks, and Dependabot retain hosted routing.
`task infra:arc:activate` sets the ARC route;
`task infra:arc:fallback` immediately restores both routes to `ubuntu-latest`.
ARC Buildx uses
the remote driver against the private BuildKit sidecar. Each job starts from
the reusable local seed but writes only to its own Pod UID clone. Zot remains
the authoritative cache shared with hosted builders. Its
authenticated Zot traffic resolves through the same node's TLS ingress,
avoiding an external registry data path while preserving the public certificate
and registry host.

Node-to-node connectivity is a separate Cloudflare Mesh concern and is not used
by the compiler cache.

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
