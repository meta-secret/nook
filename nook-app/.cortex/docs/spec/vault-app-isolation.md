# Simple and Sentinel Application Isolation

## Overview

Status: Implemented by epic #360.

Simple Vault and Sentinel Vault are separate products that share audited
building blocks. They are not selectable modes inside one production web app.

## Product Surfaces

- **Public site**
  - **Project:** `nook-web-app`
  - **Production origin:** `https://nokey.sh`
  - **Vault capability:** Cannot open a vault session
- **Everyday vault**
  - **Project:** `nook-vault-simple`
  - **Production origin:** `https://simple.nokey.sh`
  - **Production alias origin:** `https://simple.meta-secret.io`, the same
    Simple artifact for organizations that block `.sh` domains
  - **Vault capability:** Simple only; extension pairing allowed on
    `simple.nokey.sh` only
- **Quorum safe**
  - **Project:** `nook-vault-sentinel`
  - **Production origin:** `https://sentinel.nokey.sh`
  - **Vault capability:** Sentinel only; extension integration forbidden
- **Browser companion**
  - **Project:** `nook-web-extension`
  - **Production origin:** extension origin
  - **Vault capability:** Simple only

The two production Simple origins are separate browser origins:

- Each has its own IndexedDB, WebAuthn RP ID, and session state.
- A browser that opens `simple.meta-secret.io` is its own app and device. It
  joins or recovers the keyring and does not see data stored on
  `simple.nokey.sh` in the same browser.
- Simple and Sentinel enrollment links, QR codes, and Sentinel genesis ceremony
  links use the origin serving the page, so a vault on the alias never sends a
  joining device to `simple.nokey.sh`.

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
origin, the selected vault app starts with the identity: create one, join one,
or recover one from the sync provider that keeps it. Creating a vault stays
within that app's fixed vault type. A provider keeps identities, not vaults, so
its compatible vaults arrive only with a recovered or joined identity, as
[recover a keyring from a sync provider](../../../nook-platform/.cortex/docs/architecture/identity-vault-architecture.md#recover-a-keyring-from-a-sync-provider)
states. Identity recovery is never a step inside new-vault creation, and the
internal combined harness is not exposed as a universal production manager.
Recovery fails closed when the selected provider is empty; only explicit
creation or adding a provider to an authenticated identity may initialize
empty provider storage with genesis state.

## Enforcement

`VaultApplication` in `nook-core` owns the compatibility matrix. `nook-wasm` is
compiled and optimized exactly once; each application entrypoint configures its
immutable application identity in Rust before importing the Svelte app. The
identity may be configured idempotently but cannot be changed in the same WASM
realm. Every manager reads that Rust-owned identity and validates architecture
before creation, local selection, import, remote adoption, and extension
approval. TypeScript selects the application at bootstrap but is never the
authority for the boundary.

### Startup boundary

Each vault entrypoint renders an inert, localized startup shell before the
shared vault WASM settles. The shell exposes no action or vault state. The
browser imports the application module only after Rust has initialized, because
application modules may call generated WASM exports while they are evaluated.
It replaces the shell only after Rust has accepted and returned the expected
immutable application identity. A failed engine load leaves a localized
unavailable state instead of a blank document.

Production HTML preloads the fingerprinted shared vault WASM. Release builds
use the size-focused `wasm-opt -Oz` profile. Artifact verification reports both
raw and Brotli-compressed size and rejects regressions beyond the maintained
ceilings. The small companion WASM is loaded only by extension-owned features;
it is not part of the Simple or Sentinel startup dependency graph.

### Extension boundary

The shared package contains the extension-approval binding needed by Simple and
the browser companion. Sentinel remains extension-free because its Rust
application identity rejects approval, its web bundle contains no extension
protocol or UI, it serves no extension-connect route, and the extension manifest
cannot connect to or inject into its origin. Isolation verification checks all
of these boundaries in the built production artifacts.

Sentinel's web artifact has no extension-connect route. The extension manifest
accepts external connections only from `simple.nokey.sh` and excludes
`sentinel.nokey.sh` from content-script injection. It treats
`simple.meta-secret.io` as a Nook vault app host, with no autofill or website
WebAuthn injection. A browser on the alias has no extension pairing. Simple
never advertises or links to Sentinel in its vault application shell. Sentinel
may offer a one-way link back to Simple for users leaving the quorum-only
product.

## Deployment

- **Production release:** Publish `nokey.sh` as the public site and deploy the
  two vaults to separate Cloudflare Pages projects.
  - Attach and verify both custom domains and their proxied CNAME records.
  - Attach `simple.meta-secret.io` to the same `nokey-simple` project and
    verify it with the identical Simple gate. Each domain's proxied CNAME is
    created in its own Cloudflare zone, `nokey.sh` or `meta-secret.io`.
  - The CI `CLOUDFLARE_API_TOKEN` must read the `meta-secret.io` zone and edit
    its DNS. Otherwise the attach step fails with "Cloudflare zone
    meta-secret.io is not visible to CLOUDFLARE_API_TOKEN".
  - Sentinel, Main, the landing site, and PR previews have no alias.
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
  - Google Drive and iCloud also accept the exact origin
    `https://simple.meta-secret.io`. Register it in the Google OAuth client's
    Authorized JavaScript origins and the CloudKit API token's allowed origins
    before the release that serves it.
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
