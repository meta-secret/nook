# Nook Hive infrastructure

This directory is deployed only through `infra/Taskfile.yml`. From the
repository root, `task infra:deploy` validates the target, installs k0s and
Kata, deploys persistent Neo4j, publishes the Hive image to the target's
loopback registry, and rolls out four Kata-backed workers.

Pinned platform:

- Debian 13 host
- k0s `v1.36.2+k0s.0`
- kubectl `v1.36.2`
- Helm `v3.21.3`
- Kata Containers `4.0.0`
- Neo4j Helm chart and image `2026.6.0`
- Kata runtime-rs class `kata-dragonball`

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
Guarded uninstall removes the owned live k0s rules, persisted fragment, and
nftables include without reloading the global ruleset.
The Hive lifecycle controller continuously reconciles Neo4j's live post-DNAT
Pod endpoint into the workers' narrow Bolt egress policy, including after
automatic StatefulSet or kubelet replacement. Optimistic resource-version
patches preserve concurrent policy changes; while Neo4j has no ready endpoint,
the rule contracts to the stable Service address instead of retaining a stale
Pod address.
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

The first Hive deployment requires explicit Codex authentication and a
repository-scoped GitHub publication token:

```text
HIVE_CODEX_AUTH_FILE=/secure/path/auth.json \
HIVE_GITHUB_TOKEN_FILE=/secure/path/github-token \
task infra:deploy
```

The GitHub token needs Nook contents and pull-request write access plus Actions
read access. Later deployments reuse the encrypted Secrets unless replacement
files are explicitly supplied.
