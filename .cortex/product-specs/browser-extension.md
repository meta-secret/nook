# Browser Extension Product Spec

Status: Implemented direction for #234, #235, #237, #239, #244, #441, and #461.

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
- detecting one-time-code fields and filling a Rust-derived TOTP only after the
  user chooses a saved authenticator;
- offering to save or update a credential in the unlocked extension vault
  session after an explicit Save approval (Simple Vault remains the full
  management surface);
- maintaining separately revocable extension device state and an encrypted,
  extension-owned event-log projection for independent fill.
- offering to create and use website passkeys through an explicit consent
  prompt while preserving browser/security-key fallback.

The extension is a Simple Vault capability. It must never pair with, receive a
grant from, inject a content script into, or open Sentinel Vault. Rust/WASM
application capability checks enforce the vault-type boundary.

## Product Boundary

| Surface                           | Responsibility                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `simple.nokey.sh`                 | Complete vault UI, unlock, consent, device management, recovery, and settings                                 |
| Extension toolbar action          | Create or unlock the extension device; companion home always offers stay-ready and optional Open Simple Vault |
| Extension background/WASM runtime | Device identity, encrypted state, sync, domain matching, and fill authorization                               |
| In-page auth gate                 | Universal Continue with Nook gate plus optional open/unlock/select/fill/save actions                          |
| Content script                    | DOM detection and the minimum selected fill payload; never vault search, crypto, or provider credentials      |

Authenticator items remain standalone and are not guessed from an issuer name
or silently associated with the current origin. Until a typed website
association exists, the in-page gate uses non-secret ordinal choices and
requires an explicit selection for every OTP fill. Disambiguating metadata
belongs in a future extension-controlled picker, not the host page DOM. An
empty vault state says that no 2FA code is saved and offers to open Simple
Vault. Page QR and backup code enrollment uses explicit Pilot actions
(**Add 2FA from this page** / **Save backup codes**) with local decode/extract,
WASM validation, and confirmation before any vault write. It is never silent
page scraping or background scanning.

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

### Primary Identity And Authentication UX

The extension identity is the default device identity whenever the approved,
unlocked extension is available. Opening Simple Vault from the extension,
refreshing the page, locking and reopening the vault, or navigating within the
site must not prompt for a second website passkey. The site requests a fresh
encrypted handoff from the extension and uses that identity only in WASM memory.

This rule applies to both supported starting points:

- **Extension-first vault:** the unlocked extension identity creates the vault.
  The vault is encrypted for the extension device, and the site continues to
  request a fresh extension handoff after a refresh or explicit lock.
- **Existing website vault:** the unlocked website device approves the
  extension as another authorized device. Rust adds a vault-key envelope for
  the extension public key. After approval, the extension identity becomes the
  preferred local unlock path while the website device remains a fallback.

The extension and website are different WebAuthn relying-party origins. They
cannot share one passkey credential or silently create an independently usable
website passkey from an extension ceremony. Therefore:

- normal extension-first setup performs only the extension passkey ceremony;
- a separately usable website fallback exists only when the website already has
  a protected device or the user explicitly enrolls one later;
- enrolling that fallback requires one website-origin passkey or PIN ceremony;
- generating website keys without independently protecting their private
  material does not count as a backup and must not be presented as one.

This avoids double authentication in the primary flow without making a false
recovery promise. If the extension is deleted before a website fallback or
another recovery method exists, the site cannot reconstruct the extension
private identity.

## Toolbar Behavior

- The toolbar always opens the extension-owned launcher.
- Before approval, the popup shows device setup or device unlock. Completing
  that action lands on a companion-home choice: connect/pair with Simple Vault,
  open Simple Vault, or stay ready without opening a vault tab.
- After a grant and usable encrypted event-log projection are persisted, unlock
  or a ready session shows the same companion home: stay ready for site auth,
  with Open Simple Vault as an explicit secondary option. Grant metadata by
  itself never produces connected state, and a connected unlock never auto-opens
  Simple Vault.
- The popup starts the Simple Vault approval route only after an explicit
  Connect / pair action (or Open Simple Vault).
- Never put vault browsing or management in the launcher.
- Management actions originating from the widget open the corresponding Simple
  Vault route rather than recreating that interface in the extension.
- Primary popup controls use the same neutral primary tokens as nook-web dark
  mode rather than a separate green button style.

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
extension. Autofill and website-WebAuthn content scripts exclude every Simple
and Sentinel Nook host (production, development, and PR previews), not only the
build's configured Simple origin, so a mismatched channel never shows the
in-page auth gate on vault apps. The Simple Vault bridge content script remains
bound to the configured Simple origin only.

## Nook Pilot Authentication Control Plane

The in-page auth gate is the visible HUD for **Nook Pilot**, an
extension-owned authentication control plane. Nook Pilot follows the reusable
workflow shape `Observe -> Understand -> Propose -> Approve -> Act -> Verify ->
Save`. It reports where the user is in a login, signup, password-change,
passkey, or second-factor ceremony and offers one safe next action plus manual
takeover.

The layers have intentionally different responsibilities:

- content scripts are sensors and actuators: they report bounded, non-secret
  structural observations and perform only the selected DOM action;
- `nook-core` is the flight computer: it classifies the workflow, stage,
  progress, allowed next action, and approval requirement;
- the extension background/offscreen runtime is the control plane: it binds
  requests to the sender tab/origin and holds the unlocked encrypted session;
- the widget is the cockpit HUD: it renders safe state and consent, never vault
  contents or secret material;
- Simple Vault remains the complete management and recovery surface.

The initial production slice classifies login, signup, password-change, and
standalone one-time-code structures through Rust/WASM. It performs explicit
login selection/fill/submit and TOTP selection/fill. It shows a
verification-wait state only after a site form was actually submitted; a
filled-only login or TOTP remains at the current checkpoint for manual review
and submission. After a login or signup form submit, Nook Pilot stages
credentials in extension memory and waits for Rust-classified outcome evidence
before offering Save / Update. Durable writes through the unlocked extension
WASM session (`add_secret` / `replace_secret`) require a Sufficient verdict —
navigation alone never counts. Content scripts report only bounded non-secret
signals (`data-nook-auth-outcome`, auth-field presence, SPA mutation, iframe
context, elapsed time). Site-specific plugins may add markers through that
adapter attribute; they must not scrape secrets or bypass the Rust classifier.
Signup and password-change pages may offer **Generate password** through
Rust/WASM; generated values fill only `new-password` fields and stay in page
memory until an evidence-gated Save / Update. CAPTCHA, terms acceptance, and
email-verification style checkpoints force Take over. Pilot-guided 2FA
enrollment stages an otpauth setup in extension memory after consent, fills the
verification code via Rust/WASM, and encrypts the authenticator only after
Sufficient outcome evidence. Consented backup-code capture follows; secrets
never appear in the HUD.

### In-Page HUD

When a likely login flow is present, the content script may show a Nook-owned
auth HUD near the top-right of the viewport. The HUD follows the same
icon → title → description → primary action pattern as the extension device
form so every site gets a universal authentication surface instead of forcing
users through site-specific login chrome.

The gate must:

- be visibly Nook-owned and keyboard accessible;
- be draggable so the user can move it away from site chrome;
- support collapsing to a compact Nook mark and expanding again;
- preserve current/total progress in the compact state and accessible label;
- support dismissal without blocking the host page;
- show the requesting hostname, Rust-classified workflow, current step, and
  manual takeover without exposing a username, password, TOTP code, setup key,
  recovery code, or provider credential;
- offer a primary Continue with Nook action that lists matching logins for the
  page origin, reveals one credential after explicit choice, fills the form,
  and submits; when locked, open the companion launcher and ask the user to
  unlock then continue again;
- keep Open vault as an optional secondary action;
- never request a vault password, recovery secret, or provider credential;
- never silently fill or submit;
- show only contextual accounts returned by the background/WASM boundary when
  matched-account fill is available, using non-secret ordinal choices in the
  page DOM rather than usernames, issuer names, or account labels;
- open a browser-native or extension-controlled authorization surface when the
  extension is locked;
- open Simple Vault for full search, creation, editing, and settings.

An injected DOM widget is not a trusted place for primary authentication because
the host page can imitate it. Passkey authorization stays browser-native or in
an extension-controlled top-level window. Future auth-agent automation
(automatic passkey create or sign-in) is policy-gated and tracked separately.

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

The extension database does not need the website private key. Its canonical
encrypted event log contains the vault-key envelope addressed to the extension
public key. The extension passkey unlocks the extension age identity, and
Rust/WASM uses that identity to open the envelope and decrypt the local
projection. `chrome.storage.local` may retain only non-secret grant and status
metadata; the wrapped private identity and encrypted vault projection remain in
extension-origin IndexedDB.

The `/extension-connect` creation path may temporarily use the unlocked
extension identity. The website first creates a one-time age recipient whose
private key remains inside its WASM manager. The extension encrypts its age
private key and event-signing seed to that recipient; the website's Rust/WASM
boundary decrypts the envelope, validates the route nonce and advertised
device id/public keys, and keeps the adopted material only in memory. Raw
private material never appears in URL parameters, TypeScript values,
`chrome.storage.local`, website IndexedDB, or logs. Reloading the website
requests a new handoff from the unlocked extension, including when the user
arrived at the normal vault route rather than `/extension-connect`. The website
discovers the pairing by the local vault store id; the extension returns a
handoff only when it holds a current grant for that exact vault. The extension
records each issued nonce, vault store id, and public device tuple in
extension-only `chrome.storage.session`, consumes it before sealing, and returns
a freshly issued nonce for a later lock/unlock. Only the service worker may
invoke the offscreen secret-sealing command. A failed website adoption resets
both device identity and event-log signing state before another authorization
attempt.

When both devices exist, unlock selection is deterministic:

1. use the approved, unlocked extension identity by default;
2. if the extension is locked, the user may unlock it from the toolbar and
   retry; the website must not attempt an extension-origin WebAuthn ceremony;
3. if the extension is locked, unavailable, revoked, or cannot unlock, offer
   the website's protected device as the fallback when one exists;
4. if no independent website device or recovery method exists, explain that the
   extension is required rather than showing an unrelated new-passkey setup.

The launcher does not become a vault browser. Website passkey prompts may list
the approved vaults and matching RP accounts returned by Rust/WASM because that
selection is scoped to one active browser ceremony.

## Website Passkeys

The page-world adapter wraps non-conditional WebAuthn `create` and `get` calls.
An isolated content script asks the service worker for eligible vaults/accounts
and renders an explicit Nook choice. Conditional mediation and unavailable or
locked Nook sessions use the original browser WebAuthn implementation.

The service worker binds each request to its exact tab, frame, sender origin,
and RP. The offscreen manager opens only a currently approved Simple Vault
grant. Rust/WASM owns the complete authenticator operation and commits the
encrypted event before a public response returns. See
[passkey-manager.md](../design-docs/passkey-manager.md) for ceremony rules,
counter convergence, and the threat model.

## Consent

Consent is shown only on `simple.nokey.sh` after normal vault unlock. User-facing
permissions describe actions instead of implementation details:

- suggest logins for the current website;
- fill a selected login;
- offer to save new or changed credentials;
- optionally synchronize the encrypted local extension state in the background.
- save and use website passkeys for the requesting RP.

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
