# Nook infrastructure

This directory owns the small stateful Docker stack used by Nook builds:

- Redis on server loopback port `6380`, protected by a generated 256-bit
  password, with AOF persistence and a 12 GiB LRU ceiling.
- A Cloudflare Tunnel publishes Redis as `rust-cache.nokey.sh` without opening
  a server firewall port. Cloudflare Access admits only the GitHub Actions
  service token, and Redis still requires its own password.
- An OCI Distribution registry on server loopback port `5000`, with persistent
  storage. It is deployed for future Docker/BuildKit caching but is not yet used
  by CI.

Redis and the registry remain loopback-only on the server. Do not publish the
registry until it has an explicit TLS and authentication design.

Deploy and inspect the stack from the repository root:

```sh
task infra:deploy
task infra:status
task infra:redis:stats
task infra:registry:check
```

`INFRA_SSH_TARGET` and `INFRA_REMOTE_DIR` override the default server target and
remote deployment directory. The server must already contain the Cloudflare
tunnel token at `secrets/cloudflare-tunnel-token`; deployment deliberately does
not copy that credential from the repository. The containing `secrets/`
directory is mode `0700`; the token file is read-only so the non-root
`cloudflared` container, which runs as the deployment user's UID, can consume
the Compose bind-mounted secret without making it group- or world-readable.

Node-to-node connectivity is a separate Cloudflare Mesh concern: each Linux
server joins as a headless Cloudflare One Client and receives a private Mesh IP.
GitHub Actions does not join that long-lived node network; it reaches Redis
through the narrowly scoped Access TCP application described above.

Only trusted default-branch and normal nightly jobs receive the Redis and
Cloudflare Access secrets. Pull-request heads, arbitrary release refs,
dependency-update agents, and AI-authored jobs use the job-local Redis fallback;
otherwise code under review could read and exfiltrate the shared credentials.
An unavailable remote cache is also a performance-only failure and falls back
locally without failing the build.

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
