# Nook Hive infrastructure

This directory is deployed only through `infra/Taskfile.yml`. From the
repository root, `task infra:deploy` validates the target, installs k0s and
Kata, deploys persistent Neo4j and Zot, publishes the Hive image to Zot through
the target's loopback endpoint, and rolls out four Kata-backed workers.

Pinned platform:

- Debian 13 host
- k0s `v1.36.2+k0s.0`
- kubectl `v1.36.2`
- Helm `v3.21.3`
- k9s `v0.51.0`
- Kata Containers `4.0.0`
- Neo4j Helm chart and image `2026.6.0`
- Kata runtime-rs class `kata-dragonball`

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
Guarded uninstall removes the owned live k0s rules, persisted fragment, and
nftables include without reloading the global ruleset.
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
during this transaction:

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
