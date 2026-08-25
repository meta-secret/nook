# Nook Hive infrastructure

This directory is deployed only through `infra/Taskfile.yml`. From the
repository root, `task infra:deploy` validates the target, installs k0s and
Kata, deploys persistent Neo4j and Zot, publishes the Hive image through the
authenticated `https://registry.dev.nokey.sh` endpoint, and reconciles the ARC
runner platform. The
persistent Hive dispatcher, observer, reaper, and worker Deployments remain at
zero replicas while their duplicate-repair orchestration is being corrected;
operators must not infer that `infra:deploy` re-enables them. Compute nodes join
through WireGuard and receive only ephemeral ARC runner Pods.

Pinned platform:

- Debian 13 host
- k0s `v1.36.2+k0s.0`
- kubectl `v1.36.2`
- Helm `v3.21.3`
- k9s `v0.51.0`
- Kata Containers `4.0.0`
- Neo4j Helm chart and image `2026.6.0`
- Kata runtime-rs class `kata-dragonball` for persistent Hive workers
- Four retained 64 GiB rootless BuildKit shards for ARC

Cluster roles:

- The KS-6 node owns the control plane, Neo4j, Zot, Hive, ARC controllers, and
  ARC listeners. It is labeled `nook.nokey.sh/node-role=control-storage` and
  also qualifies as a slower `nook.nokey.sh/arc-build=true` runner node.
- Each Rise-S NVMe node owns one persistent ARC BuildKit shard. It is labeled
  `nook.nokey.sh/arc-build=true` and uses ARC tier `primary`.
- The home 7950X3D NVMe node is worker-only, uses ARC tier `secondary`, and
  connects from behind NAT through an outbound WireGuard session. It owns one
  persistent local BuildKit shard but no shared registry authority.
- KS-6 uses ARC tier `overflow`. Its large HDD volume retains Zot and other
  durable services without placing registry data on runner NVMe.
- WireGuard address `10.202.0.1` belongs to the controller. Every worker receives
  one explicit, unique address from `10.202.0.2/24`. The stable API address
  remains `10.201.0.1`. Before changing a controller peer, deployment verifies
  that any persisted peer key and Kubernetes `InternalIP` assignment identify
  that same worker. Reusing another worker's address fails closed. A `direct`
  worker has a fixed endpoint. A `roaming` worker has no public endpoint; its
  persistent outbound handshake lets the controller learn the current NAT
  mapping. Deployment then reconciles a direct authenticated WireGuard peer
  between every worker. Each peer owns only that worker's node address and Pod
  CIDR. Worker-to-worker Pod traffic never depends on the controller as a
  forwarding hop.
- ARC creates a fresh ordinary Pod for every job. No runner is kept warm. The
  general scale set can create up to 35 concurrent runners. The Hive scale set
  can create up to ten.

Provision a declared OVH worker from a blank provider-ready server with one
Taskfile entrypoint:

```text
task infra:ovh:server:deploy INFRA_OVH_SERVER=nook-rise-s-2
```

The task verifies the provider identity and installs standard Debian 13. It
pins a generated Ed25519 host identity through the authenticated OVH install,
then applies the idempotent SSH and sudo baseline, joins the private mesh,
installs k0s, and qualifies ARC. It reads the OVH API credential from
`~/.nook/ovh-api.json`. Credentials and host identities remain beneath
mode-`0700` `~/.nook` directories with private files mode `0600`.

An already-installed declared OS is reconciled without reinstalling it only
when its matching host identity is present in the private store. The adapter
never invents a local identity for an unchanged server. Restore that identity
or pass `INFRA_OVH_ALLOW_REINSTALL=true` for declared disaster recovery.

The recovery input forces a reinstall even when the OS name already matches.
Before OVH can wipe the machine, the task authenticates the exact Kubernetes
node, cordons it, waits up to two hours for active ARC jobs to finish, and
drains its remaining workloads.

Join or reconcile the compute node only through the Taskfile:

```text
task --taskfile infra/Taskfile.yml k0s:worker:deploy \
  INFRA_WORKER_SSH_TARGET=debian@167.114.209.184 \
  INFRA_WORKER_MESH_ADDRESS=10.202.0.2 \
  INFRA_WORKER_ARC_TIER=primary

task --taskfile infra/Taskfile.yml k0s:worker:deploy \
  INFRA_WORKER_SSH_TARGET=ssh.bynull.link \
  INFRA_WORKER_REMOTE_DIR=/home/bynull/.local/share/nook-infra \
  INFRA_WORKER_MESH_ADDRESS=10.202.0.3 \
  INFRA_WORKER_ENDPOINT_MODE=roaming \
  INFRA_WORKER_ARC_TIER=secondary
```

The worker stays tainted until k0s, its retained BuildKit storage, and ARC
converge. The task removes that taint only after qualification.

Install the pinned operator console and its credential-free kubeconfig through
the root Taskfile, then use it directly after SSH login:

```text
task infra:kubernetes:console:install
ssh debian@ssh-ovh-borg-1.bynull.link
kubectl get pods --all-namespaces
k9s
```

The user kubeconfig contains the cluster CA and a root-owned exec helper, not a
client certificate, private key, or bearer token. Each invocation obtains a
15-minute token for the dedicated `nook-operator` service account through the
SSH user's existing passwordless sudo boundary. The managed configuration lives
at `~/.kube/nook-k0s.yaml`; installation links `~/.kube/config` only when it is
absent or is the legacy Nook-generated admin configuration, and refuses to
replace an unrelated operator config.

No Kubernetes API, kubelet, Neo4j, or Hive port is exposed publicly. The host
firewall must retain default-drop input and forward policies. The installer adds
only two persisted `10.244.0.0/16` source exceptions arriving on kube-router's
`kube-bridge`: Pod traffic to local
control-plane ports `6443` and `8132` and the kubelet API on `10250`, plus Pod
egress through the forward chain. Kube-router masquerades Pod traffic destined
outside the cluster so replies return through the node. The API server binds the
stable host loopback address `10.201.0.1`; worker policy allows only its `/32`
post-DNAT endpoint on `6443`, so endpoint refresh cannot deadlock behind its own
stale policy. A Taskfile-owned systemd oneshot unit assigns that address before
k0s and validates that the unit is enabled, active, and present on `lo`, so the
binding survives host reboots and fresh installations. No public control-plane
port is opened. The installer applies its
fragment without reloading the global nftables ruleset, preserving Docker's
dynamic networking rules, and atomically restores every previous input and
forward rule in its original order plus the persisted firewall state if
installation errors, exits, or receives a termination signal. The installer
records an existing CNI's masquerade state before
restarting k0s; a migration replaces existing Hive workload Pod sandboxes
automatically. Neo4j data uses the retained local PV at
`/var/lib/hive/neo4j`; k0s uninstall never removes that directory.
Zot uses a separate KS-6 retained local PV at `/var/lib/hive/zot` and a ClusterIP
Service at `10.96.90.10:5000`. Traefik publishes it at
`https://registry.dev.nokey.sh` with htpasswd authentication. There is no host
`:5000` listener and no `kubectl port-forward`. k0s uninstall never removes the
registry data.
Zot is also the unrestricted, on-demand Docker Hub mirror for ARC. Production
Dockerfiles name the public Zot endpoint directly; BuildKit's mirror setting is
defense in depth for unqualified test fixtures. ARC uses only the read-only
registry identity when it publishes Nook cache data; it does not receive Zot
administration. Public upstream mirror content is anonymously readable and has
no client-side write path. Private Nook repositories remain behind explicit
authenticated policies. Zot preserves upstream digests and stores a missing
image once for reuse by every runner and node. The initial SeaweedFS bucket
bootstrap pulls its pinned AWS CLI image directly because Zot does not exist
yet on a clean controller.
ARC uses one retained 64 GiB local persistent volume per qualified build
node. The `nook-buildkit` StatefulSet has four rootless replicas with required
hostname anti-affinity. Each replica binds to its node's
`/var/lib/nook-arc-buildkit/state` directory.

The `nook-buildkit` Service uses `internalTrafficPolicy: Local`. A runner can
therefore reach only the BuildKit Pod on the same node. Runner Pods mount no
host path and receive no Kubernetes token, daemon socket, Podman service, DinD
process, privileged context, or Kata runtime.

BuildKit garbage collection targets 56 GB. Its Pod requests 4 CPU and 8 GiB,
has no CPU limit, and may use up to 48 GiB. Multiple jobs safely share the
content-addressed store on that node.

Zot carries cache state between nodes. A job on a cold shard imports only the
referenced blobs. Later jobs on that node reuse the hydrated local snapshots.
Main and pull requests retain separate publication refs, so concurrent PRs do
not overwrite shared Main identity.

General and Hive runners prefer either Rise-S, then the home 7950X3D worker,
then KS-6. Hostname spreading permits at most five more runner Pods on one
eligible node than another. This expands the aggregate burst envelope without
changing storage or control-plane ownership.

`task infra:arc:buildkit:benchmark` proves cold and warm timings on all four
nodes. It also recreates every BuildKit Pod and requires the same node-local
cache to remain `CACHED`.

Guarded uninstall removes the owned live k0s rules, persisted fragment, and
nftables include without reloading the global ruleset.
Worker reconciliation rejects both mesh addresses and Kubernetes node names
owned by another node before changing controller state. It replaces only its
comment-owned live mesh rules in one checked nftables transaction, preserving
Docker and every unrelated dynamic rule. Worker-side reconciliation follows
the same comment-owned transaction rule for direct workers. A roaming worker
is already protected by outbound NAT, retains its existing host firewall, and
admits cluster traffic only through authenticated WireGuard. A fresh direct
host creates the Nook table without flushing the ruleset; an existing host
retains all unrelated live rules.
The Hive lifecycle controller continuously reconciles Neo4j's live post-DNAT
Pod endpoint into the workers' and Workbench dispatcher's narrow Bolt egress
policies, including after automatic StatefulSet or kubelet replacement.
Optimistic resource-version patches preserve concurrent policy changes; while
Neo4j has no ready endpoint, each rule contracts to the stable Service address
instead of retaining a stale Pod address.
Kubernetes Secrets are encrypted in etcd with the generated
`/var/lib/k0s/pki/hive-encryption-provider.yaml`; that file is readable only by
the dedicated `kube-apiserver` OS user through a read-only ACL and by root; only
root retains write authority. It must be included in encrypted host backups or
disaster recovery cannot decrypt the cluster's Secrets. A guarded k0s uninstall
preserves that provider and an
AES-encrypted, HMAC-authenticated export of the Neo4j TLS/authentication and
Codex and GitHub publication Secrets under `/var/lib/hive/k0s-recovery`; reinstall
restores them before Neo4j or Hive starts. Neo4j Bolt traffic is TLS-only. Its
private CA and service key live only in encrypted Kubernetes Secrets and the
authenticated recovery bundle, not as plaintext host key files.

The Kata-isolated Hive worker is the only container with the pinned
`Localhost` seccomp profile installed by the Taskfile beneath k0s's kubelet
root. The profile allows the rootless Bubblewrap mount-namespace setup inside
the Dragonball guest while remaining compatible with Restricted Pod Security.
It is deny-by-default, based on Moby's pinned
[`seccomp/v0.2.1` default profile](https://github.com/moby/profiles/blob/seccomp/v0.2.1/seccomp/default.json),
and adds only Bubblewrap's namespace and mount syscalls; `bpf` and
`perf_event_open` remain denied.
The worker remains non-root, drops every capability, disallows privilege
escalation, and has a read-only root filesystem. The Taskfile also enables
runtime-rs guest seccomp so the profile is actually enforced inside Dragonball.
Because Restricted Pods mask the inherited procfs, the embedded Codex helper
uses its supported `--no-proc` mode: the user, PID, mount, and network
namespaces remain isolated, while Bubblewrap reuses the masked procfs instead
of attempting a forbidden nested procfs mount. Hive deployment executes that
sandbox shape inside a live worker, asserts guest seccomp is active, and fails
if either boundary cannot be created; all sidecars retain `RuntimeDefault`.

The first Hive deployment requires explicit Codex authentication and a
repository-scoped GitHub publication token:

```text
HIVE_CODEX_AUTH_FILE=/secure/path/auth.json \
HIVE_GITHUB_TOKEN_FILE=/secure/path/github-token \
task infra:deploy
```

The GitHub token needs Nook contents and pull-request write access plus Actions
read access. Later deployments preserve Hive's cluster-rotated Codex Secret
even if `HIVE_CODEX_AUTH_FILE` remains set. Intentionally replacing Codex
authentication is a separate operation that quiesces the warm pool before
publishing the replacement and restores the prior replica count afterward. A
shared remote lock prevents Hive or Neo4j deployment from recreating workers
during this transaction. The local credential is streamed into a cleanup-armed
remote session rather than copied to a reusable host path:

```bash
HIVE_CODEX_AUTH_FILE=/secure/path/auth.json task infra:hive:auth:rotate
```

The GitHub publication Secret retains its existing explicit file-sync behavior
during deployment.
Durable Hive queue state is inspected through the repository Taskfile:

```bash
task infra:hive:queue:status
```

For a visual view of current workers, prioritized tasks, attention states, and
the durable task timeline, open the cluster-private Hive Control Center through
the repository-owned SSH tunnel:

```bash
task infra:hive:dashboard
```

The dashboard and observer are not publicly exposed and do not require a
reusable browser credential.

The status includes both the latest and previous attempt outcomes. For live
renewal evidence and bounded logs from every worker Pod, use:

```bash
task infra:hive:diagnose
```

An exhausted Main-repair task is never reset implicitly or given an unbounded
retry budget. After deploying a platform repair, an operator may add exactly
three attempts to the failed task and each failed blocker dependency while
preserving attempt history:

```bash
task infra:hive:queue:retry \
  HIVE_TASK_ID=main-failure-<full-main-sha>
```

The Taskfile reads the currently deployed image digest and permits one recovery
for that release. Repeating the command against the same release is refused;
deploying a distinct platform repair creates one new bounded recovery
generation.

Retire a superseded or unsolvable task and its exclusive descendants:

```bash
task infra:hive:queue:cancel \
  HIVE_TASK_ID=main-failure-<full-main-sha> \
  HIVE_CANCEL_REASON="superseded by current Main"
```
