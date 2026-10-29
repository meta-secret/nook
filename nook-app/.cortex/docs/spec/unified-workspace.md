# Unified identity and vault workspace

## Product statement

Identities and vaults share one workspace. An identity is the account: its
own passkey, its vaults, where they are copied, and the devices that open
them. A vault holds items. Vault pages never show identity management, and
identity management never shows a vault's items. There is no separate
Devices & access page, no header vault switcher, and no
Vault/Admin/Onboard/Settings bottom navigation.

The UI names an identity a **keyring** (Russian: «связка ключей»): it holds
the keys that open its vaults. Code, routes, and these specifications keep
"identity". This browser's own key stays the **device key**, and password
manager imports keep "identities" for their person and address items.

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

- Each identity is a key-tag card: its vault rows, two actions, and a
  compact head. The label and status share one line. The monogram's badge
  shows the key kind, with the key count in its tooltip. The identity's three
  words follow, marked # and explained in their tooltip: every device of the
  identity shows the same words.
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
  **New identity** starts the new-identity flow (below). Beside it, a
  quieter **Check access** opens the check of which identity a passkey or
  backup password opens; the header carries no such button.
- A browser extension asking to connect is answered beside the current
  identity's card, never on a page of its own. While locked, that panel
  unlocks the identity; once unlocked, the approval itself (the extension
  device and the access it asks for, with Approve and Cancel) takes its
  place, and either answer leaves the hub as it is. Both steps draw what the
  extension joins (Extension → keyring → all its vaults, or → this vault
  when the keyring has no cloud sync provider) instead of a sentence, list
  the access as one tile per permission, and fold the device's public keys
  under its fingerprint.
- A locked identity never opens the old Keys page; the URL is kept and
  unlocking resumes it.

### First run

A browser without an identity shows one flow in place of the hub, in the
Simple and unified apps. Sentinel is never offered.

The identity is settled before any vault exists. The step bar counts
Passkey, Sync provider, Identity, and Vault. Each step is one centred column
with a short title. A diagram appears once per new idea, in place of a
paragraph: Your passkey → Your identity → Your vaults on the Passkey step,
This device → Sync provider ← Your other devices on the Sync step. A line of
text stays only for a requirement, a consequence, or a promise.

- **Start**: "Create your identity" and one Create identity button, with no
  subtitle: the Passkey step explains the passkey. Under an "or", the other paths are equal rows, each an
  icon, a short title, and an arrow: **Join with an invite link** opens
  the join screen, **Recover from a sync provider** opens recovery,
  and **Check a passkey or backup password** opens Check access. One fact
  line closes the screen.
- **Recovery**: the provider's identities are listed as identity cards,
  each with one decision (recover it with its passkey, or ask to join) and
  one Apply button, as the
  [identity decisions](../../../nook-platform/.cortex/docs/architecture/provider-identity-decisions.md)
  record describes. A link below checks which passkey or backup password
  opens what, before anything is recovered.
- **Passkey** ("One passkey opens it all"): the diagram says what it is for,
  and one line makes the promise: no password, no Nook server. A new
  passkey, or one made for Nook before, makes this browser's key. Back
  returns to Start.
- **Sync provider**: before sign-in, one line and a small diagram (This
  device → Sync provider ← Your other devices) say what it is for. Google
  Drive signs in, and Nook lists the identities in its Nook folder. Each card has the one action Rust decides from this
  browser's key ([setup action](../../../nook-platform/.cortex/docs/architecture/provider-identity-decisions.md#setup-action)):
  - **Continue** when the key is a member: the identity is added here and
    its provider connects and syncs; setup ends on its vault.
  - **Request to join** when it is not: the Join step follows.
  - **Check again** for a request asked earlier.
  - **Create a new identity** in that Drive, or **Keep it on this browser
    only**, leads to Name.
- **Name**: "Name your identity", one field (empty takes the suggested
  name). Only members see the name. On the Drive path, its first vault is
  created under the same name and the signed-in Drive connects next without
  another sign-in.
- **Vault** (kept on this browser): "Create your first vault?" with the
  vault's name, or **Not now**. Not now ends setup with the identity and no
  vault: the identities page shows its card with New vault, never the Start
  screen again. Managing an identity opens one of its vaults, so a card with
  none offers New vault and Lock only.
- **Join**: "Request sent" with this browser's device id, the value the
  approving device shows. Check again reads the answer; there is no polling.
  Back returns to the identities.

### Join (add this device)

The only place a new browser joins an existing identity. One column: what
happens in a sentence, a small diagram (your other device → sync provider →
this device, the reader's own device filled in), where to get the invite
(Devices → Add an app on the other device), the invite link and one-time
passphrase, and Join. It needs a cloud sync provider. An invite link opened
on this device lands here with the link filled in. The waiting-for-approval
state shows on the hub after submitting. Signing in to the invite's provider
is part of joining: an invite kept in iCloud shows the Apple sign-in only
once Join reaches it, never as an option up front.

### Recovery

For a browser with no device left that has the identity: pick the sync
provider that holds the vault, then unlock with a passkey synced to this
device or the vault's backup password. If another device still has the
identity, joining from it is the path instead.

### New identity

Shaped like the first run and shown above the workspace and the locked
screen, since adopting the identity ends the current session midway:
**Name** the identity, **Key** (its own passkey), then "*identity* is ready"
with its first vault's name, or Later. Key is one centred column like the
Passkey step: a short title, one line that each identity has its own
passkey, the diagram Your passkey → *identity* → Your vaults, and Create
new passkey.

Wherever a passkey is created, its form is one button: the device
protection mode and the passkey's name wait under **Passkey options**, since
the defaults suit nearly everyone.

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
  a warning. Adding a provider shows no description: the page title names
  the task, and the sign-in step draws This device → the provider ← Your
  other devices above its sign-in button, with one line that the sign-in
  stays in this browser. Connect & sync does not draw it again.
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
- An identity with no vault is managed the same way. Unlocked, its card's
  Identity row opens its overview; Sync, Devices, Add a device, Keys, and
  Settings open in place of the hub with no vault open, and Back returns to
  the overview. Vaults offers New vault on the card. A provider added there
  is saved and receives the identity's log; the provider's identity list
  treats the identity as the one in use, as it does with a vault open.
  Looking at these pages never creates the identity's log: connecting a
  provider or inviting a device does. Once a provider is added, setup ends
  on the hub with one line that the identity is set up and synced; a vault
  the identity holds that this browser does not opens its panel there.
- A vault of the unlocked identity that this browser does not hold opens
  from its panel: **Open** brings it from the identity's sync provider with
  the key the identity granted this browser. The hub shows no separate
  "joined" banner.
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
