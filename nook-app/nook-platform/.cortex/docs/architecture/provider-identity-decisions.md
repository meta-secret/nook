# Identity Decisions on a Sync Provider

## Overview

A sync provider's Nook folder can hold identities other than the one in use.
Passkeys and devices belong to identities, not vaults, so everything the user
decides about what a provider holds is decided per identity. Vaults are listed
under their identity and are never acted on one by one in this step.

This record owns the rules and the identity operations behind them. The
[identity architecture](identity-vault-architecture.md) owns identity, app key,
and DEK ownership. The [provider listing](auth-providers.md#what-the-provider-already-holds)
owns what is read from the provider without a key.

## Rules

- **The identity is the unit.**
  - Each listed identity gets one decision; its vaults are a read-only list.
  - A vault's real name shows once its identity is opened.
- **One decision per identity, mutually exclusive.**
  - The decision defaults to **Leave as is** and can always return to it.
  - Nothing runs when a decision is picked.
- **One action applies the plan.**
  - The step's single button runs every picked decision, in listing order.
  - Its label names the plan, for example "Connect and add 1 identity".
  - While it runs, every other control is disabled.
- **Checks are not decisions.**
  - "Which passkey opens it?" decrypts in memory and changes nothing.
  - It sits beside the decision as a quiet link.
- **Backup passwords stay out of this step.**
  - A backup password opens one vault, never an identity.
  - Recovering a vault with one belongs to Check access.

**Prohibited:** offer "Import as a separate vault" on one vault row while the
same identity offers "Ask to join".

**Required:** the identity offers one segmented decision. Its vaults list their
names and nothing else.

## Decisions by standing

Rust decides each identity's standing and the decisions it allows.

- **This browser** (its app key is a member of the identity's log)
  - No decision: the identity syncs through its mount.
- **Opens here** (a checked passkey re-derives a member app key)
  - **Leave as is**
  - **Add to this browser:** the identity joins this browser's directory as
    its own identity, beside the one in use.
  - **Merge into _current identity_:** its vaults become vaults of the
    identity in use. The other identity is unchanged for its own devices.
- **Locked here** (nothing on this browser opens it)
  - **Leave as is**
  - **Ask to join:** a join request to the identity's devices.
- **Join requested** (the identity's log holds this browser's unanswered
  request)
  - No decision: a device of the identity answers it.
- **Join denied** (a device denied this browser's request)
  - **Leave as is**
  - **Ask to join** again.
- **Join approved** (this browser's key is a member; the identity is not
  added here yet)
  - **Leave as is**
  - **Finish joining:** add the identity to this browser.

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
  - An identity without a sealed name is named by its identity words.
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

### Merge into the current identity

- Preconditions:
  - A passkey re-derived a member app key of the other identity.
  - The identity in use is unlocked, has a control log, and is not the other
    identity.
- Effect:
  - Each vault's DEK is read from the other identity's log with that key.
  - Each vault's events are stored here and listed in the vault registry.
  - The current identity's log records `VaultRegistered` for each vault, wrapped
    to its own members and signed by the current app key.
  - The vault namespaces sync through the current identity's mounts.
  - The other identity's log is not written; its devices keep their access.
- Gaps today:
  - `merge_identity_with_passkey` runs the merge; no Svelte flow calls it yet.
  - It plans every vault before writing: one vault without a current key,
    events, or a matching key epoch fails the whole merge.
  - A vault the current identity already registers is reported, not
    registered again. A vault another identity on this browser keeps fails.
  - The identity sync pushes the new log events; nothing pushes a merged
    vault's events to a mount until that vault is opened and synced.

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
    new local identity named after the one asked. Its key ceremony runs as
    for Add identity, the new identity is adopted, and its key asks.
  - One join waits at a time; the page's other actions stay disabled.
    Leaving the gate or the ceremony leaves the join and asks nothing.
- Effect:
  - A self-signed `MemberJoinRequested` from that app key is written into the
    identity's log at the provider. It carries public keys only.
  - A device of the identity lists the request on its Devices page.
    - **Approve** appends `MemberApproved` with every vault's current DEK
      wrapped to the joiner, and re-seals the identity's name to it. A vault
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
    - Pending or denied: nothing changes, and the plan says why.
- Implemented:
  - Rust: `IdentityJoinKey`, `ProviderIdentityJoinRequest`,
    `IdentityJoinAnswer`, `IdentityJoinCompletion`, and the log read's
    `ProviderIdentityJoin`.
  - WASM: `begin_identity_join`, `request_identity_join`,
    `approve_identity_join`, `deny_identity_join`, and
    `complete_identity_join`, against the current provider, a Drive account,
    or a local folder.
  - Web: the identity plan's **Ask to join** and **Finish joining**, on the
    recovery screen and in Drive setup; the Devices page's Approve and Deny.
- Gaps today:
  - Join state is read for the key of the identity in use. A request made
    from a new identity's key shows as asked only while that identity is in
    use, and finishes from there.
  - A waiting join lives with the page: a reload drops it before it asks.

## Invariants

- No provider credential grants identity membership or vault decryption.
- Membership is proven by a member app key, re-derived from a passkey or
  approved by a member.
- Merging never rewrites the other identity's log or revokes its devices.
- Decision rules and standings are computed in Rust; Svelte renders them.

## Related records

- [Identity, app keys, passkeys, and vault DEKs](identity-vault-architecture.md)
- [Login gate and sync providers](auth-providers.md)
- [Identity control log](../../../nook-event-log/.cortex/docs/architecture/identity-control-log.md)
