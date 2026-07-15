# Browser Extension Product Spec

Status: Active direction for #234, #235, #237, and #244.

`nook-web-extension` is the browser integration for Simple Vault. It does not
duplicate the vault application UI. Clicking the extension opens
`https://simple.nokey.sh`, which remains the only surface for creating,
importing, unlocking, browsing, editing, recovering, and administering vaults.

The extension owns browser-only responsibilities:

- detecting login opportunities;
- rendering a small contextual Nook widget on sites;
- requesting domain matches from its background/WASM runtime;
- filling a credential after explicit user action;
- offering to save or update a credential by opening Simple Vault;
- maintaining separately revocable extension device state and, once #244 is
  complete, an encrypted extension-owned vault projection for independent fill.

The extension is a Simple Vault capability. It must never pair with, receive a
grant from, inject a content script into, or open Sentinel Vault. Rust/WASM
application capability checks enforce the vault-type boundary.

## Product Boundary

| Surface | Responsibility |
|---|---|
| `simple.nokey.sh` | Complete vault UI, unlock, consent, device management, recovery, and settings |
| Extension toolbar action | Open Simple Vault; open browser-access setup when the extension is not paired |
| Extension background/WASM runtime | Device identity, encrypted state, sync, domain matching, and fill authorization |
| In-page widget | Contextual open/unlock/select/fill/save actions only |
| Content script | DOM detection and the minimum selected fill payload; never vault search, crypto, or provider credentials |

“No extension UI” means no second vault-management UI. A one-time,
extension-origin device-protection window remains necessary because WebAuthn
cannot run in a Manifest V3 service worker. That window contains only the
passkey action required to protect the extension device key, then returns to
Simple Vault for consent.

## First Run And Approval

1. The user clicks the extension toolbar button.
2. The extension opens `https://simple.nokey.sh/extension-connect` with its
   runtime id.
3. Simple Vault explains browser access and asks the installed extension to
   start device protection.
4. A small extension-origin window creates the separate extension device and
   protects its private key using WebAuthn PRF through Rust/WASM.
5. That window returns to `simple.nokey.sh/extension-connect` with the protected
   device request.
6. The user creates, imports, or unlocks the full Simple vault on the website.
7. Simple Vault shows explicit consent and approves the extension as a vault
   device through the Rust/WASM authorization boundary.
8. The extension receives only the approved, sealed grant and becomes a
   separately recognizable and revocable device.

The website origin is a transport and UI boundary, not cryptographic authority
by itself. An unlocked, authorized vault device creates the approval event.

## Toolbar Behavior

- Unpaired extension: open the browser-access setup route.
- Paired extension: open the Simple Vault home route.
- Never open a miniature vault popup.
- Management actions originating from the widget open the corresponding Simple
  Vault route rather than recreating that interface in the extension.

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

Before #244 is complete, pairing metadata is not equivalent to an independently
usable vault. The durable implementation must import an encrypted vault
projection and sealed provider rows into extension-owned IndexedDB. No
decrypted vault values or provider credentials may be stored in
`chrome.storage.local`, exposed to content scripts, or written to logs.

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

- Closing the setup window leaves the extension unpaired; the toolbar returns
  to browser-access setup.
- A denied or malformed request adds no device and transfers no vault state.
- Revocation clears plaintext sessions, disables matching/filling, and retains
  only non-sensitive metadata needed to explain the state.
- Rotation requires a new device request and approval.
- Sentinel requests fail in Rust/WASM even if UI or transport guards regress.

## Delivery Slices

- This direction removes the vault popup, makes the toolbar open Simple Vault,
  moves setup initiation to the website, and establishes the in-page widget.
- #244 owns encrypted vault import, extension unlock, sealed provider storage,
  and independent sync after the website closes.
- #237 owns matched-account selection and explicit fill behavior once the
  extension runtime can query its authorized encrypted state.
