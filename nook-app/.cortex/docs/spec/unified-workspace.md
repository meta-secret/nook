# Unified identity and vault workspace

## Product statement

Identities and vaults share one workspace. An identity is the account; its
vaults are opened from it, and every management control is grouped by what it
acts on. There is no separate Devices & access page, no header vault switcher,
and no Vault/Admin/Onboard/Settings bottom navigation.

## Pages and routes

| Page | Route | Earlier route kept as an alias |
| --- | --- | --- |
| Identities hub | `/identities` | — |
| Vault (secret list) | `/vault` (also `/`, `/app`) | — |
| Identity → Keys | `/identity/keys` | `/devices-access` |
| Identity → Vaults | `/identity/vaults` | `/admin` |
| Identity → Settings | `/identity/settings` | `/settings` |
| Open vault → Devices & onboarding | `/vault/devices` | `/onboard` |
| Open vault → Sync | `/vault/sync` | — |
| Open vault → Backup passwords | `/vault/passwords` | — |
| Open vault → Import | `/vault/import` | — |

- Earlier routes resolve to their current page and the URL is rewritten to the
  canonical path. Query strings and fragments are discarded as before.
- Every route has a static shell alias in Simple, Sentinel, and unified builds
  so hosting serves the app for direct loads.

## Identities hub

- Each identity is a key-tag card: label, monogram, key kind and count,
  session status, a short identity fingerprint, its vault rows, and actions.
- Status is projected from the identity directory: **Unlocked** (current
  identity with an open vault), **Locked** (current identity), **Not active
  here** (stored on this browser), or **Other installation**.
- Vault rows list the identity's verified vault access plus, for the current
  identity, every vault in the local catalog. Rows for vaults that are not on
  this browser are shown but cannot be opened.
- Opening a row is the unlock: while locked it selects that vault for the
  access sheet; while unlocked it switches the session to that vault.
- A row shows **Browser extension** when the paired extension holds that
  vault's grant. A note names an extension-paired vault that is not on this
  browser.
- **New vault** (current identity, unlocked) opens Identity → Vaults.
  **New identity** opens Keys with identity creation started.
  **Manage identity** / **Use identity** open Keys focused on that identity.
- While locked, the hub is the login gate: the hero, then the access sheet
  (unlock, create, connect provider, QR join, Sentinel ceremony), then the
  cards. The Keys page stays available before a vault is open.

## Shell

- The identities hero (live ciphertext, caret, decrypting title) appears only
  on the hub. Inner pages use a quiet page bar: identity / context eyebrow,
  page title, session tag, and the page's own actions.
- The vault page bar offers Import, Pair extension (when available), and
  Manage vault.
- Management pages share one grouped navigation element: a rail on wide
  screens and a pinned bottom bar on phones. Import is reached from the vault
  page bar on phones.
- Back on a management page returns to the page management was entered from
  (the vault or the hub). Back on the vault page returns to the hub.
- Locking keeps the current route so unlocking resumes it; locking from the
  hub resumes into the vault that gets unlocked.

## Visual language

- Shapes carry roles: key-tag frames for identity cards, tab frames for the
  hero and page bars, sheet frames for the access sheet and dialogs, nick
  frames for slots and chips; lists and banners stay square with a heavy left
  edge.
- Status uses monospace tags with a dot or icon, never coloured pills.
- Live ciphertext is decorative, `aria-hidden`, and stops for reduced motion
  and hidden tabs.

## Related records

- [devices-and-access.md](devices-and-access.md)
- [password-manager.md](password-manager.md)
