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

## Operations

### Add to this browser

- Preconditions:
  - A passkey re-derived an app key listed as a member of the identity's log.
- Effect:
  - The directory gains the identity under its **original** id, adopted from
    the provider's identity log.
  - The app key is stored under that identity, protected by the same passkey.
  - The identity in use stays selected; the user switches in Identities.
- Gaps today:
  - Passkey recovery is refused once the directory is not empty
    (`IdentityEnrollmentRequired`).
  - A recovered key gets a new identity id instead of its original one.

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
  - The identity is locked here.
- Effect:
  - A self-signed `MemberJoinRequested` from a new app key for that identity.
  - A device of the identity approves it with `MemberApproved`, which carries
    the vault DEKs; the identity then opens here.
- Gaps today:
  - Requests are per vault (`JoinRequested` in each vault log) and grant one
    vault's key, not membership.
  - `MemberJoinRequested` approval has no product flow outside tests.

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
