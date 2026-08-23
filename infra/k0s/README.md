# Nook Hive infrastructure

This directory is deployed only through `infra/Taskfile.yml`. From the
repository root, `task infra:deploy` validates the target, installs k0s and
Kata, deploys persistent Neo4j and Zot, publishes the Hive image to Zot through
the target's loopback endpoint, and rolls out four Kata-backed workers. A
dedicated compute node joins through WireGuard and receives only ephemeral ARC
runner Pods.

Pinned platform:

- Debian 13 host
- k0s `v1.36.2+k0s.0`
- kubectl `v1.36.2`
- Helm `v3.21.3`
- k9s `v0.51.0`
- Kata Containers `4.0.0`
- Neo4j Helm chart and image `2026.6.0`
- Kata runtime-rs classes `kata-dragonball` for persistent Hive workers and
  `kata-qemu-runtime-rs` for ARC builds, including the dedicated Hive scale set
- A loop-backed Btrfs ARC pool with private 32 GiB reflinked BuildKit images

Cluster roles:

- The KS-6 node owns the control plane, Neo4j, Zot, Hive, ARC controllers, and
  ARC listeners. It is labeled `nook.nokey.sh/node-role=control-storage`.
- The Rise-S NVMe node owns ARC runner microVMs and their disposable caches. It
  is labeled `nook.nokey.sh/arc-build=true`.
- WireGuard address `10.202.0.1` belongs to the controller. Every worker receives
  one explicit, unique address from `10.202.0.2/24`. The stable API address
  remains `10.201.0.1`. Before changing a controller peer, deployment verifies
  that any persisted peer key and Kubernetes `InternalIP` assignment identify
  that same worker. Reusing another worker's address fails closed.
- ARC creates a fresh Pod and Kata QEMU microVM for every job. No runner is kept
  warm. The general and Hive scale sets can each create up to ten concurrent
  runners. A third cache-primary scale set owns serialized Main producers.

Join or reconcile the compute node only through the Taskfile:

```text
task --taskfile infra/Taskfile.yml k0s:worker:deploy \
  INFRA_WORKER_SSH_TARGET=debian@167.114.209.184 \
  INFRA_WORKER_MESH_ADDRESS=10.202.0.2
```

The worker stays tainted until Kata, the local cache pool, the BuildKit image,
and ARC converge. The task removes that taint only after qualification.

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
Zot uses a separate retained local PV at `/var/lib/hive/zot` and a ClusterIP
Service at `10.96.90.10:5000`. Traefik publishes it at
`https://registry.dev.nokey.sh` with htpasswd authentication. There is no host
`:5000` listener and no `kubectl port-forward`. k0s uninstall never removes the
registry data.
ARC storage uses a separate Task-managed Btrfs image under
`/var/lib/nook-arc-buildkit` on the selected NVMe compute node. The host
filesystem remains ext4. The trusted preparation init container briefly sees
only the shared clone-request root before untrusted job containers start. It
asks the host service to create a root-owned, mode-`0700` Btrfs subvolume for
that Pod UID. The host applies a 1 MiB exclusive quota before the init container
can publish its clone request. A
credential-free sidecar mounts only its own lane through `subPathExpr` and
forwards its Pod-scoped candidate there.
The authenticated root-owned host verifier establishes the intent under the
host-private runtime directory and checks the final job conclusion. Pods cannot
traverse another Pod's request files. Each Pod sees only its own untrusted
candidate lane and a host-created acceptance marker. The verifier creates that
marker in its private runtime directory and atomically renames it into the lane,
so an untrusted lane cannot redirect host writes through a symlink. Before
accepting a candidate, the verifier also resolves the lane's Pod UID through
host CRI metadata and requires its observed Pod name to match the claimed
GitHub runner. Acceptance is published before the host installs a promotion
intent with an exclusive link. A repeated candidate can neither refresh an
existing intent nor extend its two-minute barrier.
The private BuildKit native sidecar sees only the pool entry selected for its
Kubernetes Pod UID. The runner mounts neither host path. The 768 GiB sparse pool
covers twenty fully allocated 32 GiB
job images, the reusable 32 GiB seed, and filesystem metadata. The 24 GB
BuildKit garbage-collection target normally keeps physical use below that hard
capacity envelope.

Verified Main jobs signal through an in-guest `emptyDir`. The sidecar forwards
the request without receiving a repository credential. The authenticated host
verifier confirms that the exact Pod is currently running the selected Main
job before creating a host-private intent. It checks the same job's final `success`
conclusion after teardown and only then promotes the seed. The runner never sees
the host-private intent directory or any ARC credential. Intents stop blocking new
clones after two minutes. A failed promotion keeps its verified intent and job
state for retry until that deadline. An expired promotion retains unsafe job
state until Kata teardown can be proven complete.
The host waits for complete Kata teardown, rejects a stale seed generation, and
promotes the private state through an atomic Btrfs reflink. New clone requests
wait behind accepted promotion. ARC jobs therefore skip registry export, while
hosted fallback jobs retain Zot publication for cold-node recovery.
Only `nook-k0s-cache` requires the one `arc-cache-primary` node label, so a
larger cluster cannot divide Main's serialized lineage among node-local seeds.
General and Hive jobs remain horizontally schedulable. Hive keeps an
independent Zot publication path because its workflow may overlap Main.

Guarded uninstall removes the owned live k0s rules, persisted fragment, and
nftables include without reloading the global ruleset.
Worker reconciliation rejects both mesh addresses and Kubernetes node names
owned by another node before changing controller state. It replaces only its
comment-owned live mesh rules in one checked nftables transaction, preserving
Docker and every unrelated dynamic rule. Worker-side reconciliation follows
the same comment-owned transaction rule. A fresh host creates the Nook table
without flushing the ruleset; an existing host retains all unrelated live
rules.
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
