# Browser Extension Product Spec

Status: Active direction for #234, #235, #237, and #244.

`nook-web-extension` is the browser integration for Simple Vault. It does not
duplicate the vault application UI. On first run, clicking the extension opens
the standard device-protection widget inside the trusted toolbar popup. After
the extension device exists, the popup sends its public keys directly to the
configured Simple Vault deployment, which remains the only surface for creating,
importing, unlocking, browsing, editing, recovering, and administering vaults.

The extension owns browser-only responsibilities:

- detecting login opportunities;
- rendering a small contextual Nook widget on sites;
- requesting domain matches from its background/WASM runtime;
- filling a credential after explicit user action;
- offering to save or update a credential by opening Simple Vault;
- maintaining separately revocable extension device state and an encrypted,
  extension-owned event-log projection for independent fill.

The extension is a Simple Vault capability. It must never pair with, receive a
grant from, inject a content script into, or open Sentinel Vault. Rust/WASM
application capability checks enforce the vault-type boundary.

## Product Boundary

| Surface                           | Responsibility                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `simple.nokey.sh`                 | Complete vault UI, unlock, consent, device management, recovery, and settings                            |
| Extension toolbar action          | Create or unlock the extension device before approval; show “Open Simple Vault” afterward                |
| Extension background/WASM runtime | Device identity, encrypted state, sync, domain matching, and fill authorization                          |
| In-page widget                    | Contextual open/unlock/select/fill/save actions only                                                     |
| Content script                    | DOM detection and the minimum selected fill payload; never vault search, crypto, or provider credentials |

"No vault UI in the extension" means no second vault-management UI. The toolbar
popup may contain the standard one-time device-protection widget because
WebAuthn needs an extension-owned document and a user gesture. It contains no
vault picker, unlock, secrets, settings, or device administration.

## First Run And Approval

1. The user clicks the extension toolbar button and sees the standard
   extension-owned device-protection widget.
2. One user action creates or recovers the separate extension device and
   protects its private key using WebAuthn PRF through Rust/WASM. Existing
   protected devices ask only for their passkey or PIN unlock.
3. The popup immediately opens the configured Simple Vault `/extension-connect`
   route with the extension runtime id and its public device request. There is
   no website-first enable screen and no second extension window.
4. The user creates, imports, or unlocks the full Simple vault on the website.
   When creating a vault from this route, the unlocked extension sends its age
   identity and matching event-signing seed in a one-time, nonce-bound age
   envelope. Rust/WASM adopts that identity only for the website session, so
   the website does not create or request a second passkey-protected device.
5. Simple Vault shows explicit consent and approves the extension as a vault
   device through the Rust/WASM authorization boundary.
6. Simple Vault sends the approved grant together with the canonical encrypted,
   signed event log. The extension validates and imports it through Rust/WASM
   into extension-origin IndexedDB.
7. The extension becomes “connected” only after the imported graph contains a
   current, non-revoked approval and key envelope for its protected device.

The website origin is a transport and UI boundary, not cryptographic authority
by itself. An unlocked, authorized vault device creates the approval event.

## Toolbar Behavior

- The toolbar always opens the extension-owned launcher.
- Before approval, the popup shows device setup or device unlock. Completing
  that action opens Simple Vault with the resulting public keys.
- After a grant and usable encrypted event-log projection are persisted, the
  action becomes “Open Simple Vault” and opens the configured Simple Vault home
  route. Grant metadata by itself never produces connected state.
- The popup starts the Simple Vault approval route only after an explicit
  device create, recover, or unlock action.
- Never put vault browsing or management in the launcher.
- Management actions originating from the widget open the corresponding Simple
  Vault route rather than recreating that interface in the extension.

The Simple Vault base URL is build-selected rather than hard-coded:

- production: `https://simple.nokey.sh/`;
- development: `https://simple.dev.nokey.sh/`;
- PR preview: `https://pr-<number>.nokey-simple.pages.dev/`;
- local: `https://localhost:5173/`, served with the repository's locally
  trusted development certificate.

The production, development, local, and each per-PR build have distinct,
deterministic extension ids. Rebuilding one channel preserves its
extension-origin IndexedDB and passkey RP identity; switching channels cannot
reuse extension-private state. The sealed image publishes the tested bundle as
a root-level ZIP plus `extension.json` metadata and a SHA-256 checksum under the
matching site deployment's `/downloads/` path. PR and development bundles are
unsigned developer artifacts and must be unzipped and loaded through the
browser's extension developer mode.
The supported developer launcher resolves hosted builds from that metadata,
binds the archive and checksum URLs to the selected deployment origin, verifies
SHA-256 before extraction, and activates a release atomically through a stable
channel-specific path. It uses an isolated Nook browser profile. Brave,
Chromium, and Chrome for Testing receive the verified directory through
`--load-extension`. Branded Google Chrome removed that switch in Chrome 137, so
the launcher opens its extension manager and requires a one-time **Load
unpacked** selection of the verified `current` directory. Development,
production, and every PR number have separate install and profile directories;
the launcher never modifies or silently installs into the user's normal browser
profile. Failed downloads, metadata checks, checksum checks, or archive
validation leave the prior active release unchanged.

Interactive local development uses HTTPS so passkeys, CloudKit, OAuth, and
extension-to-site messaging run under production-like secure-context rules.
The extension page itself remains a `chrome-extension://` origin. Its WebAuthn
option builders omit `rp.id` / `rpId` so Chromium selects the isolated
extension RP ID; the Simple Vault website supplies `localhost` explicitly.
Internal Playwright tests may continue to use loopback HTTP when real browser
identity and provider ceremonies are stubbed.

The manifest and runtime authorization bind each deployed extension to the
matching isolated Simple origin. Sentinel origins cannot message or approve the
extension.

## In-Page Widget

When a likely login flow is present, the content script may show a compact Nook
widget near the top-right of the viewport.

The widget must:

- be visibly Nook-owned and keyboard accessible;
- support dismissal without blocking the host page;
- never request a vault password, recovery secret, or provider credential;
- never silently fill or submit;
- show only contextual accounts returned by the background/WASM boundary;
- open a browser-native or extension-controlled authorization surface when the
  extension is locked;
- open Simple Vault for full search, creation, editing, and settings.

An injected DOM widget is not a trusted place for primary authentication because
the host page can imitate it. Passkey authorization stays browser-native or in
an extension-controlled top-level window.

## Device And Storage Boundary

The extension creates its own Nook device identity instead of reusing or
scraping the `simple.nokey.sh` browser device private key. This provides a
distinct approval/revocation boundary and limits compromise blast radius.

TypeScript performs browser ceremonies and message transport. Rust/WASM owns
device option construction, PRF validation, key wrapping, authorization
envelopes, vault validation, domain matching, and secret selection.

Pairing metadata is not equivalent to an independently usable vault. Initial
approval transfers the immutable encrypted event log, and Rust/WASM rebuilds
the extension-owned projection in extension-origin IndexedDB. No decrypted
vault values, event-log contents, or provider credentials may be stored in
`chrome.storage.local`, exposed to ordinary-site content scripts, or written to
logs.

The website and extension cannot share an origin or an IndexedDB database. A
dedicated content script on the configured Simple Vault origin bridges typed
local-change notifications from the page to the extension service worker. Each
notification carries the encrypted signed event-log snapshot; Rust validates
and idempotently merges it. This gives the extension immediate local updates
without requiring a sync provider. Sync providers remain responsible for
global changes from other browsers/devices; after a provider pull, Simple Vault
publishes the resulting event log through the same local bridge.

The extension private device identity stays separately wrapped in
extension-origin IndexedDB by WebAuthn PRF. Event replication may occur while
that identity is locked, but decrypting, matching, or filling requires an
extension-origin unlock ceremony. The passkey is bound to the stable extension
runtime id, not to the Simple Vault website origin.

The `/extension-connect` creation path may temporarily use the unlocked
extension identity. The website first creates a one-time age recipient whose
private key remains inside its WASM manager. The extension encrypts its age
private key and event-signing seed to that recipient; the website's Rust/WASM
boundary decrypts the envelope, validates the route nonce and advertised
device id/public keys, and keeps the adopted material only in memory. Raw
private material never appears in URL parameters, TypeScript values,
`chrome.storage.local`, website IndexedDB, or logs. Reloading the website
requires a new handoff from an unlocked extension.

For the same reason, the launcher does not yet show an active-vault selector.
Once #244 supplies multiple usable encrypted extension projections, the
launcher may list approved vaults and let the user select which projection the
background runtime uses. A list of grant names alone would falsely imply that
the extension can already unlock, query, and fill from those vaults.

## Consent

Consent is shown only on `simple.nokey.sh` after normal vault unlock. User-facing
permissions describe actions instead of implementation details:

- suggest logins for the current website;
- fill a selected login;
- offer to save new or changed credentials;
- optionally synchronize the encrypted local extension state in the background.

Background sync-provider access is separate and opt-in. Provider secrets are
re-sealed for the extension device before leaving the approving vault session.

## Revocation And Failure

- Closing the popup or vault approval route leaves the extension unpaired; the
  toolbar returns to device setup or device unlock.
- A denied or malformed request adds no device and transfers no vault state.
- A replicated `DeviceRevoked` event clears connected state, disables
  matching/filling, and removes the stale grant metadata.
- Rotation requires a new device request and approval.
- Sentinel requests fail in Rust/WASM even if UI or transport guards regress.

## Delivery Slices

- This direction replaces the vault popup with extension-owned device setup,
  keeps vault approval in Simple Vault, and establishes the in-page widget.
- The encrypted event-log import and live website-to-extension projection are
  implemented. Extension unlock/query, sealed provider use, and independent
  background provider sync remain the next runtime slice.
- #237 owns matched-account selection and explicit fill behavior once the
  extension runtime can query its authorized encrypted state.
