# Nook infrastructure

This directory owns the small stateful Docker stack used by Nook builds:

- Redis on server loopback port `6380`, with AOF persistence and a 12 GiB LRU
  ceiling. GitHub-hosted runners reach it only through an authenticated SSH
  tunnel, and Rust compilation uses it through `sccache`.
- An OCI Distribution registry on server loopback port `5000`, with persistent
  storage. It is deployed for future Docker/BuildKit caching but is not yet used
  by CI.

Neither service is exposed on a public interface. Keep them behind SSH until
the registry has an explicit TLS and authentication design.

Deploy and inspect the stack from the repository root:

```sh
task infra:deploy
task infra:status
task infra:redis:stats
task infra:registry:check
```

`INFRA_SSH_TARGET` and `INFRA_REMOTE_DIR` override the default server target and
remote deployment directory.
