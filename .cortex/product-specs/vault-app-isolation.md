# Simple and Sentinel Application Isolation

## Overview

Status: Implemented by epic #360.

Simple Vault and Sentinel Vault are separate products that share audited
building blocks. They are not selectable modes inside one production web app.

## Product Surfaces

| Surface | Project | Production origin | Vault capability |
|---|---|---|---|
| Public site | `nook-web-app` | `https://nokey.sh` | Cannot open a vault session |
| Everyday vault | `nook-vault-simple` | `https://simple.nokey.sh` | Simple only; extension pairing allowed |
| Quorum safe | `nook-vault-sentinel` | `https://sentinel.nokey.sh` | Sentinel only; extension integration forbidden |
| Browser companion | `nook-web-extension` | extension origin | Simple only |

Main mirrors the same origin isolation at `dev.nokey.sh`,
`simple.dev.nokey.sh`, and `sentinel.dev.nokey.sh`. Pull requests use native
Pages branch aliases under the `nokey-sh`, `nokey-simple`, and
`nokey-sentinel` projects. The combined `nook` preview remains an internal test
harness, not a public application topology.

The two vault apps have independent package manifests, HTML and TypeScript
entrypoints, Vite configurations, output directories, Cloudflare Pages
projects, WebAuthn relying-party origins, and IndexedDB origin storage. They
share one audited, generated WASM package. Common Svelte presentation and typed
browser adapters live under `nook-web-shared/src/vault-app`.

The public site chooses the product, not the storage workflow. On an empty
origin, the selected vault app presents **Create a new vault** and **Open an
existing vault** as sibling intents. Creation stays within that app's fixed
vault type; opening connects the sync provider that already holds a compatible
encrypted vault. Provider import is never a later step inside new-vault
creation, and the internal combined harness is not exposed as a universal
production manager. Opening an existing vault fails closed when the selected
provider is empty; only explicit creation or adding a provider to an
authenticated vault may initialize empty provider storage with genesis state.

## Enforcement

`VaultApplication` in `nook-core` owns the compatibility matrix. `nook-wasm` is
compiled and optimized exactly once; each application entrypoint configures its
immutable application identity in Rust before importing the Svelte app. The
identity may be configured idempotently but cannot be changed in the same WASM
realm. Every manager reads that Rust-owned identity and validates architecture
before creation, local selection, import, remote adoption, and extension
approval. TypeScript selects the application at bootstrap but is never the
authority for the boundary.

The shared package contains the extension-approval binding needed by Simple and
the browser companion. Sentinel remains extension-free because its Rust
application identity rejects approval, its web bundle contains no extension
protocol or UI, it serves no extension-connect route, and the extension manifest
cannot connect to or inject into its origin. Isolation verification checks all
of these boundaries in the built production artifacts.

Sentinel's web artifact has no extension-connect route. The extension manifest
accepts external connections only from `simple.nokey.sh` and excludes
`sentinel.nokey.sh` from content-script injection. Simple never advertises or
links to Sentinel in its vault application shell. Sentinel may offer a one-way
link back to Simple for users leaving the quorum-only product.

## Deployment

- **Production release:** Publish `nokey.sh` as the public site and deploy the
  two vaults to separate Cloudflare Pages projects.
  - Attach and verify both custom domains and their proxied CNAME records.
- **Main and PR deployment:** Deploy all three artifacts independently.
  - Point the landing and both vault custom domains at their Pages
    `development` branch aliases so Main cannot replace a production branch.
  - Deploy PR branch `pr-<number>` to all three projects.
  - Expose only Cloudflare-native PR aliases; create no branded DNS records.
- **Release gate:** Verify the app-kind marker, CSP, anti-sniffing headers, exact
  release commit, working Simple extension route, and Sentinel `404` for that
  route.
  - Build both vault artifacts from the same checkout.
  - Give both identical release metadata before accepting either custom domain
    as healthy.
- **External OAuth and WebAuthn:** Register both vault origins when a provider is
  offered in both apps.
  - A Simple-only OAuth client must not register Sentinel.
  - Wildcard subdomains do not satisfy browser OAuth origin checks.
  - WebAuthn ceremonies use the current hostname as RP ID; the apps do not share
    an RP.
  - Register both stable Main vault origins with browser providers.
  - Keep PR aliases provider-disabled and give them no OAuth credentials.
- **Rollback:** Create a new immutable release from the selected known-good
  commit; never move tags.
  1. Run the production workflow with a new semantic version and known-good ref.
  2. Redeploy all three surfaces.
  3. Refuse a mixed release when vault hostnames report different commits.
- **Cross-app navigation:** Call the Rust/WASM lock path before navigation.
  - Carry no vault payload, provider credential, or session token in the URL.

