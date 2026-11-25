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
- A locked card has no separate unlock panel; a running Sentinel quorum ceremony is the only
  panel the hub shows for unlocking.
- When this browser lost an identity's key, the vaults it still stores keep
  opening from their rows (which starts key recovery). Local vaults no card lists, or every local vault when the
  identity directory cannot be read, are listed on their own so they always
  open.
- **New vault** on the current identity's card only creates a vault for it.
  **New identity** starts the new-identity flow (below). Beside it, a
  quieter **Check access** opens the check of which identity a passkey
  opens, and **Recover keyring** opens [recovery](#recovery); the header
  carries no such button.
- A browser extension asking to connect is answered beside the current
  identity's card, never on a page of its own. While locked, that panel
  unlocks the identity; once unlocked, the approval itself (the extension
  device and the access it asks for, with Approve and Cancel) takes its
  place, and either answer leaves the hub as it is. Both steps draw what the
  extension joins (Extension → keyring → all its vaults) instead of a
  sentence, list the access as one tile per permission, and fold the
  extension's public keys under its fingerprint. The extension always joins
  the keyring as an app with its own key, never one vault alone.
- A locked identity never opens the old Keys page; the URL is kept and
  unlocking resumes it.

### First run

In Simple and unified, a browser without an identity shows setup in place of
the identities hub. Vault creation here uses the Simple architecture. Each
screen presents the next decision and checks off only a completed action.
Choosing to use multiple devices and creating a vault are separate milestones.
The connection to cloud storage can still be pending or need a retry.

- **Start.** “Your password manager” and “Encrypted on this device” introduce
  **Set up Nook**. The diagram places the encrypted vault inside the browser
  and shows optional sync through the user's own cloud.
  **Open your vault on this device** shows the available paths to **This
  device**. When joining is available, **I have an invite link** opens the
  invite flow for a link from another Nook device. **I have a backup** opens
  recovery from an encrypted backup. Its cue reads “Unlock or request access”.
  On the recovery screen, the keyring and provider determine the available
  methods. The user may use a passkey, enter saved recovery words, or request approval
  from a device that already has access. Each branch opens its flow directly.
  **How Nook works** and **Check a passkey** sit below.
- **Protect this device.** Set up or unlock device protection. Back returns to
  Start. After the device key is ready, **Passkey ready** acknowledges passkey
  protection and **Device protection ready** covers other protection modes.
- **Choose where to use Nook.** “Where will you use Nook?” leads with **Across
  my devices**. The phone and computer exchange encrypted changes through
  **Your cloud**. The user chooses that storage and authorizes each additional
  device separately. The action opens the cloud picker. **On this device**
  goes straight to naming. Back from the picker clears the provider draft and
  returns to the device choice.
- **Choose a cloud.** “Which cloud will connect your devices?”
  offers Google Drive and S3-compatible storage. Drive signs in to list the
  identities in its Nook folder. S3 takes an endpoint, region, bucket, optional
  key prefix, access key ID, and secret access key. **Connect** lists identities
  at that location. When the user first chooses or names a keyring, explain
  that vaults contain passwords and a keyring holds the keys that open them.
- **Choose a keyring.** Rust selects each existing identity's
  [setup action](../../../nook-platform/.cortex/docs/architecture/provider-identity-decisions.md#setup-action).
  Members can continue to their vault. Other devices can request to join or
  check an earlier request. **Create a new keyring** leads to naming and is
  the primary action for an empty S3 location. If recovery finds an empty
  Drive and the user starts a keyring there, setup keeps that sign-in and
  proceeds from device protection to naming.
- **Name a keyring.** An empty field takes the suggested name. Anyone with
  access to the cloud folder can see the current and previous names. For a
  device-only keyring, explain that this applies if the user connects cloud
  storage later. Back returns to the device choice on the local path or to the same
  provider on the cloud path. Creating a keyring on Drive or S3 creates its
  first vault with the same name and connects the selected destination using
  the staged sign-in or S3 connection.
- **First local vault.** **Keyring created** acknowledges the completed local
  setup. **Create your first vault?** offers vault creation or **Not now**.
  Skipping opens the hub with the keyring's card, where the user can create
  a vault later or lock the keyring.
- **Join and recover.** The [identity decisions](../../../nook-platform/.cortex/docs/architecture/provider-identity-decisions.md)
  govern the recovery cards. Each offers a decision and an Apply button.
  A separate check can identify which passkey opens a keyring before recovery.
  After a join request, **Request sent** accompanies the device identifier shown
  to the approving member. **Check again** reads the result on demand. Back
  returns to the provider's identity list.

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

An invite kept in S3 carries the inviter's connection and key inside the
passphrase-protected code, so joining shows no sign-in.

### Recovery

For a browser with no device left that has the identity: pick the sync
provider that keeps the identity, then recover it with a passkey synced to
this device or a recovery passphrase. Its vaults come with it. If another
device still has the identity, joining from it is the path instead. A sync
provider keeps identities, not vaults, as
[recover a keyring from a sync provider](../../../nook-platform/.cortex/docs/architecture/identity-vault-architecture.md#recover-a-keyring-from-a-sync-provider)
states.

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
  **Sync**, **Devices**), then **Security** (**Keys**),
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
  security strip links Keys.
- **Vaults** creates, renames, and switches the identity's vaults.
- **Sync** mounts providers on the identity. The provider list shows each
  provider once; mounts recorded on the identity but not connected here are
  a warning. Adding a provider shows no description: the page title names
  the task, and the sign-in step draws This device → the provider ← Your
  other devices above its sign-in button, with one line that the sign-in
  stays in this browser. Connect & sync does not draw it again.
  - S3-compatible storage is one step, **Connect & sync**. It lists no
    identities and syncs the identity in use.
- **Devices** lists the identity's apps (rename, revoke), approves or denies
  join requests, syncs the identity log, and creates invites (Add an app,
  with the same diagram as the join screen, this device filled in).
- **Keys** says what unlocks the identity, one fact per key: how many keys
  and whether that is enough (Add a device when there is only one), then each key with the app it unlocks, where it is kept and
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
