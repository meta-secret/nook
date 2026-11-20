# Identity Decisions on a Sync Provider

## Overview

A sync provider's Nook folder can hold identities other than the one in use.
Passkeys and devices belong to identities, not vaults, so everything the user
decides about what a provider holds is decided per identity. Google Drive
lists linked vaults and devices under their keyring for inspection.

Two screens read the folder. Setup (first run, and adding a sync provider to
the identity in use) gives each identity one [setup action](#setup-action)
that runs at once. The recovery screen has no identity in use. Each
recovery decision button runs its action for one keyring. An S3 location
is read the same way on first run and on the recovery screen, but its
Sync page wizard lists no identities.

On the recovery screen:

- Every provider lists the identities it holds: Google Drive, GitHub, S3,
  iCloud, and a local folder alike.
  - An identity is listed whether it owns several vaults, one, or none.
  - No vault opens on its own, not even a location's only one.
- A location that lists no keyring says none was found there. The user can
  pick another provider.
- An identity recovered or joined there keeps that provider.
  - The provider is saved for it, and its log syncs.
  - The page lands on the identities page with that identity.
  - Its vaults open from its card.

This record owns the rules and the identity operations behind them. The
[identity architecture](identity-vault-architecture.md) owns identity, app key,
and DEK ownership, and the rule that a provider keeps keyrings, not vaults
([recover a keyring from a sync provider](identity-vault-architecture.md#recover-a-keyring-from-a-sync-provider)). The [provider listing](auth-providers.md#what-the-provider-already-holds)
owns what is read from the provider without a key.

## Rules

- **Keyring actions.** Setup and recovery actions target one keyring. The
  linked vault and device rows on a Drive card are read-only.
- **Recovery decisions.** The card offers the actions Rust allows for the
  keyring. Pressing a button runs that action. Other decisions are disabled
  while it runs.
- **Passkey checks.**
  - An explicit passkey check can reveal names in memory. Adding the
    keyring requires a separate action. See
    [the Drive listing](auth-providers.md#what-the-provider-already-holds)
    for its metadata and name sources.
- **Identity boundaries.** A successful add action gives the keyring its
  own entry in this browser.

**Prohibited:** offer "Import as a separate vault" on one vault row while the
same identity offers "Ask to join".

**Required:** group the ways in under the identity. Keep linked details
separate from those actions.

## Decisions by standing

Rust decides each identity's standing and the decisions it allows.

- **This browser** (its app key is a member of the identity's log)
  - No decision: the identity syncs through its mount.
- **Other identity here** (another identity on this browser was granted its
  vaults)
  - No decision: its vaults open from that identity.
- **Opens with a checked passkey** (a checked passkey re-derives a member
  app key)
  - **Add to this browser:** the identity joins this browser's directory as
    its own identity, beside the one in use.
- **Not on this browser** (nothing was checked)
  - On the recovery screen, **Open with my passkey** prompts for a passkey
    to add the keyring. **Ask to join** requests membership.
  - With an identity in use: **Ask to join**.
- **Not opened by the checked passkeys**
  - **Ask to join:** a join request to the identity's devices.
- **Join requested** (the identity's log holds this browser's unanswered
  request)
  - No decision: a device of the identity answers it.
- **Join denied** (a device denied this browser's request)
  - **Ask to join** again.
- **Join approved** (this browser's key is a member; the identity is not
  added here yet)
  - **Finish joining:** add the identity to this browser.

Where this browser may ask to join, or waits on a request it asked, and the
identity's log lists a recovery passphrase, Rust also offers **Recover with
passphrase**, before **Ask to join**.

- Pressing **Recover with passphrase** starts recovery for that keyring.
- This browser's fresh key comes first, as for asking: the device protection
  gate, or a new local identity's key ceremony.
- The words of one of its passphrases are typed next, in place of the list.
- Once Rust accepts them, the identity is added here as after an approved
  join, and the page keeps the provider for it, as for any identity
  recovered there.
- A local folder is a copy of a browser's store, not a connection, so a
  vault the keyring granted opens from its card through the folder's own
  records.
- **Choose another way**, a quiet action beside **Recover**, returns to
  the list and joins nothing.

See [recover a keyring with a recovery passphrase](identity-vault-architecture.md#recover-a-keyring-with-a-recovery-passphrase).

## Setup action

Setup covers first run and adding Google Drive from the Sync page. Rust
derives the keyring's setup action from its standing (`IdentitySetup`).
Pressing the action runs it at once.
The separate passkey check can reveal names in Drive setup. A matching
passkey can also make **Continue** available.

- **This browser, first run:** **Continue** (Finish joining: a passkey made before restores the identity's record without its log or vault keys, so the provider's log and this key's grants come here; then Drive is saved, the log syncs, and a vault the identity granted opens through it, as after an invite; setup ends on the identities page with that vault's panel open beside the card, not inside the vault).
- **This browser, identity in use:** **In use** (no action).
- **Join approved:** **Continue** (Finish joining).
- **Passkey in use:** **Continue** (Add to this browser,
  `addWithPasskeyInUse`). The key is a member, but here it already holds the
  identity in use, which has its own log or vaults, and one key holds one
  identity. One tap of the passkey that protects the key in use (no new
  passkey) wraps a new key for the identity (`PasskeyWrappedLocal`, the same
  PRF input). The key in use then adds that key itself (`member-approved`,
  `same-as` the key in use) at the provider: no other device answers. The
  identity is added beside the one in use, which stays selected. This
  browser's directory lists the key in use under the identity it holds
  only; the added identity's record leaves it out, though its log still lists
  it for the browser that holds the identity with it. The addition is decided
  locally before the provider sees it, and a key in use that is no member is
  refused before the passkey is asked for.
- **Opens with a checked passkey:** **Continue** (Add to this browser).
- **Join requested:** **Waiting** (Check again).
- **Not on this browser, not opened, or join denied:** **Request to join**.
- **Other identity here:** no action.

- Below the list, after an "or", **Create a new identity** is always
  offered. First run names a fresh identity there. With an identity in use,
  it saves that identity on the provider as a new one and connects.
- An identity Continue adds beside the identity in use (Add to this
  browser, or the passkey in use) ends adding the provider there. The
  sign-in is bound to the account's Nook folder and saved for the added
  identity, sealed to its key here (`save_added_identity_providers`), so it
  syncs without another sign-in. Nothing is saved or synced for the identity
  in use, no Sync page shows in between, and the hub says "{identity} was
  added to this browser".
- With an identity in use, **This browser** is that identity, so Rust
  answers `InUse` and its card has no action. On first run nothing is in
  use yet, so the same standing continues on the identity. Another action
  re-reads the folder when it finishes.
- The card's tag says what this browser's passkey is to the identity:
  **In use here** (only with an identity in use), **Member**, **Not a
  member**, **Join requested**, or **Join request denied**.
- A passkey made for Nook before re-derives the same app key, so an identity
  it is a member of reads as **Join approved** with no extra tap. That holds
  only while the key's identity here is still fresh (no log, no vaults, no
  other member). Otherwise it reads as **Passkey in use** and is added under
  a new key the same passkey protects.
- A refusal from Rust reaches the user with its reason after the failed
  action, not as a bare "could not" sentence.
- A new passkey is a member of nothing: every identity asks to join.
- Setup may instead create a new identity. `name_fresh_identity` accepts
  the explicit name while the identity is still fresh. An unlocked active
  app member can rename an established keyring from its **Overview**.
  Both actions publish a
  [signed name](../../../nook-event-log/.cortex/docs/architecture/identity-control-log.md#readable-keyring-names-in-the-signed-log)
  for the actor's own keyring through its mounts.

## Operations

### Add to this browser

- Preconditions:
  - A passkey re-derived an app key listed as a member of the identity's log.
  - The same passkey re-derived the event signer the log lists for that
    member.
- Effect:
  - The directory gains the identity under its **original** id, adopted from
    the provider's identity log.
  - The app key is stored under that identity, protected by the same passkey,
    with the passkey's derived signer.
  - The identity in use stays selected; the user switches in Identities.
    When no identity is in use, the added one is.
- In place today:
  - `add_identity_with_passkey` takes the source, the identity id, and the
    relying party, and asks for one passkey.
  - `PasskeyIdentityAddition` in `nook-core` decides the addition from the
    source's identity log, without passkey recovery.
  - An active member whose listed signer the passkey derives adds the
    identity under its original id, with the members the log lists and the
    key's grant for each vault at its current key epoch.
  - The directory can use the verified readable name. A member can still
    open a historical sealed name during authorized recovery. The directory
    uses the identity words when neither name is available.
  - The identity log, the directory entry, and the keyring entry are written
    in one transaction.
  - A key that is not a member, was revoked, or already belongs to an
    identity here adds nothing. So does a member whose listed signer the
    passkey does not derive.
  - Its vaults open through the identity's mounts, as for any member.
- Gaps today:
  - A member whose signer was minted before passkey-derived signers existed
    cannot be added this way.
  - A member protected by a passkey-wrapped random app key cannot be added
    this way; its app key and signer stay with its installation.

### Ask to join

- Preconditions:
  - The identity is locked here, or a device denied an earlier request.
  - The key that asks is fresh: its local identity has no log, no vaults,
    and no other member, as an invite join requires.
- The key, decided in Rust (`IdentityJoinKey`):
  - **No key unlocked here** (recovery screen): the join waits while the
    device protection gate protects this browser's first key, then asks.
  - **A fresh key is unlocked:** it asks at once.
  - **The key in use belongs to an identity** (Drive setup): Rust stages a
    new local identity for the request. Its key ceremony runs as for Add
    identity, the new identity is adopted, and its key asks.
  - One join waits at a time; the page's other actions stay disabled.
    Leaving the gate or the ceremony leaves the join and asks nothing.
- Effect:
  - A self-signed `MemberJoinRequested` from that app key is written into the
    identity's log at the provider. It carries public keys only.
  - A device of the identity lists the request on its Devices page.
    - **Approve** appends `MemberApproved` with every vault's current DEK
      wrapped to the joiner. Approval for a keyring with a historical
      sealed name retains its authorized delivery to the joiner. A vault
      the approver cannot open refuses the approval.
    - **Deny** appends `MemberJoinDenied`.
  - The listing reads each identity's log against the identity in use and
    its key. The standing says whether the request is pending, denied, or
    approved; a per-vault access request no longer counts.
  - **Finish joining** completes when the user lists again; there is no
    polling.
    - Approved: its fresh local identity takes the identity's **original** id,
      beside any other identity here. The log, membership, and DEKs are
      stored locally, the identity directory is read again, and the page
      follows the identity as after an invite join.
    - If the request is pending or denied, the action reports that standing.
- Implemented:
  - Rust: `IdentityJoinKey`, `ProviderIdentityJoinRequest`,
    `IdentityJoinAnswer`, `IdentityJoinCompletion`, and the log read's
    `ProviderIdentityJoin`.
  - WASM: `begin_identity_join`, `request_identity_join`,
    `approve_identity_join`, `deny_identity_join`, and
    `complete_identity_join`, against the current provider, a Drive account,
    or a local folder.
  - The recovery screen and Drive setup offer **Ask to join** and
    **Finish joining**. The Devices page offers **Approve** and **Deny**.
- Gaps today:
  - Join state is read for the key of the identity in use. A request made
    from a new identity's key shows as asked only while that identity is in
    use, and finishes from there.
  - A waiting join lives with the page: a reload drops it before it asks.

## Presentation

The card follows Nook's matte-steel visual language: tone over borders, one
accent, no pills.

- **Card.** Use one `nk-frame` per identity. The compact Drive card uses a
  key icon. On other providers, the tile shows a person when the identity
  opens here or a lock when it is locked.
- **Header.** Show the identity's words with any available name. Keep the
  standing tag on the recovery screen and the setup tag in setup. Use the
  success tone when the identity opens. On other providers, show available
  device and vault counts in the header.
- **Drive details.** The **Vaults** and **Devices** rows start collapsed.
  Show counts where known. Each row expands to show its linked items or
  its empty or unavailable state. Keep each device's full app ID on one
  line with its signed label when present. See
  [the Drive listing](auth-providers.md#what-the-provider-already-holds)
  for the source of these details.
- **Drive recovery actions.** The first decision Rust allows is the
  primary button. The passkey option leads when available. Put the
  remaining allowed decisions in the overflow menu.
- **Other recovery providers.** Each allowed decision has its own button.
  The first uses the primary style. A passkey, recovery words, or device
  icon indicates the way in. The active action shows a spinner while it
  runs.
- **Checks.** Show **Reveal names** beneath the heading on eligible Drive
  cards. The action checks a passkey for names that require authenticated
  access. Opening, recovering, or joining the keyring requires its own action.

## Invariants

- No provider credential grants identity membership or vault decryption.
- Membership is proven by a member app key, re-derived from a passkey or
  approved by a member.
- No operation rewrites another identity's log or revokes its devices.
- Decision rules and standings are computed in Rust; Svelte renders them.

## Related records

- [Identity, app keys, passkeys, and vault DEKs](identity-vault-architecture.md)
- [Login gate and sync providers](auth-providers.md)
- [Identity control log](../../../nook-event-log/.cortex/docs/architecture/identity-control-log.md)
