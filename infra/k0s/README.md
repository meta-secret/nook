# Nook Hive infrastructure

This directory is deployed only through `infra/Taskfile.yml`. From the
repository root, `task infra:deploy` validates the target, installs k0s and
Kata, deploys persistent Neo4j, publishes the Hive image to the target's
loopback registry, and rolls out four Kata-backed workers.

Pinned platform:

- Debian 13 host
- k0s `v1.36.2+k0s.0`
- Helm `v3.21.3`
- Kata Containers `4.0.0`
- Neo4j Helm chart and image `2026.6.0`
- Kata runtime class `kata-qemu-runtime-rs`

No Kubernetes API, kubelet, Neo4j, or Hive port is exposed publicly. The host
firewall must retain a default-drop input policy. Neo4j data uses the retained
local PV at `/var/lib/hive/neo4j`; k0s uninstall never removes that directory.
Kubernetes Secrets are encrypted in etcd with the generated
`/var/lib/k0s/pki/hive-encryption-provider.yaml`; that root-only file must be
included in encrypted host backups or disaster recovery cannot decrypt the
cluster's Secrets. A guarded k0s uninstall preserves that provider and an
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
