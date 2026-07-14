# Browser Extension Product Spec

Status: Draft for #236.

`nook-web-extension` is a permissioned vault and filling companion. It is not a
temporary view into the open `nokey.sh` page and must not scrape the web app's
IndexedDB. The extension has its own extension-owned storage, its own Nook device
identity, and its own passkey-protected device-key state.

`simple.nokey.sh` remains the full settings, recovery, and grant-management surface.
The extension can fill passwords and sync authorized vault data after pairing,
but device approval, grant rotation, and revocation are managed from `simple.nokey.sh`.

The extension is a Simple Vault capability. It must never pair with, receive a
grant from, inject a content script into, or open a Sentinel Vault. Sentinel
extension approval is rejected by the compiled Rust/WASM application boundary,
not merely hidden by the UI.

## First-Run Goals

- Make clear that setup creates a separate browser-extension device for this
  browser profile.
- Require passkey/device authorization before extension storage can hold a
  wrapped device identity, encrypted vault copy, or sealed sync-provider rows.
- Pair only through `https://simple.nokey.sh/extension-connect`.
- Require normal `simple.nokey.sh` unlock before approving the extension device.
- Show explicit consent scopes for vault access, password filling, and
  sync-provider credential access.
- Explain that closing `nokey.sh` after pairing does not remove extension access;
  the extension remains an authorized device until revoked or rotated.

## Device Identity Decision

The extension creates its own Nook device identity instead of reusing the
`nokey.sh` browser device private key, even when both live in the same browser
profile.

This gives users and the app:

- a distinct approval and revocation boundary;
- a recognizable device label in the device list;
- separate extension storage and passkey authorization;
- a smaller blast radius if extension storage or permissions are compromised.

The extension device private key follows the same protection model as the web
app device key: TypeScript performs the browser WebAuthn ceremony, while
Rust/WASM owns option construction, PRF validation, key wrapping, persistence,
and auth-envelope behavior.

## Extension Popup States

| State | Meaning | Primary UI |
|---|---|---|
| Not set up | No extension device identity is authorized. | `Connect Nook`, with copy that setup creates a passkey-protected extension device. |
| Protect this extension | Device identity setup is in progress, but not paired to a vault. | Passkey authorization copy, device-label preview, and no vault/filling actions. |
| Pair with Simple Vault | Extension has a protected device identity and pairing request. | `Open Simple Vault`, pointing to `https://simple.nokey.sh/extension-connect` with a request nonce and scopes. |
| Pairing failed | The handoff failed or was denied. | Specific failure reason, retry, and reset setup options. |
| Locked | Extension is paired but the device identity is not authorized in this popup session. | Unlock with passkey before showing vaults, sync providers, or fill actions. |
| Ready | Extension is paired and passkey-authorized. | Paired vault list, selected vault, current-page fill actions, and sync status. |
| Revoked | `nokey.sh` has revoked or rotated the extension device grant. | Explain that filling is disabled and offer to pair again. |

The extension must not show decrypted vault values, sync-provider credentials, or
page-fill actions in any state before `Locked -> Ready`.

## Pairing Handoff

When the extension reaches `Pair with Simple Vault`, it opens exactly:

```text
https://simple.nokey.sh/extension-connect
```

The request payload must include:

- a high-entropy nonce or request id;
- extension device public identity;
- requested scopes;
- suggested device label;
- browser, profile, platform, and extension version metadata;
- return channel information for the extension.

The web app rejects missing, expired, replayed, or malformed pairing requests.
If the user is not unlocked, `simple.nokey.sh` shows the normal passkey/device gate and
vault login before the consent screen.

## Consent Screen

`simple.nokey.sh` shows a consent screen before adding the extension as a vault device.
The screen says that Nook is adding an extension/browser-profile device, not
sharing the current page session.

Consent includes:

- selected vaults;
- vault access;
- password filling on visited pages;
- sync-provider credential access, called out separately from vault access;
- device label preview;
- where to revoke later.

Sync-provider credentials are granted only when explicitly selected. Secret
provider fields are resealed for the extension device before persistence in
extension-owned IndexedDB. Content scripts and page DOM state never receive
decrypted provider credentials.

## Device Labels

The default label should be recognizable later in device settings:

```text
Nook Extension - <Browser> profile on <OS>
```

Examples:

- `Nook Extension - Chrome profile on macOS`
- `Nook Extension - Brave profile on Windows`
- `Nook Extension - Firefox profile on Linux`

If the browser profile name is unavailable, omit it rather than guessing.

## Failure And Recovery

Denied permission:
: Keep the protected extension device only if setup finished; let the user retry
  pairing or reset extension setup.

Closed tab:
: Leave the extension in `Pair with nokey.sh` and show that no vault was added.

Invalid pairing request:
: Show `Pairing failed`, discard the request nonce, and require a fresh handoff.

Passkey failure:
: Stay locked or unpaired. Do not load vault data or provider credentials.

Revoked extension device:
: Clear plaintext sessions, disable filling, and show `Revoked`. Keep enough
  metadata to explain the revoked label and offer a fresh pairing.

Rotation:
: `simple.nokey.sh` can rotate or remove the extension device grant from the device
  settings surface. After rotation, the extension must re-pair as a new device.

## Implementation Boundary

This spec intentionally defines the first-run UX and product-security semantics.
Follow-up implementation work must add the actual pairing handshake, extension
device identity persistence, auth envelope creation, sealed provider transfer,
and web-app consent route.
