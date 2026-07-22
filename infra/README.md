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
`cloudflared` container can consume the Compose bind-mounted secret.

Node-to-node connectivity is a separate Cloudflare Mesh concern: each Linux
server joins as a headless Cloudflare One Client and receives a private Mesh IP.
GitHub Actions does not join that long-lived node network; it reaches Redis
through the narrowly scoped Access TCP application described above.
