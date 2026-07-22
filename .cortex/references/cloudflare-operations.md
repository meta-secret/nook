# Cloudflare Operations

The local AI-agent environment is provisioned with the official Cloudflare API
MCP connection:

```text
name: cloudflare-api
url: https://mcp.cloudflare.com/mcp
authentication: OAuth
access: full Cloudflare control-plane read and write access
```

This is privileged production access. It lets the local agent inspect and
manage Cloudflare resources directly, including Pages projects and deployments,
custom domains, DNS, cache state, Workers, and account configuration. The MCP
connection is the preferred interface for Cloudflare inventory, diagnosis,
drift detection, and authorized operations; do not begin with dashboard
automation, ad hoc `curl`, or a new API token when MCP is available.

## Operating contract

1. Verify the connection with `codex mcp list` before depending on it. This
   capability belongs to the provisioned local environment and must not be
   assumed in GitHub Actions, hosted agents, or another developer's machine.
2. Read current Cloudflare state before every mutation. Resolve the exact
   account, zone, project, deployment, hostname, and record identifiers rather
   than guessing from display names or stale output.
3. Treat repository configuration and GitHub Actions as Nook's deployment
   source of truth. Use MCP to compare desired state with the live control plane
   and to perform an authorized operation; do not turn an undocumented manual
   change into the new policy.
4. Keep mutations inside the user's requested scope. Summarize the intended
   target and effect before destructive, difficult-to-reverse, or production
   routing changes, and verify the resulting Cloudflare state plus the live
   hostname afterward.
5. Never print, persist, commit, or relay OAuth credentials, API tokens, account
   secrets, or sensitive MCP output. Record resource identifiers only where the
   repository already treats them as non-secret configuration.
6. If MCP is unavailable, report the missing capability and use an existing
   authenticated Wrangler session or the documented CI path only when that
   fallback is appropriate. Do not create or request another broad credential
   merely to bypass a transient MCP problem.

For preview, development, and release topology, required CI permissions, and
the live-verification contract, see [CI Pipeline](../workflows/ci-pipeline.md).
