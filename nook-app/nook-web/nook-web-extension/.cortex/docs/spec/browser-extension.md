# Browser Extension Product Spec

## Overview

Status: Implemented direction for #234, #235, #237, #239, #244, #441, and #461.

`nook-web-extension` is the browser integration for Simple Vault. It does not
duplicate the vault application UI. On first run, clicking the extension opens
the standard device-protection widget in an extension-owned authentication tab.
The toolbar and locked Pilot action use the same extension authentication
component in the initiating normal window. A launcher reuses only a tab whose
intent matches the requested action; it leaves an open tab with another intent
untouched and opens the requested intent in a separate tab in that window.
After the extension device exists, the tab sends its public keys directly to the
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

These responsibilities form two user-facing components: the selected virtual
identity acting through the extension's protected local device key and its
authorized relationship with a website/origin, then password and
website-passkey integration backed by an authorized Simple Vault. The first
belongs to identity management. The second operates on vault-owned content.
Pairing or trusting a site does not create a vault, and a provider credential
does not authorize decryption. See
[identity-vault-architecture.md](../../../../../nook-platform/.cortex/docs/architecture/identity-vault-architecture.md).

The extension is a Simple Vault capability. It must never pair with, receive a
grant from, inject a content script into, or open Sentinel Vault. Rust/WASM
application capability checks enforce the vault-type boundary.

## Product Boundary

- **`simple.nokey.sh`**
  - **Responsibility:** Complete vault UI, unlock, consent, device management, recovery, and settings
- **Extension toolbar action and Pilot lock entry**
  - **Responsibility:** Open or focus the shared extension-owned authentication
    tab; create or unlock the extension device there and show localized return
    guidance for Pilot
- **Extension background/WASM runtime**
  - **Responsibility:** Local device key, selected identity, encrypted state, sync, domain matching, and fill authorization
- **In-page auth gate**
  - **Responsibility:** Universal Continue with Nook gate plus optional open/unlock/select/fill/save actions
- **Content script**
  - **Responsibility:** DOM detection and the minimum selected fill payload; never vault search, crypto, or provider credentials

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
**Add 2FA from this page** follows the
[authenticator enrollment eligibility contract](../../../../../nook-platform/nook-core/.cortex/docs/spec/authenticator-items.md#browser-enrollment-capture).
The content script supplies visible media and nearby visible setup instructions
to the `nook-companion-core` classifier through `nook-companion-wasm`.
Square media or QR labels alone do not enable the action.
QR decoding begins only after the trusted action click.

"No vault UI in the extension" means no second vault-management UI. The shared
authentication tab contains the standard one-time device-protection widget
because WebAuthn needs an extension-owned document and a user gesture. A bounded
extension-owned authenticator picker may show searchable non-secret 2FA
metadata for one explicit fill choice; it cannot create, reveal, edit, delete,
recover, or administer vault items.

## First Run And Approval

1. The user clicks the extension toolbar button and sees the standard
   extension-owned device-protection widget in the shared authentication tab.
2. One user action creates or recovers the separate extension device and
   protects its private key using WebAuthn PRF through Rust/WASM. Existing
   protected devices ask only for their passkey or PIN unlock.
3. When the user explicitly chooses Connect / pair, the extension opens the
   configured Simple Vault `/extension-connect` route with its runtime id and
   public device request. There is no website-first enable screen, floating
   companion window, or competing toolbar popup.
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

- The toolbar action and Pilot lock entry use the same extension-owned
  authentication component per initiating normal window. The service worker
  focuses an existing tab only when its intent matches the requested action; it
  leaves a different-intent auth tab untouched and opens the requested intent
  in another tab in the source window. It does not focus an auth tab in another
  normal window.
- Existing companion popup windows created by older versions are not closed or
  focused automatically, preserving any in-progress passkey ceremony; the next
  launch opens or focuses the authentication tab in the current normal window.
- Before approval, the tab shows device setup or device unlock. Completing
  that action lands on a companion home that explains the protected browser
  identity, its vault connection, and the actions available next.
- After a grant and usable encrypted event-log projection are persisted, unlock
  or a ready session shows the same companion home. Open Simple Vault is the
  primary management action; pairing another vault is secondary. Closing and
  reopening the tab during the live session lease leaves the companion ready for
  site authentication. Grant metadata by
  itself never produces connected state, and a connected unlock never auto-opens
  Simple Vault.
- The companion home summarizes the current secret total and whether the
  protected extension app key is linked to an authorized Simple Vault. These
  values come from the unlocked Rust/WASM vault projection; unavailable state
  remains visible instead of treating event-log history as a secret count.
- The tab starts the Simple Vault approval route only after an explicit
  Connect / pair action (or Open Simple Vault).
- The Simple Vault header vault menu lists every local vault in the viewport.
- The vault that currently holds the companion grant shows a connected badge.
- An unlocked vault that is not the connected vault can start pairing from that
  menu.
- The companion tab can start pairing another vault while a grant already
  exists.
- Never put vault browsing or management in the launcher.
- Management actions originating from the widget open the corresponding Simple
  Vault route rather than recreating that interface in the extension.
- Authentication-tab controls use the same neutral primary tokens as nook-web dark
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
After a submitted login, Nook Pilot stages credentials in extension memory for
the [submitted-login save opportunity](#submitted-login-save-opportunity).
Signup saves retain their existing Rust-classified outcome requirement.
Their durable writes through the unlocked extension WASM session
(`add_secret` / `replace_secret`) require a Sufficient verdict from
`AuthenticationOutcomeDecision`; navigation alone never counts for that flow.
Content scripts report only bounded non-secret signals
(`data-nook-auth-outcome`, auth-field presence, bounded control labels,
authenticated affordances, SPA mutation, iframe context, elapsed time).
Site-specific plugins may add markers through that adapter attribute.
They must not scrape secrets or bypass the Rust classifier.
Signup and password-change pages may offer **Generate password** through
Rust/WASM.
Generated values fill only `new-password` fields.
They stay in page memory until an evidence-gated Save / Update.
CAPTCHA, terms acceptance, and email-verification style checkpoints force Take
over.
Pilot-guided 2FA enrollment stages an otpauth setup in extension memory after
consent.
It fills the verification code via Rust/WASM.
It encrypts the authenticator only after Sufficient outcome evidence.
Consented backup-code capture follows.
Secrets never appear in the HUD.

The companion tab “Ready / Connected” state means the extension device is
paired to a vault. It is not login detection. Login detection is the in-page
Nook Pilot HUD; the companion may also show a one-line current-tab hint
(“Login form detected on this page” / “No login form detected”).

### Submitted-login save opportunity

Accepted requirement: a submitted login may produce **Save this login?** after
Rust classifies bounded evidence as eligible. This is an opportunity to save
the submitted credential, not proof that an arbitrary server authenticated it.
`LoginSaveOutcomeDecision` is separate from `AuthenticationOutcomeDecision`.
The existing signup and 2FA outcome requirements remain unchanged.

- **Prohibited:** label a generic login transition “confirmed login success,”
  or use unrelated signup or 2FA success to offer a login save.
- **Required:** describe an eligible submitted login as **Save this login?**.
  Preserve the separate success and 2FA verdicts for their existing flows.

#### Capture actual login intent

- Rust classifies trusted native form submission, Enter, or semantic control
  activation within the same login form or container as actual login intent.
  Native submission and Enter do not require a control label.
- A Click uses the existing raw `detailedAdvanceControl` observation for the
  exactly clicked actionable control in the same locally scoped credential
  container. Rust derives credential evidence from the same captured
  fields/history.
  - A semantic submit or scoped activation may qualify, including Continue,
    Next, localized, or icon-only controls without an English login label.
  - Apply the existing auxiliary, reveal, cancel, reset, recovery, registration,
    and destructive-control vetoes. Unsupported ambiguous controls remain
    ineligible; this does not guarantee recognition of every language or icon.
- Support dynamically inserted login forms and current-password fields whose
  visibility toggle changes their input type.
- Typing, focus, or filling alone does not capture a submitted login.
- Exclude newsletter, search, registration, password-change, and multiple-password
  confirmation structures from generic login capture.
- Capture scoped candidate values and raw intent, field/history metadata, time,
  URL, auth presence, and bounded control labels synchronously in the trusted
  event handler.
- Send that capture in the first Plan message before the submitting document
  unloads. Do not wait for a classifier reply before sending the values.
- Background/offscreen owns the received request across the originating
  document's unload. Rust classifies and selects the credential before existing
  memory-only `Map` staging. Preserve the origin/tab/frame/grant/TTL scope and
  explicit Save consent; add no storage, retry, or recovery path.

- **Prohibited:** stage a password from typing alone or combine an Enter event
  in a search box with a password elsewhere. Wait for a classifier reply in the
  submitting document before sending credential values, losing them on unload.
  Capture page facts only after navigation and treat them as the baseline.
  Treat a reveal, cancel, reset, or ambiguous control as submit intent merely
  because it is near a password field.
- **Required:** capture a trusted submit in its dynamically inserted login
  container, including a visible current-password field. A clicked Continue,
  localized, or icon-only control qualifies only through its scoped semantic
  advance observation and Rust's Login classification after the vetoes.
  Send scoped values and that moment's raw facts in the first Plan message
  before unload. Background/offscreen retains ownership while Rust classifies
  and selects before staging; registration with password confirmation remains
  excluded.

#### Classify fresh outcome evidence

- Rust owns the typed eligibility states `Eligible`, `Waiting`, `Rejected`, and
  `Expired` in `LoginSaveOutcomeDecision`.
- A same-origin document transition or URL/history transition may qualify.
  - Require stable absence of authentication fields for at least 750 ms.
  - Reject an auth error, OTP, CAPTCHA, or manual checkpoint.
  - Authenticated UI is optional corroboration for this transition path.
- Evaluate fresh eligible evidence before applying the waiting timeout.
  The existing 8,000 ms budget bounds `Waiting` for outcome evidence from the
  original capture, including the 750 ms stability interval.
- A DOM-only mutation without a route transition requires a newly classified
  authenticated affordance compared with the capture baseline.
  - Removing, hiding, toggling, or disabling fields alone remains `Waiting`.
  - A page with neither a route transition nor a new authenticated affordance
    remains `Waiting`.
- Reject generic iframe outcome evidence. Retain the existing bounded
  explicit-marker login path through its Rust classifier.
- Reclassify fresh page evidence before showing a prompt and again at explicit
  Save. A stale eligible observation does not authorize a later write.
- Preserve the captured workflow in outcome classification. Signup, password
  change, OTP, and manual-checkpoint evidence does not qualify a generic login.
- Keep the original capture baseline unchanged after offering Save. The existing
  two-minute offer TTL governs consent and Save lifetime; the waiting budget
  does not expire an otherwise eligible offer while the user reads it.

- **Prohibited:** field removal on the same route, an already-present account
  link, or an unrelated success marker makes a login eligible. An iframe or
  an OTP challenge supplies generic evidence. A previously eligible page saves
  after a fresh auth error appears.
- **Required:** a same-origin history transition with auth fields absent for
  750 ms may offer Save when no checkpoint remains.
  A same-route mutation qualifies only with a newly classified authenticated
  affordance. Recheck at Save; an auth error rejects the write. If fresh evidence
  remains insufficient after the waiting budget, produce `Expired`.

#### Consent and credential mutation

- Require explicit Save consent before any durable credential write.
- Rust owns create, update, and identical-credential suppression through the
  unlocked vault session. Preserve the password's exact bytes from capture
  through commit.
- `NookVaultManager` reclassifies the fresh `LoginSaveOutcomeObservation` in
  Rust before writing. A TypeScript eligibility guard alone is insufficient.
- Keep passwords out of the HUD and sensitive logs.

- **Prohibited:** an eligible opportunity automatically writes a credential,
  or normalizing password whitespace suppresses a changed password.
- **Required:** offer Save and wait for explicit approval. The Rust manager
  reclassifies fresh eligibility before creating or updating the credential.
  Its exact password bytes determine change; an identical credential causes
  no write. Reading an eligible prompt for more than eight seconds still permits
  Save while fresh evidence qualifies within the existing two-minute TTL.
  Lock or expiry rejects that Save.

#### Pending credential scope and lifetime

- Authorize each pending credential using sender-derived origin, tab, and frame.
- A captured document may navigate within the same origin while retaining that
  tab/frame scope. Another tab or frame cannot load, commit, or clear it.
- Keep the existing offscreen plaintext `Map` staging memory-only with its
  two-minute TTL. Clear it on lock, expiry, dismissal, and replacement.
- Persist no plaintext credential or sensitive log. Add no recovery path for
  an unavailable pending credential.

- **Prohibited:** a second tab on the same origin loads, commits, or clears the
  first tab's pending credential. Browser storage retains its plaintext after
  dismissal or expiry.
- **Required:** the captured tab/frame may continue after a same-origin
  document navigation. Reject another sender's pending operations. Lock,
  expiry, dismissal, or replacement clears the memory-only staged credential.

#### Ephemeral wire rollout

- Extend the Rust-owned `ExtensionSessionRequest` wire with required sender
  `tab_id`/`frame_id`, the existing origin, and initial/pending offer metadata.
- The first Plan carries top-level `capturedValues` through the existing
  sensitive-array copy/wipe path. Its scalar `username`/`password` fields serve
  only the explicit-authentication pre-handler candidate.
- `capture` carries raw intent, fields/history, submission time, URL, bounded
  controls, and explicit-candidate presence. Rust validates counts, bounds, and
  origin before selecting values and deriving baseline source/workflow.
- The Rust-derived capture baseline retains `submitted_at` as
  `CompanionEpochMilliseconds`, validated HTTP(S) `submitted_url`,
  `initial_auth_fields`, and bounded control labels.
- `LoginSubmissionIntent` carries raw context as
  `AuthenticationPageObservationFacts`. Rust derives the canonical
  `AuthenticationWorkflowKind` from the same accumulated field/history
  observations plus that context. Classification returns the canonical workflow
  and capture source. Outcome observations retain the captured workflow.
- Offer metadata pairs the Rust-derived baseline source with a non-secret
  selection: submitted-login field indices or the explicit-authentication
  candidate kind. Rejected captures produce no selection.
- Expose the additive Rust classifier exports through the typed WASM boundary.
  Content scripts supply observations; TypeScript does not decide eligibility.
- Roll out the current extension and runtime together. Do not accept old wire
  shapes through compatibility defaults.
- No durable vault schema or storage migration is required: the changed wire
  and pending metadata are ephemeral. Preserve the existing encrypted vault
  representation and memory-only staging lifecycle.

- **Prohibited:** default missing sender context in an old request, duplicate
  the classifier in TypeScript, or persist staged plaintext as a migration.
  Reuse the Plan's scalar pre-handler candidate as the generic login credential
  instead of Rust's selection from the scoped captured array.
- **Required:** use the current typed request and Rust classifiers together.
  The first Plan copies and wipes the sensitive array through its existing
  path. Rust validates the capture and selects its credential before staging.
  Reject an old request shape and require a fresh current-runtime interaction;
  durable vault storage needs no migration.

### Focused credential opportunities

Accepted slice: retain general URL, page-context, and detected-form recognition.
When whole-page detection is inconclusive, mouse click or keyboard focus on a
Rust-recognized username, email, or current-password field shows the existing Pilot
widget. Rust/WASM owns semantic roles and the typed credential opportunity.
Content scripts report interaction and render that opportunity.

#### Credential eligibility

Ambiguous, unrelated, newsletter, search, OTP, and new-password inputs do not
qualify. Existing signup and password generation remain unchanged.

- **Prohibited:** focus on a new-password, newsletter, search, OTP, unrelated,
  or ambiguous input offers the focused login-fill path.
- **Required:** those inputs remain ineligible. Focus on a recognized
  current-password field may show Pilot; a signup new-password field remains
  eligible only for its existing explicit password-generation flow.

#### Login and recovery context

A CSS-reset wrapper name alone does not classify a password-reset ceremony.
Genuine password-reset and recovery semantics remain distinct from login.

- **Prohibited:** a CSS-reset wrapper turns an email-first login into recovery,
  or the focused login path reclassifies a genuine password-reset ceremony.
- **Required:** the wrapper alone does not change login classification.
  Genuine reset or recovery evidence retains its existing ceremony semantics.

#### Focused selection and target lifetime

- Focus or click alone never fills a field or submits a form.
- When interaction is the sole evidence, Continue opens the existing
  origin-matched credential picker. Explicit selection permits filling only
  the retained exact field and grants no submission authority.
- Preserve that target while focus moves into the widget or picker.
  Invalidate it if the field is removed, disabled, or changes semantic role,
  or if the page origin changes. Existing lock, expiry, cancellation, and
  teardown cleanup also clear the target.

- **Prohibited:** keyboard focus on an inconclusive email-first login fills
  nearby fields or submits after the user selects a login. Moving focus into
  the picker loses the target or selects another field. A removed, disabled,
  role-changed, or different-origin target remains usable after revalidation.
  Lock, expiry, cancellation, or teardown leaves that target available.
- **Required:** focus shows Pilot without filling. Continue opens its existing
  picker; a selected origin-matched login fills only the retained email field
  after revalidation, even while the picker holds focus. Removal, disabling,
  semantic-role change, origin change, lock, expiry, cancellation, or teardown
  invalidates the target, so no field is filled from that retained opportunity.

#### Normally detected forms

A normally detected form retains its explicit picker and full-form fill/submit
behavior with existing origin/workflow revalidation.
The [Google two-step login](#google-two-step-login) requirement below defines
the narrow selection-authorized username-advance exception.

- **Prohibited:** the focused-field limit restricts an independently detected
  login form to one field or removes its explicitly approved submit action.
- **Required:** explicit selection for that detected form retains normal
  full-form filling and separately approved submission after revalidation.

This interaction path is limited to the accepted credential opportunity.
It introduces no separate UI or speculative recovery capability.

### Google two-step login

Accepted requirement: explicit saved-login selection on
`https://accounts.google.com/v3/signin/identifier` authorizes the following
sequence only when the username-only login flow is independently detected.

1. Fill the selected login's username and activate Google's Next control.
2. On the observed Google password challenge, fill that same selected item's
   password once. Support this continuation when the user manually clicks Next
   after selection as well.
3. Require an explicit user action for final password submission.

This exception authorizes only Google's username advance after selection.
It grants no generic automatic submission. A focused-only credential
opportunity remains exact-field fill-only.

- **Prohibited:** selecting a login on Google's identifier step automatically
  submits the later password, chooses another saved login, or grants the same
  continuation to a focused-only opportunity or another site's login.
- **Required:** selection fills the Google username and advances with Next.
  Whether Pilot or the user activates Next, the observed password challenge
  receives the selected item's password once. Final submission awaits explicit
  user action. A focused-only selection fills only its retained exact field.

#### Selected login lifetime

- Between steps, retain only the selected opaque item identity and bounded
  authorization, origin, tab, frame, and document context.
- Reuse existing runtime revalidation before revealing and filling the password.
- Clear the continuation on lock, expiry, cancellation, or teardown.
  Changed source or credential context also clears it, including a user account
  change.
- Keep plaintext limited to each immediate fill. Do not persist credentials,
  log sensitive data, or introduce generic recovery behavior.

- **Prohibited:** retain the decrypted credential between Google's steps or
  continue after lock, expiry, cancellation, teardown, or a context change.
- **Required:** retain only the opaque selection and its bounded context.
  Revalidate before the password fill. A vault lock or user account change before
  the challenge clears that continuation without revealing or filling the password.

### Popular-site detection coverage

CI does **not** hit live third-party login pages. Coverage is data-driven:

1. Catalog: [`nook-core/data/popular_login_sites.json`](../../../../../nook-platform/nook-core/data/popular_login_sites.json)
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
[`login_site_hosts.json`](../../../../../nook-platform/nook-core/data/login_site_hosts.json).

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
  page origin. Reveal one credential after explicit choice and fill a detected
  form. Require explicit submission approval except for the
  [selected Google username advance](#google-two-step-login).
  When locked, open the shared extension authentication tab and keep the host
  page in status/Continue mode.
  After unlock, show localized return guidance and require a fresh Continue click
  with existing origin/workflow revalidation before any page interaction;
- keep Open vault as an optional secondary action;
- never request a vault password, recovery secret, or provider credential;
- never silently fill or submit;
- when more than one login matches the page origin, open an extension-owned
  searchable login picker inside the existing right-side Pilot panel, using the
  dedicated extension-origin `login-picker/index.html` document;
  - show usernames and host/vault labels only inside that document;
  - keep those labels out of the host-page DOM;
  - show explicit search, loading, empty-result, and error states;
  - return only the selected opaque item identity to the content script;
  - continue through the existing origin/workflow revalidation and explicit
    fill/submit operation, subject to the focused-field limit above;
  - preserve existing lock, expiry, cancellation, and teardown cleanup;
- for OTP challenges, open the extension-owned searchable 2FA picker and keep
  issuer/account labels out of the host-page DOM;
- open a browser-native or extension-controlled authorization surface when the
  extension is locked;
- open Simple Vault for full search, creation, editing, and settings.

The inline login picker keeps its existing `requestId` out of the iframe URL
and host-page DOM. Initialization sends it only to the retained child window.
The pending request binds the actual Chrome tab, parent frame/document, and
picker frame/document identities.

- **Prohibited:** put account labels or the request ID in host-page markup, or
  open a separate native login chooser after Continue.
- **Required:** embed the isolated login document in the current Pilot panel
  and return the chosen opaque identity through the bound request.

The temporary pending-login session shape now requires `parentDocumentId` and
`pickerDocument` binding state. Previous process/version records missing these
fields fail closed and are cleared by the existing session lifecycle.
Expired requests remain unavailable. This change needs no durable vault schema
migration and introduces no compatibility or recovery path.

- **Prohibited:** accept an older pending record without its document bindings.
- **Required:** reject and clear that record, then require a fresh Continue
  interaction for a new bound request.

An injected DOM widget is not a trusted place for primary authentication because
the host page can imitate it. Passkey authorization stays browser-native or in
an extension-controlled top-level window. Pilot may propose Create/Use passkey
from Rust policy after an unlocked vault match or a page passkey-control hint;
approval only starts the site's WebAuthn ceremony so the existing consent
chooser remains the user-presence gate. Silent create/assert and automatic
submit stay out of scope. See
[passkey-manager.md](../architecture/passkey-manager.md).

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
2. if the extension is locked, the user may unlock it from the shared extension
   authentication tab and retry; the website must not attempt an extension-origin
   WebAuthn ceremony;
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
[passkey-manager.md](../architecture/passkey-manager.md) for ceremony rules,
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

- Closing the authentication tab does not lock or unpair the extension. The
  decrypted offscreen identity uses a 15-minute renewable lease: successful
  identity handoffs renew it, while status/read/retry operations and tab
  close/reopen do not. Reopening during a live lease remains unlocked. Lease
  expiry, explicit lock, and browser/context restart keep reauthentication
  required; this flow does not reduce any policy-required prompt.
- Closing the vault approval route leaves the extension paired or unpaired
  according to its persisted grant state; the authentication tab reflects that
  state when reopened.
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
