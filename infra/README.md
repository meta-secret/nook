# Nook infrastructure

This directory owns Nook's stateful server infrastructure:

- Redis on host loopback, protected by a generated 256-bit password, with AOF
  persistence and a 12 GiB LRU ceiling.
- Traefik (host network) publishes native Redis TLS at
  `rediss://redis-ovh-borg-1.bynull.link:6380`, obtains and renews certificates
  through ACME on port `443`, and forwards only to loopback Redis.
- A pinned Zot OCI registry runs in k0s with retained local storage at
  `/var/lib/hive/zot`. Traefik publishes it at `https://registry.nokey.sh` with
  Let's Encrypt TLS. Zot requires htpasswd authentication. There is no host
  `:5000` listener and no `kubectl port-forward`.

Redis remains on the personal `*.bynull.link` edge hostname. The OCI registry
uses the product hostname `registry.nokey.sh`. Do not expose anonymous registry
access; every client authenticates with the generated token.

Deploy and inspect the stack from the repository root:

```sh
task infra:deploy
task infra:status
task infra:redis:credential:sync
task infra:redis:stats
task infra:registry:credential:ensure
task infra:registry:credential:sync
task infra:registry:check
task infra:registry:diagnose
```

`INFRA_SSH_TARGET` and `INFRA_REMOTE_DIR` override the default server target and
remote deployment directory. The default target is
`debian@ssh-ovh-borg-1.bynull.link`. Deployment creates the Redis and registry
passwords when needed and never copies them into the repository. The containing
`secrets/` directory is mode `0700`; password files are mode `0600`.

`task infra:registry:credential:sync` copies the registry token into
`.nook/cache/` and upserts GitHub Actions secrets `NOOK_REGISTRY_HOST`,
`NOOK_REGISTRY_USERNAME`, and `NOOK_REGISTRY_PASSWORD`.

DNS for `registry.nokey.sh` must point at the Borg public IP before HTTPS
verification can succeed.

Hosted Docker builds use BuildKit `type=registry` cache refs on
`registry.nokey.sh`. Main alone publishes shared cache manifests; pull requests
restore them read-only after `docker login`. Hive images also publish and pull
through `registry.nokey.sh`.

Node-to-node connectivity is a separate Cloudflare Mesh concern and is not used
by the Redis cache.

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
