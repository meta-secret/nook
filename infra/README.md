# Nook infrastructure

This directory owns Nook's stateful server infrastructure:

- Redis on the internal Compose network, protected by a generated 256-bit
  password, with AOF persistence and a 12 GiB LRU ceiling.
- Traefik publishes native Redis TLS at
  `rediss://redis-ovh-borg-1.bynull.link:6380`, obtains and renews its
  certificate through ACME on port `443`, and forwards only to internal Redis.
- A pinned Zot OCI registry runs in k0s with retained local storage at
  `/var/lib/hive/zot`. A hardened systemd port-forward exposes it only on server
  loopback port `5000`, preserving the Docker and containerd image path without
  a public Kubernetes Service or Ingress.

Redis is public only through TLS termination and password authentication. Zot
remains loopback-only. Do not publish it or give hosted jobs credentials until a
trusted TLS authentication and cache-write policy is implemented.

Deploy and inspect the stack from the repository root:

```sh
task infra:deploy
task infra:status
task infra:redis:credential:sync
task infra:redis:stats
task infra:registry:check
task infra:registry:diagnose
```

`INFRA_SSH_TARGET` and `INFRA_REMOTE_DIR` override the default server target and
remote deployment directory. The default target is
`debian@ssh-ovh-borg-1.bynull.link`. Deployment creates the Redis password when
needed and never copies it into the repository. The containing `secrets/`
directory is mode `0700`; the password file is mode `0600`.

The first Zot deployment discovers the old Compose registry, copies every
tagged image through a temporary loopback port, compares the source and
destination manifest digests, and only then switches `127.0.0.1:5000` to Zot.
Failure before a verified new endpoint restarts the legacy container. The old
Docker volume is deliberately retained after cutover as a bounded rollback
artifact; it is not mounted by Zot.

Node-to-node connectivity is a separate Cloudflare Mesh concern and is not used
by the Redis cache.

Hosted jobs do not receive the Redis password. Pull-request heads, arbitrary
release refs, dependency-update agents, and AI-authored jobs compile without
sccache; otherwise code under review could read, poison, or exfiltrate the
shared cache.

Hosted Docker builds still use GitHub Actions BuildKit cache scopes. Zot is
currently the private image registry for the server and Hive. Replacing those
scopes requires a separate authenticated access design: untrusted pull-request
code must neither receive a reusable credential nor gain write access to shared
cache manifests.

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
