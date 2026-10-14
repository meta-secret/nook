# Unified identity and vault workspace

## Product statement

Identities and vaults share one workspace. An identity is the account: its
own passkey, its vaults, where they are copied, and the devices that open
them. A vault holds items. Vault pages never show identity management, and
identity management never shows a vault's items. There is no separate
Devices & access page, no header vault switcher, and no
Vault/Admin/Onboard/Settings bottom navigation.

## Pages and routes

- **Identities hub:** `/identities`.
- **Vault (secret list):** `/vault`; `/` and `/app` resolve here.
- **Vault → Import:** `/vault/import`.
- **Identity → Overview:** `/identity`.
- **Identity → Vaults:** `/identity/vaults`; alias `/admin`.
- **Identity → Sync:** `/identity/sync`; alias `/vault/sync`.
- **Identity → Devices:** `/identity/devices`; aliases `/vault/devices` and
  `/onboard`.
- **Identity → Keys:** `/identity/keys`; alias `/devices-access`.
- **Identity → Backup passwords:** `/identity/passwords`; alias
  `/vault/passwords`.
- **Identity → Settings:** `/identity/settings`; alias `/settings`.

- Earlier routes resolve to their current page and the URL is rewritten to the
  canonical path. Query strings and fragments are discarded as before.
- Every route has a static shell alias in Simple, Sentinel, and unified builds
  so hosting serves the app for direct loads.

## Identities hub

- Each identity is a key-tag card: label, monogram, key kind and count,
  status, a short identity fingerprint, its vault rows, and two actions.
- Status is projected from the identity directory: **Unlocked** (the current
  identity with its device key unlocked, with or without an open vault),
  **Locked** (current identity), **Not active here** (stored on this
  browser), or **Other installation**.
- Lock and Unlock act on the identity, never on a vault. **Unlock** asks for
  this device's passkey (or, for an identity protected by a PIN, shows a PIN
  field on the card) and leaves the hub with the card unlocked; **Lock**
  locks it again. A vault row opens that vault (asking for the passkey first
  when the identity is locked). **Use identity** makes a not-active identity
  this browser's own and unlocks it with its passkey. **Manage** unlocks if
  needed and opens the identity's Overview.
- A locked card offers **Use a backup password** when the selected vault has
  one: one field inside the card opens that vault directly. There is no
  separate unlock panel; a running Sentinel quorum ceremony is the only
  panel the hub shows for unlocking.
- When this browser lost an identity's key, the vaults it still stores keep
  opening from their rows (which starts key recovery) and from their backup
  passwords. Local vaults no card lists, or every local vault when the
  identity directory cannot be read, are listed on their own so they always
  open.
- **New vault** on the current identity's card creates a vault for it.
  **New identity** starts the new-identity flow (below).
- A locked identity never opens the old Keys page; the URL is kept and
  unlocking resumes it.

### First run

A browser without an identity shows one flow in place of the hub, in the
Simple and unified apps. Sentinel is never offered.

- **Name**: "Name your first vault", one field (empty takes the suggested
  name) and Create vault. Below it, a distinct card, **Already use Nook on
  another device? Add this device**, opens the join screen. A quiet link,
  **Lost access to your devices? Recover from a sync provider**, opens
  recovery.
- **Key** ("This is you"): the identity is introduced where its passkey is
  made; a preview of its card lists the named vault, with passkey or PIN
  setup beside it. Back returns to the name.
- **Ready**: "*vault* is ready". Setup counts only Name and Key, both done
  here; keeping a copy is offered, not required. Add a sync provider opens
  the picker inside this screen (Back returns to the offer); Not now opens
  the vault. A provider that connects finishes setup.

### Join (add this device)

The only place a new browser joins an existing identity. One column: what
happens in a sentence, a small diagram (your other device → sync provider →
this device, the reader's own device filled in), where to get the invite
(Devices → Add an app on the other device), the invite link and one-time
passphrase, and Join. It needs a cloud sync provider. An invite link opened
on this device lands here with the link filled in. The waiting-for-approval
state shows on the hub after submitting.

### Recovery

For a browser with no device left that has the identity: pick the sync
provider that holds the vault, then unlock with a passkey synced to this
device or the vault's backup password. If another device still has the
identity, joining from it is the path instead.

### New identity

Shaped like the first run and shown above the workspace and the locked
screen, since adopting the identity ends the current session midway:
**Name** the identity, **Key** (its own passkey, with a preview of its card),
then "*identity* is ready" with its first vault's name, or Later.

## Vault page

- The page band shows the vault's name with Import and the browser extension
  control. The extension fills passwords from vaults, so it lives here:
  **Install extension** when it is missing, **Use with extension** when it
  is installed but this vault is not connected (it serves several vaults),
  and an **Extension** tag once it is. There is no identity button on the
  vault page.
- When another device asks to join the identity, a banner above the list
  names it with Approve, a link to Devices, and a refresh.
- A search field, type chips, the item count, and Add sit above a two-pane
  list: items on the left, the selected item's detail sheet on the right. On
  phones the sheet opens under its row. Selecting another item seals the
  previous one again.
- The detail sheet shows each field as a slot. Secret slots stay sealed
  (hatched, masked) until Reveal; revealed passwords and API keys show a
  strength estimate computed by nook-core from length and character mix.

## Identity management

- The rail runs down the left (a bottom bar on phones): the identity on top
  (it opens the hub), then **Overview**, then the identity's parts (**Vaults**,
  **Sync**, **Devices**), then **Security** (**Keys**, **Backup passwords**),
  then **Settings**. Sync shows a dot while the identity is kept only here;
  Devices shows the pending join count or a dot when a second device is the
  next step.
- **Overview** reads the identity as one system. A header carries the
  identity (monogram, name, fingerprint) and its protection ladder, *Only in
  this browser → Copy kept → On several devices*, from nook-core's identity
  health, with the single next step. Below it, three linked tiles in the
  order things flow: Vaults (what it holds) *copied to* Sync (where it is
  copied) *opens on* Devices (where it opens), each with a count, a short list
  and its main action; Add a device waits for a cloud provider. A quiet
  security strip links Keys and Backup passwords.
- **Vaults** creates, renames, and switches the identity's vaults.
- **Sync** mounts providers on the identity. The provider list shows each
  provider once; mounts recorded on the identity but not connected here are
  a warning.
- **Devices** lists the identity's apps (rename, revoke), approves or denies
  join requests, syncs the identity log, and creates invites (Add an app,
  with the same diagram as the join screen, this device filled in).
- **Keys** says what unlocks the identity, one fact per key: how many keys
  and whether that is enough (Add a device and Backup passwords when there
  is only one), then each key with the app it unlocks, where it is kept and
  when it was last used; identifiers sit behind Details. Rename stays for
  this browser's passkey.
- Devices and Sync act on the identity. They need the identity's app key
  unlocked, not an open vault.
- Every vault belongs to exactly one identity. Cards list a vault under the
  identity with a verified access record for it (the current identity first
  when several claim it), and local vaults no identity has opened yet under
  the current identity.
- Back on a management page returns to the page management was entered from
  (the vault or the hub).
- Locking keeps the current route so unlocking resumes it.

## Shell

- The identities hero (live ciphertext, caret, decrypting title) appears only
  on the hub. Every unlocked page shares one framed sheet; nothing inside it
  is a separate card.
- The right column stacks a page band (title, session tag, page actions), the
  scrolling page, and the status line, divided by hairlines.

## Visual language

- Shapes carry roles: key-tag frames for identity cards, tab frames for the
  hero and the access gate's page bar, sheet frames for setup panels, dialogs,
  and the secret detail, nick frames for slots; lists and bands stay square.
  Filters and method choices are monospace chips; the vault's type filter is
  one outlined track.
- Status uses monospace tags with a dot or icon, never coloured pills.
- Guided flows (first run, new identity) share one step bar and a labelled
  Back link above it.
- Live ciphertext is decorative, `aria-hidden`, and stops for reduced motion
  and hidden tabs.

## Related records

- [devices-and-access.md](devices-and-access.md)
- [password-manager.md](password-manager.md)
- [browser-extension.md](../../../nook-web/nook-web-extension/.cortex/docs/spec/browser-extension.md)
