# Simple and Sentinel Application Isolation

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

Production releases publish `nokey.sh` as the public site and deploy the two
vault projects to separate Cloudflare Pages projects. Release automation
attaches and verifies both custom domains and their proxied CNAME records.

Main deploys the same three artifacts independently. The landing and both vault
custom domains point to the `development` branch aliases of their Pages
projects, so Main cannot replace any project's production branch. PRs deploy
branch `pr-<number>` to all three projects and expose only Cloudflare-native
aliases; they do not create branded DNS records.

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
an RP across the apps: each ceremony uses the current hostname as its RP ID.
The two stable Main vault origins are registered with browser providers. PR
aliases are deliberately provider-disabled and receive no OAuth credentials.

Rollback is a new immutable release from the selected known-good commit; tags
are never moved. Run the production release workflow with a new semantic
version and the known-good ref. The workflow redeploys all three surfaces and
refuses a mixed release where either vault hostname reports a different commit.

Cross-app links call the Rust/WASM lock path before navigation and carry no
vault payload, provider credential, or session token in the URL.
