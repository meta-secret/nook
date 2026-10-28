# Identity Control Log

## Overview

**Status:** Implemented in `nook-event-log` (`identity_control`), the
identity mount plan in `nook-core`, and browser storage and sync in
`nook-wasm`.

The identity control log is the replicated membership authority of one
identity. Vaults are built on top of it: a vault belongs to exactly one
identity, and an installation reaches a vault through the identity that owns it.

- **Records:** app-key members, pending joins, revocations, per-vault DEK
  envelopes, and credential-free sync-provider mounts.
- **Mechanics:** the vault log's canonical JSON, Ed25519 actor signatures, and
  causal DAG.
- **Namespace:** its own remote and local namespace. Identity events never
  enter a vault event set, and vault events never enter an identity event set.

See [identity-vault-architecture.md](../../../../.cortex/docs/architecture/identity-vault-architecture.md)
for the identity and vault domain model and
[vault-event-log.md](vault-event-log.md) for the vault log it composes with.

## Required actions

### Sign every identity event as its actor

Each event body binds the identity it belongs to and the member that wrote it.

- **Body fields**
  - `schema_version`: `1`.
  - `identity_id`: the `idn_` identifier of the owning identity.
  - `actor_id`: SHA-256 digest of `actor_signing_public_key`.
  - `actor_signing_public_key`: the writer's Ed25519 key, hex encoded.
  - `parents`: every applicable head the writer observed.
  - `created_at`: audit and UI time only; never merge input.
  - `operations`: one or more control operations.
- **Identity:** the event ID is `sha256u:` over canonical body bytes, as in
  the vault log.
- **Signature:** Ed25519 over the canonical body, verified before insertion.
- **Genesis:** the parentless event holds exactly one `identity-created`
  operation, signed by the founder it names.

Envelope validation rejects a wrong identity, an unsupported schema, a second
genesis, a malformed member tuple, or a bad signature before the event is
indexed.

**Prohibited:** accept a remote `member-renamed` event because its signature
verifies, even though its `identity_id` names a different identity.

**Required:** reject the event at envelope validation. A valid signature proves
who wrote the bytes. It does not move the event into another identity's log.

### Record membership and access as typed operations

The operation set is closed. Every operation is kebab-case tagged on the wire.

- **`identity-created`**
  - Holds the founder's member keys.
- **`member-invited`**
  - Holds a one-time invite: `invite_id`, the invite's Ed25519 public key, and
    `expires_at`.
  - A member issues it with the enrollment code that carries the invite's
    signing seed.
- **`member-joined-by-invite`**
  - Holds the `invite_id`, the joiner's member keys, the invite key's
    signature over the identity id, the invite id, and those member keys, and
    one DEK grant per vault the invite carried.
  - It must be the event's only operation, and its actor must be the joiner's
    own signing key.
  - Each grant names a different vault.
- **`member-join-requested`**, **`member-approved`**, and
  **`member-join-denied`**
  - Earlier builds joined by request and approval. Logs keep these operations
    and still project them, so members admitted that way stay members.
    Current builds never write them.
- **`member-revoked`**
  - Ends an app key's membership and drops its DEK envelopes from the projection.
- **`member-renamed`**
  - Replaces a member's label.
- **`vault-registered`**
  - Binds a vault `store_id` to the identity.
  - Holds the vault's key epoch and DEK envelopes for every active member.
- **`vault-dek-granted`**
  - Wraps one vault key epoch to every active member after a rotation.
  - Also closes the gap for members that joined concurrently with a
    registration.
- **`provider-mounted`** and **`provider-unmounted`**
  - Add or remove one credential-free mount record.
- **`identity-named`**
  - Holds the identity's name sealed to each active member's X25519
    encryption key, one recipient per member.
  - The latest naming replaces any earlier one.

A member tuple carries `app_id`, the X25519 encryption public key, the Ed25519
signing public key, and a label. Validation derives `app_id` from the
encryption key and requires the signing key.

**Prohibited:** record a GitHub PAT or OAuth token inside `provider-mounted` so
a joining installation can sync without signing in.

**Required:** record only the repository, Drive folder, iCloud share target, or
local folder name. Each installation supplies and seals its own credential
locally, as [auth-providers.md](../../../../.cortex/docs/architecture/auth-providers.md)
requires.

### Keep names sealed in the signed log

The identity log is signed, not encrypted. Every mount's operator can read it.

- It carries public keys, device labels, wrapped DEKs, vault `store_id`s, and
  credential-free mount targets.
- Device labels follow the vault log's `join-approved` precedent.
- The identity name appears only inside `identity-named`, sealed to each
  active member's encryption key. The local directory and the encrypted
  enrollment code also carry it.
- Vault names stay in the local vault registry and encrypted vault metadata.
- A provider listing may show what the log already exposes: device count,
  when the newest device joined, and how many vaults the identity keeps.

The name in the log wins. A device seals its local name only into a log no
member has named. Otherwise it re-seals the log's own name for members that
cannot read it, so devices never overwrite each other's name.

**Prohibited:** write the identity name, or a vault name, into the log in
plaintext, or seal it to anything other than member encryption keys.

**Required:** seal the name to every active member. A provider operator must
not learn that the identity is called "Work" or that a vault is called
"Taxes".

### Authorize actors from causal history

An event's actor must be an identity member in that event's causal past.

- The genesis actor is a member from genesis onward.
- `member-approved` makes the approved member's signer a member in every
  causal descendant.
- `member-joined-by-invite` does the same for its joiner when a member issued
  that invite in the event's causal past, the invite key signed the joiner's
  keys, and no other join used the invite.
  - Of several joins on one invite, the lowest event id wins on every replica.
  - The joining client refuses an expired invite; the log does not read
    clocks.
- `member-revoked` removes membership unless a later approval causally follows
  the revocation.
- A revocation concurrent with an approval of the same app wins.
- A self-signed `member-joined-by-invite` that holds is the only operation an
  outsider may publish. A self-signed `member-join-requested` from an earlier
  build is still accepted as history.
- An unauthorized event is quarantined with every causal descendant.

The projection applies the same rule over the whole applicable log, so the
member list never depends on delivery order.

**Prohibited:** let an approval delivered after a concurrent revocation restore
the revoked app because it was applied last.

**Required:** compare causal order, not arrival order. The approval only
survives when the revocation is its causal ancestor, so every replica agrees
the app is revoked.

### Project identity state deterministically

`IdentityControlState::project` folds applicable events in topological order.
Ties break by event ID.

- **Members:** the effective members with their latest labels.
- **Revoked:** app IDs that were members and are no longer effective.
- **Pending joins:** requests with no causally later approval, denial, or
  revocation for the same app, from apps that are not members.
- **Vaults:** each registered vault with DEK envelopes per key epoch.
  - The current key epoch comes from the latest registration or rewrap.
  - Revoked members' envelopes are removed.
- **Mounts:** mounted records minus unmounted ones.
- **Heads:** the applicable heads the next append extends.

**Prohibited:** open a vault with whichever identity envelope was granted last
when the vault has rotated its keys.

**Required:** look up the envelope for the vault's own current key epoch. A
missing envelope at that epoch is a typed `NotGranted` state that any holder of
the DEK can close with `vault-dek-granted`.

### Store the log once per provider mount

Every remote mount keeps one root, `meta-secret-nook`, with a folder per
identity. An identity's folder holds its log in `log` and each vault it filed
in a folder named by the store id. Events are immutable and content-addressed,
so replicas converge by set union. `PlacedNamespace` owns the layout.

- **Path-addressed providers (GitHub, local folder)**
  - Identity log: `meta-secret-nook/{identity_id}/log/events/{digest}.yaml`.
  - Vault: `meta-secret-nook/{identity_id}/{store_id}/events/{digest}.yaml`.
- **Google Drive**
  - The same layout as nested folders: the root, an `{identity_id}` folder in
    it, and `log` or `{store_id}` inside that.
- **iCloud**
  - `CloudKit` has no folders. Every record is a `NookLogEvent` whose queryable
    `location` field holds `identity:{identity_id}` or
    `vault:{store_id}:{identity_id}`, so one log can be listed and deleted on
    its own, and a vault is found by its store id prefix.
- **Filing a vault**
  - A vault is filed once, under the identity that first writes it to the
    provider, and stays in that folder. An identity that later shares the
    vault reads and writes it there.
  - Sync finds the vault's folder by store id (`VaultPlacement`). A vault the
    provider does not hold yet is filed under the identity of this
    installation's unlocked app key. A vault found in two identity folders
    stops sync, because choosing one would fork its log.
- **Browser**
  - `nook_db.events` holds `identity_event:{identity_id}:{event_id}` rows and
    an `identity_event_index:{identity_id}` index in one transaction.

- **Discovery**
  - `EventLogNamespaceKind` lists the identities or vaults a target holds.
  - Recovering from a provider lists its vault namespaces and asks which vault
    to open when there are several. Each choice shows the summary that
    [provider vault listing](vault-event-log.md#provider-vault-listing)
    describes.
- **Identity sync**
  - List each mount's identity namespace, fetch missing events, validate them,
    and union them locally.
  - Put every local event the mount lacks.
  - Report a failed mount on the Sync page; the next sync retries it.

**Prohibited:** store identity events in a vault namespace or vault events in
the identity namespace.

**Required:** address every log through `EventLogLocation`; there is no shared
event root.

### Start the log with its founder

An identity with no control log gets one when this installation first needs it:
the founder-signed `identity-created` genesis. Each vault joins the log as it
opens here (`vault-registered`, wrapped to this member), and every other app
joins with a one-time invite a member issued. Vault rosters never become
identity members on their own.

## Prohibited actions

- Do not let a provider credential, an enrollment code, or a vault backup
  password grant identity membership.
- Do not accept an identity event whose actor is not an identity member in its
  causal past, except a self-signed join that holds an issued invite.
- Do not store identity events in a vault namespace or vault events in the
  identity namespace.
- Do not persist private app keys, signing seeds, or plaintext DEKs in the
  identity log.

## Testing requirements

Behavior-focused Rust tests cover the log in
`nook-event-log/src/identity_control/tests.rs`,
`nook-event-log/src/location.rs`, and `nook-event-log/src/graph/roster.rs`.

- **Founder genesis, approval with DEK wrapping, member actions**
  - `approval_wraps_every_owned_vault_dek_to_the_joiner`
- **Outsider writes, impersonated requests, self-approval**
  - `outsiders_can_only_request_to_join`
- **Invite joins: DEKs without approval, issued invite and key, self-signed,
  one device per invite**
  - `an_invite_holder_joins_with_its_vault_keys_and_no_approval`
  - `a_join_needs_an_invite_a_member_issued_and_its_key`
  - `an_invite_join_is_signed_by_the_member_it_adds`
  - `an_invite_admits_one_device_in_any_delivery_order`
- **Revocation, envelope removal, rewrap after rotation**
  - `revocation_drops_envelopes_and_blocks_later_actions`
- **Concurrent revoke versus reapproval**
  - `concurrent_revocation_wins_over_concurrent_reapproval`
- **Order independence and pending parents**
  - `projection_is_independent_of_delivery_order_and_resolves_pending_parents`
- **Identity binding, forged genesis, tampering**
  - `envelopes_bind_to_one_identity_and_one_founder_genesis`
- **Remote namespaces**
  - `vault_and_identity_namespaces_never_overlap`
  - `namespace_ids_are_read_back_from_paths_and_tags`
- **Sealed identity name: every member reads it, strangers cannot rename it,
  the log's name wins**
  - `the_identity_name_is_sealed_to_every_member_including_one_joining`
  - `the_log_name_wins_and_reaches_every_member` (nook-core)
- **Provider listing facts and the passkey name reveal** (nook-core)
  - `a_signed_log_tells_its_devices_their_newest_join_and_its_vaults`
  - `a_folder_without_log_events_has_no_facts_and_a_damaged_log_fails`
  - `the_member_passkey_opens_the_identity_and_vault_names_in_memory`
  - `another_passkey_opens_nothing`
