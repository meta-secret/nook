# Unified identity and vault workspace

## Product statement

Identities and vaults share one workspace. An identity is the account; its
vaults are opened from it, and every management control is grouped by what it
acts on. There is no separate Devices & access page, no header vault switcher,
and no Vault/Admin/Onboard/Settings bottom navigation.

## Pages and routes

- **Identities hub:** `/identities`.
- **Vault (secret list):** `/vault`; `/` and `/app` resolve here.
- **Identity → Keys:** `/identity/keys`; alias `/devices-access`.
- **Identity → Vaults:** `/identity/vaults`; alias `/admin`.
- **Identity → Devices & onboarding:** `/identity/devices`; aliases
  `/vault/devices` and `/onboard`.
- **Identity → Sync:** `/identity/sync`; alias `/vault/sync`.
- **Identity → Settings:** `/identity/settings`; alias `/settings`.
- **Open vault → Backup passwords:** `/vault/passwords`.
- **Open vault → Import:** `/vault/import`.

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
- Opening a row is the unlock: while locked it opens that vault's unlock
  panel inside the identity card, which then spans the full row and is listed
  first; while unlocked it switches the session to that vault.
- The unlock panel names the vault, shows extension pairing status, offers
  this device's keys or a backup password, and explains which identity the
  device keys use. Sentinel vaults show their ceremony in the same panel.
- A row shows **Browser extension** when the paired extension holds that
  vault's grant. A note names an extension-paired vault that is not on this
  browser.
- **New vault** on the current identity's card opens Identity → Vaults while
  unlocked. While locked it opens a New vault panel: create a vault on this
  browser, or import one from a sync provider.
  **New identity** opens Keys with identity creation started.
  **Manage identity** / **Use identity** open Keys focused on that identity.
- A vault always belongs to an identity, so there is no standalone "create
  a vault" sheet. On a browser without an identity, a "Your first identity"
  card holds the first-vault setup; the identity and its key are created
  with that vault.
  - The setup lists the vault paths (Simple, Sentinel), then a sync-provider
    step that is recommended but never gates creation. Providers are mounted
    on the identity, so one added later replicates every vault it owns.
  - Below the steps, under "Already have a vault?", **Join from another
    device** comes first and expands the enrollment-code panel in place.
    **Restore from a sync provider** is the recovery path. Sentinel apps
    join through their own invitation.
  - After creation, the vault page's security guide repeats the sync step
    while the vault lives only in this browser.

  An identity without vaults shows a New vault row that opens the setup
  inside its card, opened straight away when it is the only identity or an
  invitation is pending. Once placed, the setup stays in its card for the
  whole flow.
- While locked, the hub is the login gate: the hero, then any setup flow
  (connect provider, QR join, Sentinel ceremony), then the cards. There is no separate "open a vault" sheet: with several vaults and
  none chosen, a hint asks for a vault row; a plain vault list appears only
  when no identity card lists the browser's vaults. The Keys page stays
  available before a vault is open.

## Vault page

- A search field, type chips, the item count, and Add sit above a two-pane
  list: items on the left, the selected item's detail sheet on the right. On
  phones the sheet opens under its row. Selecting another item seals the
  previous one again.
- The detail sheet shows each field as a slot. Secret slots stay sealed
  (hatched, masked) until Reveal; revealed passwords and API keys show a
  strength estimate computed by nook-core from length and character mix.
- Keys page rows draw each key as a chain: the keeper that holds it, the key
  itself, and the apps it unlocks, joined by labelled arrows, with dates on
  a spec line and a banner when only one key unlocks the identity. Add
  identity is hidden while an identity is being created.

## Shell

- The identities hero (live ciphertext, caret, decrypting title) appears only
  on the hub. Every unlocked page shares one framed sheet; nothing inside it
  is a separate card.
  - The workspace rail runs down the left: the identity (it opens the hub),
    the open vault's pages (Items, Backup passwords, Import), then the
    identity's pages (Keys, Vaults, Devices, Sync, Settings). Devices shows
    the pending join count; Sync shows a warning dot while the identity has
    no provider. On phones the rail becomes a scrolling bottom bar.
  - The right column stacks a page band (title, session tag, Pair extension
    when available), the scrolling page, and the status line, divided by
    hairlines.
  - Setup work (extension install, the security guide) and pending joins are
    bands at the top of the vault page, not banners.
- Devices and Sync act on the identity. They need the identity's app key
  unlocked, not an open vault. Devices issues identity enrollment codes and approves, denies,
  renames, and revokes the identity's apps. Sync mounts providers on the
  identity and shows which vaults each mount replicates.
- Identity → Vaults renames and switches the identity's vaults; it does not
  create them. Vaults are created from the identity card.
- Every vault belongs to exactly one identity. Cards list a vault under the
  identity with a verified access record for it (the current identity first
  when several claim it), and local vaults no identity has opened yet under
  the current identity.
- Back on a management page returns to the page management was entered from
  (the vault or the hub). On phones, where the rail has no identity entry,
  Back on the vault page returns to the hub.
- Locking keeps the current route so unlocking resumes it; locking from the
  hub resumes into the vault that gets unlocked.

## Visual language

- Shapes carry roles: key-tag frames for identity cards, tab frames for the
  hero and the access gate's page bar, sheet frames for setup panels, dialogs,
  and the secret detail, nick frames for slots; lists and bands stay square.
  Filters and method choices are monospace chips; the vault's type filter is
  one outlined track.
- Status uses monospace tags with a dot or icon, never coloured pills.
- Live ciphertext is decorative, `aria-hidden`, and stops for reduced motion
  and hidden tabs.

## Related records

- [devices-and-access.md](devices-and-access.md)
- [password-manager.md](password-manager.md)
