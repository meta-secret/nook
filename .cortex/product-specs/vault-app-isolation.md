# Simple and Sentinel Application Isolation

Status: Implemented by epic #360.

Simple Vault and Sentinel Vault are separate products that share audited
building blocks. They are not selectable modes inside one production web app.

## Product Surfaces

| Surface | Project | Production origin | Vault capability |
|---|---|---|---|
| Public site and legacy migration broker | `nook-web-app` | `https://nokey.sh` | Cannot open a vault session |
| Everyday vault | `nook-vault-simple` | `https://simple.nokey.sh` | Simple only; extension pairing allowed |
| Quorum safe | `nook-vault-sentinel` | `https://sentinel.nokey.sh` | Sentinel only; extension integration forbidden |
| Browser companion | `nook-web-extension` | extension origin | Simple only |

The two vault apps have independent package manifests, HTML and TypeScript
entrypoints, Vite configurations, output directories, Cloudflare Pages
projects, WebAuthn relying-party origins, IndexedDB origin storage, and compiled
WASM capabilities. Common Svelte presentation and typed browser adapters live
under `nook-web-shared/src/vault-app`.

## Enforcement

`VaultApplication` in `nook-core` owns the compatibility matrix. Each production
WASM artifact is compiled with exactly one mutually-exclusive capability
feature. A manager validates architecture before creation, local selection,
import, remote adoption, and extension approval. TypeScript may tailor the
surface but is never the authority for the boundary.

Sentinel's web artifact has no extension-connect route. The extension manifest
accepts external connections only from `simple.nokey.sh` and excludes
`sentinel.nokey.sh` from content-script injection.

## Legacy Origin Migration

The old `nokey.sh` origin remains a locked migration broker during the migration
window. It cannot open vault sessions. A destination app creates a short-lived
ephemeral age/X25519 recipient and destination-bound request. After explicit
legacy device authorization, the broker sends an encrypted capsule directly to
the opener with `postMessage`; ciphertext and secrets never enter a URL.

The capsule preserves the existing device identity, matching-type encrypted
vault blobs, identity-sealed provider rows, and verified Sentinel share
deliveries. The destination validates origin, expiry, nonce, vault type, and
every blob in Rust, creates a new origin-scoped passkey wrapper for the same
device identity, performs idempotent local installation, and records the nonce
to reject replay. The legacy source remains unchanged until the user removes it.

## Deployment

Production releases publish `nokey.sh` as the public/migration site and deploy
the two vault projects to separate Cloudflare Pages projects. Release automation
attaches and verifies both custom domains and their proxied CNAME records.

The release gate verifies the app-kind marker, CSP and anti-sniffing headers,
exact release commit, a working Simple extension route, and a `404` response for
that route on Sentinel. Both vault artifacts are built from the same checkout
and receive identical release metadata before either custom domain is accepted
as healthy.

Required external OAuth configuration is deliberately explicit: provider
consoles must register both `https://simple.nokey.sh` and
`https://sentinel.nokey.sh` when that provider is offered in both apps. OAuth
clients that are meant only for Simple must not register Sentinel. Wildcard
subdomains do not satisfy browser OAuth origin checks. WebAuthn does not share
an RP across the apps: each ceremony uses the current destination hostname as
its RP ID, and legacy migration creates a new origin-bound passkey wrapper.

Rollback is a new immutable release from the selected known-good commit; tags
are never moved. Run the production release workflow with a new semantic
version and the known-good ref. The workflow redeploys all three surfaces and
refuses a mixed release where either vault hostname reports a different commit.

## Migration Failure Semantics

- Canceling or closing either window leaves the legacy source unchanged.
- Expired, wrong-origin, wrong-type, nonce-mismatched, tampered, or replayed
  capsules fail before a vault session is created.
- The destination records consumed nonces and repeats local writes
  idempotently. The source is never deleted automatically, so an interrupted
  destination can be cleared and retried without losing the only copy.
- Sentinel capsules contain only the existing encrypted vault artifacts and
  validated participant deliveries. Migration does not create an extension
  grant, password-only bypass, or full-key participant envelope; normal quorum
  rules still apply after import.
- Cross-app links call the Rust/WASM lock path before navigation and carry no
  vault payload, provider credential, or session token in the URL.
