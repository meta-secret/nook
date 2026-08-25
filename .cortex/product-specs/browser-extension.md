# Browser Extension Product Spec

## Overview

Status: Implemented direction for #234, #235, #237, #239, #244, #441, and #461.

`nook-web-extension` is the browser integration for Simple Vault. It does not
duplicate the vault application UI. Clicking the extension opens the trusted
toolbar popup. That popup owns extension-device protection and the explicit
Open Simple Vault action. Simple Vault remains the only surface for creating,
importing, browsing, editing, recovering, and administering vaults.

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

These responsibilities form two user-facing components: the selected virtual
identity acting through the extension's protected local device key and its
authorized relationship with a website/origin, then password and
website-passkey integration backed by an authorized Simple Vault. The first
belongs to identity management. The second operates on vault-owned content.
Pairing or trusting a site does not create a vault, and a provider credential
does not authorize decryption. See
[identity-vault-architecture.md](../design-docs/identity-vault-architecture.md).

The extension is a Simple Vault capability. It must never pair with, receive a
grant from, inject a content script into, or open Sentinel Vault. Rust/WASM
application capability checks enforce the vault-type boundary.

## Product Boundary

| Surface                           | Responsibility                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `simple.nokey.sh`                 | Complete vault UI, unlock, consent, device management, recovery, and settings                                 |
| Extension toolbar action          | Create or unlock the extension device; show connection status, pairing, and Open Simple Vault                |
| Extension background/WASM runtime | Local device key, selected identity, encrypted state, sync, domain matching, and fill authorization           |
| In-page auth gate                 | One Rust-approved authentication action plus compact, dismiss, and progress controls                         |
| Content script                    | DOM detection and the minimum selected fill payload; never vault search, crypto, or provider credentials      |

Authenticator items remain standalone.
They are not guessed from an issuer name or silently associated with the current
origin.
The in-page gate opens an extension-controlled picker for every OTP fill.
That picker searches all authenticator items through Rust/WASM.
It shows issuer/account labels only inside the extension document.
It returns the selected opaque item identity to the origin-bound content script.
An empty result stays in the picker.
Vault metadata is not exposed to the website DOM.
Page QR and backup code enrollment uses explicit Pilot actions
(**Add 2FA from this page** / **Save backup codes**).
It uses local decode/extract, WASM validation, and confirmation before any vault
write.
It is never silent page scraping or background scanning.

"No vault UI in the extension" means no second vault-management UI. The toolbar
popup may contain the standard one-time device-protection widget because
WebAuthn needs an extension-owned document and a user gesture. A bounded
extension-owned authenticator picker may show searchable non-secret 2FA
metadata for one explicit fill choice; it cannot create, reveal, edit, delete,
recover, or administer vault items.

## First Run And Approval

1. The user clicks the extension toolbar button and sees the standard
   extension-owned device-protection widget.
2. One user action creates or recovers the separate extension device and
   protects its private key using WebAuthn PRF through Rust/WASM. Existing
   protected devices ask only for their passkey or PIN unlock.
3. The toolbar popup opens the configured Simple Vault `/extension-connect`
   route with the extension runtime id and its public device request. There is
   no website-first enable screen and no detached companion window.
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

### Current Primary Device-Key And Authentication UX

The current implementation calls the extension's installation-specific key a
“device identity.” It is the preferred local device key whenever the approved,
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

- The toolbar always opens the extension-owned menu.
- Before approval, the popup shows device setup or device unlock.
- After unlock, the menu shows the current vault connection and the actions
  that manage that connection.
- The unlocked menu uses one compact Nook and connection-status row.
- It has no hero title, explanatory paragraph, or decorative logo treatment.
- Open Simple Vault is the explicit primary action for a connected vault.
- Pair another vault is the only secondary action for a connected vault.
- Connect to Simple Vault is the explicit primary action before pairing.
- Before pairing, do not show a competing Open Simple Vault action.
- The menu has no Ready or Stay ready destination.
- Completing unlock never opens a detached companion window.
- Grant metadata by itself never produces connected state.
- The popup starts the Simple Vault approval route only after an explicit
  Connect / pair action (or Open Simple Vault).
- The Simple Vault header vault menu lists every local vault in the viewport.
- The vault that currently holds the companion grant shows a connected badge.
- An unlocked vault that is not the connected vault can start pairing from that
  menu.
- The toolbar menu can start pairing another vault while a grant already
  exists.
- Never put vault browsing or management in the toolbar menu.
- Vault management starts only from the toolbar menu's Open Simple Vault
  action.
- Primary popup controls use the same neutral primary tokens as nook-web dark
  mode rather than a separate green button style.

The Simple Vault base URL is build-selected rather than hard-coded:

- production: `https://simple.nokey.sh/`;
- development: `https://simple.dev.nokey.sh/`;
- PR preview: `https://pr-<number>.nokey-simple.pages.dev/`;
- local: `https://localhost:5173/`, served with the repository's locally
  trusted development certificate.

The production, development, local, and each per-PR build have distinct,
deterministic extension ids.
Rebuilding one channel preserves its extension-origin IndexedDB and passkey RP
identity.
Switching channels cannot reuse extension-private state.
The sealed image publishes the tested bundle as a root-level ZIP plus
`extension.json` metadata and a SHA-256 checksum under the matching site
deployment's `/downloads/` path.
PR and development bundles are unsigned developer artifacts.
They must be unzipped and loaded through the browser's extension developer mode.
The supported developer launcher resolves hosted builds from that metadata.
It binds the archive and checksum URLs to the selected deployment origin.
It verifies SHA-256 before extraction.
It activates a release atomically through a stable channel-specific path.
It uses an isolated Nook browser profile.
Brave, Chromium, and Chrome for Testing receive the verified directory through
`--load-extension`.
Branded Google Chrome removed that switch in Chrome 137.
The launcher opens its extension manager instead.
It requires a one-time **Load unpacked** selection of the verified `current`
directory.
Development, production, and every PR number have separate install and profile
directories.
The launcher never modifies or silently installs into the user's normal browser
profile.
Failed downloads, metadata checks, checksum checks, or archive validation leave
the prior active release unchanged.

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
passkey, or second-factor ceremony and offers one safe next action.

The layers have intentionally different responsibilities:

- content scripts are sensors and actuators: they report bounded, non-secret
  structural observations and perform only the selected DOM action;
- `nook-companion-core` is the flight computer: it classifies the workflow, stage,
  progress, allowed next action, approval requirement, and whether Pilot may
  present that action;
- the extension background/offscreen runtime is the control plane: it binds
  requests to the sender tab/origin and holds the unlocked encrypted session;
- the widget is the cockpit HUD: it renders safe state and consent, never vault
  contents or secret material;
- Simple Vault remains the complete management and recovery surface.

Pilot observations cross the Rust/WASM boundary as named evidence enums and
bounded quantities. They do not use positional boolean bags or numeric enum
discriminants. Decisions derived entirely from an observation live on the Rust
observation model and return an exhaustive named state. The widget consumes
the Rust-owned Pilot presentation capability; it does not maintain a second
TypeScript action allowlist. Direct authenticator setup and backup-code pages
submit a bounded enrollment observation through the same background classifier
before Pilot may render the selected enrollment action.

The initial production slice classifies login (including email-first /
username-only steps used by Microsoft, Slack, and similar SSO shells),
signup, password-change, and standalone one-time-code structures through
Rust/WASM.
Username detection uses autocomplete tokens plus identity heuristics
(`loginfmt`, `login_email`, account/email labels).
It still ignores newsletter-style email fields.
Credential matching may use an explicit related-login host allowlist.
A saved `microsoft.com` login can fill on `login.microsoftonline.com`.
It performs explicit login selection/fill/submit and TOTP selection/fill.
It shows a verification-wait state only after a site form was actually
submitted.
A filled-only login or TOTP remains at the current checkpoint for manual review
and submission.
After a login or signup form submit, Nook Pilot stages credentials in extension
memory.
It waits for Rust-classified outcome evidence before offering Save / Update.
Durable writes through the unlocked extension WASM session
(`add_secret` / `replace_secret`) require a Sufficient verdict.
Navigation alone never counts.
Content scripts report only bounded non-secret signals
(`data-nook-auth-outcome`, auth-field presence, SPA mutation, iframe context,
elapsed time).
Site-specific plugins may add markers through that adapter attribute.
They must not scrape secrets or bypass the Rust classifier.
Signup and password-change pages may offer **Generate password** through
Rust/WASM.
Generated values fill only `new-password` fields.
They stay in page memory until an evidence-gated Save / Update.
CAPTCHA, terms acceptance, and email-verification style checkpoints leave Pilot
absent. The user continues those checkpoints manually.
Pilot-guided 2FA enrollment stages an otpauth setup in extension memory after
consent.
It fills the verification code via Rust/WASM.
It encrypts the authenticator only after Sufficient outcome evidence.
Consented backup-code capture follows.
Secrets never appear in the HUD.

The toolbar menu may report the connected vault. It does not report login
detection or readiness. Login detection belongs only to the in-page Nook Pilot
surface.

### Popular-site detection coverage

CI does **not** hit live third-party login pages. Coverage is data-driven:

1. Catalog: [`nook-core/data/popular_login_sites.json`](../../nook-app/nook-platform/nook-core/data/popular_login_sites.json)
   — exactly **1000** password-manager-relevant destinations (`id`, `family`,
   `loginUrl`, `hosts`, `rank`). Thin index only—not duplicated DOM fixtures.
2. Shared shell templates: `nook-web-extension/e2e/mock-auth/fixtures/templates/*.json`
   — **unique** structural auth DOM shapes and quirks (email+password,
   email-first, username-first, tel/phone shells, member/employee/account id,
   PIN, password-then-OTP, enterprise SSO email, Microsoft/Google/Apple
   families, brand specials such as Facebook `aria-hidden-ancestor`). Identical
   shells are never copied per brand.
3. Site→template map: `nook-web-extension/e2e/mock-auth/fixtures/site-shells.json`
   — every catalog id points at a template (`source: capture | research`).
4. Renderer: mock-auth `/template/:id` (unique shells) and `/site/:id`
   (catalog id → template). Legacy paths (`/facebook`, `/google`, …) still
   resolve.
5. Capture / research (local/agent only):
   `expand-popular-login-1000.mjs` rebuilds the catalog map;
   `capture-login-shell.mjs` can open live `loginUrl`s to promote **new**
   shapes into templates. Bot-blocked sites stay on research mappings. CI
   never hits live third parties.
6. Automated gates: catalog length 1000 + unique ranks/ids; every id maps to
   an existing template; Vitest + extension e2e over **each unique template**
   (not one e2e visit per catalog id).

Related host credential matching remains in
[`login_site_hosts.json`](../../nook-app/nook-platform/nook-core/data/login_site_hosts.json).

### In-Page HUD

When a likely login flow is present, the content script may show a Nook-owned
auth HUD near the top-right of the viewport. The HUD follows the same
icon → title → description → primary action pattern as the extension device
form so every site gets a universal authentication surface instead of forcing
users through site-specific login chrome.

Credential-shaped fields are not sufficient by themselves.
At least one visible, enabled control must be able to advance the detected
authentication ceremony.
For an auto-submit second-factor challenge, its visible, enabled one-time-code
input is the advancing control; a separate submit button is not required.
An inert account, profile, newsletter, or settings field must not mount the HUD.

The gate must:

- be visibly Nook-owned and keyboard accessible;
- be draggable so the user can move it away from site chrome;
- support collapsing to a compact Nook mark and expanding again;
- start as the compact Nook mark until the extension confirms that a detected
  login flow has at least one saved login match for the origin;
- start expanded when a saved login matches or when a non-login workflow has a
  safe action;
- preserve current/total progress in the compact state and accessible label;
- support dismissal without blocking the host page;
- show the requesting hostname, Rust-classified workflow, and current step
  without exposing a username, password, TOTP code, setup key, recovery code,
  or provider credential;
- name the exact approved action instead of using a generic continuation label;
- offer a primary Fill saved login action that lists matching logins for the
  page origin, reveals one credential after explicit choice, fills the form,
  and submits;
- when locked, open the trusted toolbar popup when the browser permits it and
  ask the user to unlock there before retrying the action;
- keep Open Simple Vault out of the host-page DOM;
- omit the gate when Rust allows no safe action;
- never request a vault password, recovery secret, or provider credential;
- never silently fill or submit;
- when more than one login matches the page origin, open an extension-owned
  searchable login picker that shows usernames (and host/vault labels) only
  inside the extension document; keep those labels out of the host-page DOM and
  return only the selected opaque item identity to the content script;
- for OTP challenges, open the extension-owned searchable 2FA picker and keep
  issuer/account labels out of the host-page DOM;
- open a browser-native or extension-controlled authorization surface when the
  extension is locked;
- leave full search, creation, editing, and settings to the toolbar menu's Open
  Simple Vault action.

An injected DOM widget is not a trusted place for primary authentication because
the host page can imitate it. Passkey authorization stays browser-native or in
an extension-controlled top-level window. Pilot may propose Create/Use passkey
from Rust policy after an unlocked vault match or a page passkey-control hint;
approval only starts the site's WebAuthn ceremony so the existing consent
chooser remains the user-presence gate. Silent create/assert and automatic
submit stay out of scope. See
[passkey-manager.md](../design-docs/passkey-manager.md).

## Device-Key And Storage Boundary

- **Installation key:** Create an extension-specific Nook device key instead of
  reusing or scraping the `simple.nokey.sh` browser private key.
  - Existing wire fields call it a device identity.
  - The target model treats it as a key acting for a selected virtual identity.
  - Keep its approval and revocation boundary separate to limit blast radius.
- **Runtime ownership:** TypeScript performs browser ceremonies and message
  transport.
  - Rust/WASM owns device options, PRF validation, key wrapping, authorization
    envelopes, vault validation, domain matching, and secret selection.
- **Pairing state:** Pairing metadata is not an independently usable vault.
  - Initial approval transfers the immutable encrypted event log.
  - Rust/WASM rebuilds an extension-owned projection in extension-origin
    IndexedDB.
  - Store no decrypted vault values, event-log contents, or provider credentials
    in browser-vendor storage, ordinary-site content scripts, or logs.
- **Local event bridge:** The website and extension share neither origin nor
  IndexedDB.
  - A dedicated Simple Vault content script bridges typed local-change
    notifications to the extension service worker.
  - Each notification carries the encrypted signed event-log snapshot.
  - Rust validates and idempotently merges the snapshot.
  - This supplies immediate local updates without a sync provider.
  - Sync providers remain responsible for other-device changes.
  - After provider pull, publish the resulting log through the same bridge.
- **Extension unlock:** Wrap the private device key in extension-origin
  IndexedDB with WebAuthn PRF.
  - Event replication may run while it is locked.
  - Decrypting, matching, or filling requires extension-origin unlock.
  - Bind the passkey to the stable extension runtime ID, not the website origin.
- **Projection decryption:** The extension database does not need the website
  private key.
  1. The event log carries a vault-key envelope for the extension public key.
  2. The extension passkey unlocks its age device key.
  3. Rust/WASM opens the envelope and decrypts the local projection.
- **Extension metadata:** Keep non-secret grant and selected-vault status in
  WASM-managed extension-origin Rexie/IndexedDB.
  - Browser-vendor storage is not a vault persistence boundary.
- **Legacy pairing migration:**
  1. Read legacy `chrome.storage.local` pairing rows once.
  2. Validate and copy the selected grant into Rexie.
  3. Delete matching legacy setup and selected-grant rows.
  - Quarantine unselected or incomplete rows while Rexie exists.
  - They have no setup selector and cannot migrate independently.
  - Retry failed cleanup when Rexie matches the completed migration.
  - Remove quarantined rows when the user clears extension browser storage.
  - Use Rexie only for ongoing pairing reads and writes.
- **Extension-first creation:** `/extension-connect` may temporarily use the
  unlocked extension identity.
  1. The website creates a one-time age recipient whose private key remains in
     its WASM manager.
  2. The extension encrypts its age private key and event-signing seed to that
     recipient.
  3. Website Rust/WASM decrypts the envelope and validates the route nonce plus
     advertised device ID and public keys.
  4. Keep adopted material staged until authorization completes.
  5. Write an inactive, resumable genesis transaction with both members, public
     keys, and authorized DEK envelopes.
  6. On verified connect, publish the directory and matching signing seed
     atomically only when its base matches current identity state.
  - Resume partial genesis instead of rewinding event stores.
  - On failure, clear decrypted web state and stop sync.
- **Existing-vault handoff:** Use an explicit Rust handoff state.
  - Publish the extension member and signer only after verified connect
    establishes the vault owner and active signed-roster access.
  - Never place raw private material in URLs, TypeScript, browser-vendor storage,
    website IndexedDB, or logs.
- **Handoff discovery:** Request a new handoff after website reload, including
  arrival at the normal vault route.
  - Discover pairing by local vault store ID.
  - Return a handoff only for a current grant to that exact vault.
  - Honor explicit pairing intent from an authenticated unpaired vault.
  - Do not let a cached different/deleted-vault record hide pairing or trap the
    user in an open-vault loop.
- **Nonce ownership:** Record each nonce, vault store ID, and public device tuple
  in extension-only `chrome.storage.session`.
  - Consume the nonce before sealing.
  - Issue a fresh nonce for later lock/unlock.
  - Only the service worker invokes offscreen secret sealing.
  - After failed adoption, reset device identity and event-log signing state
    before another attempt.
- **Website-data deletion:** Do not revoke or erase the extension device.
  - Keep its encrypted projection and sync-provider grants independently paired.
  - Reopen the same local-folder `vaultStoreId` by discovering that pairing.
  - Show explicit different-vault state for another vault.
  - Switch active vault only after newly validated approval.
  - Invalid approval must not reset the current unlocked session.

When both devices exist, unlock selection is deterministic:

1. use the approved, unlocked extension identity by default;
   - After the website vault locks, keep retrying that adoption until it
     succeeds or the paired unlock wait expires.
   - Do not open the website passkey overlay while the companion still reports
     Unlocked or Locked for that vault.
   - A locked website app key must not block re-adopting that unlocked
     companion identity.
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
- Pairing grant import must not persist quarantined/unauthorized event bytes.
  A rejected import (`event-log-access-not-granted`) rolls back that vault's
  local event projection so a later Approve can succeed. Simple Vault must
  persist the event-signing seed from identity handoff when creating an empty
  event log, keep any durable authorized local signer when the log already has
  events (a reinstalled extension handoff must not overwrite it), and refuse to
  append events the causal graph would quarantine; otherwise unauthorized
  `JoinApproved` reaches the extension or Approve fails as an unauthorized
  actor.
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
