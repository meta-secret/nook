# SLIP-0039 Device Quorum Recovery

Status: Draft design for #260. Implementation is split across issues #261, #262, #263, #264, and #265.

This spec defines Nook's first decentralized vault recovery flow: exactly three
enrolled devices hold one recovery share each, and any two devices can help a
locked or new device recover. The exchange is direct and out-of-band through QR
or pasted payloads. Nook sync providers never carry recovery requests or share
responses.

Related:
[decentralized-auth.md](decentralized-auth.md),
[password-envelope.md](password-envelope.md),
[ARCHITECTURE.md](../ARCHITECTURE.md) section 2,
[#259](https://github.com/meta-secret/nook/issues/259).

---

## 1. Goals

- **Fixed 2-of-3 only.** The MVP has exactly three device shares and a
  threshold of two. No configurable thresholds, no arbitrary groups, no
  weighted recovery policy, and no team/family policy builder.
- **Standard share format.** Use SLIP-0039 mnemonic shares for the recovery
  secret. Do not invent a Nook-specific Shamir mnemonic format.
- **Nook key names stay explicit.** Recovery ultimately restores
  `secrets_key` and `members_key`; avoid generic DEK/MEK naming in repo APIs
  and docs.
- **No provider mailbox.** Recovery request and response payloads must not be
  written to GitHub, Drive, iCloud, local-folder replicas, event logs,
  provider projections, provider outboxes, app logs, or debug telemetry.
- **Helper without vault unlock.** Device B can help after local
  passkey/device authorization without opening the vault session or reading
  vault contents.
- **Session-only requester state.** Device A keeps collected shares in memory
  only. Refresh, logout, tab close, cancellation, or success destroys the
  recovery session.

---

## 2. Fixed Policy

Nook's MVP uses SLIP-0039's recommended single-group representation for a
single-level threshold scheme:

| Field | Value | Meaning |
|---|---:|---|
| `G` | 1 | one group |
| `GT` | 1 | one group required |
| `N_1` | 3 | three member shares |
| `T_1` | 2 | any two member shares recover |

Do not expose these as user-configurable fields in the first implementation.
The code may use typed constants such as `RECOVERY_SHARE_COUNT = 3` and
`RECOVERY_THRESHOLD = 2`; it should reject any other shape at the Nook API
boundary even if the underlying SLIP-0039 implementation can support it.

The recovery feature is available only when the vault can assign three active
devices. A vault with fewer than three eligible devices should show setup as
unavailable or incomplete instead of generating a weaker policy.

---

## 3. Recovered Material

SLIP-0039 reconstructs a Nook recovery root, not `secrets_key` or
`members_key` directly.

MVP recovery root:

- 32 random bytes.
- Encoded as a 256-bit SLIP-0039 master secret.
- Split as one group, three shares, threshold two.
- Created with an empty SLIP-0039 passphrase.

The empty SLIP-0039 passphrase is intentional for the MVP. SLIP-0039
passphrases are not self-validating; any passphrase yields a master secret.
Adding another user-entered recovery passphrase would complicate UX and failure
modes. Nook should authenticate the recovered root by using it to open a
versioned recovery envelope instead.

The recovered root derives an AEAD wrapping key:

```text
recovery_wrap_key = HKDF-SHA256(
  ikm = recovery_root,
  salt = recovery_id || store_id,
  info = "nook/slip39-recovery/v1/vault-keys"
)
```

That key opens a versioned recovery envelope containing:

```json
{
  "version": 1,
  "recovery_id": "rec_...",
  "store_id": "store_...",
  "key_epoch": 12,
  "secrets_key": "<base64url 32 bytes>",
  "members_key": "<base64url 32 bytes>"
}
```

The envelope is authenticated with associated data binding at least:

- protocol id: `nook/slip39-recovery/v1`
- `recovery_id`
- `store_id`
- `key_epoch`
- recovery policy: `2-of-3`

This makes wrong passphrases, wrong share sets, wrong vaults, and stale
envelopes fail before the recovered keys become a usable vault session.

---

## 4. Device Roles

### 4.1 Device A - requester

Device A is locked, new, or otherwise unable to recover through its own local
device key. The user contacts another trusted person outside Nook, for example
by phone or a separate messenger, and asks for help.

Flow:

1. Device A opens **Recover this device**.
2. WASM creates an in-memory recovery session with a random `session_id`,
   expiry, and ephemeral X25519 recipient key.
3. Device A shows a recovery request QR/link/paste payload.
4. Device A waits for response QRs from helper devices.
5. Each response is decrypted and validated inside WASM; TypeScript receives
   only progress such as `0 of 2`, `1 of 2`, or `ready`.
6. After two distinct valid shares arrive, WASM combines the SLIP-0039 shares,
   recovers the root, opens the recovery envelope, obtains `secrets_key` and
   `members_key`, and enrolls the requester through normal `auth:` and
   `members:` records.
7. WASM clears all recovery session plaintext.

Collected shares and recovered roots are never written to IndexedDB,
`localStorage`, `sessionStorage`, provider state, URL fragments, logs, or
Svelte stores that survive reload.

### 4.2 Device B - helper

Device B is already an enrolled device that has a protected local recovery
share. Device B does not need to unlock/open the vault session.

Flow:

1. Device B opens **Help recover a vault** near the existing **Onboard** area.
2. Device B scans or pastes Device A's request payload.
3. WASM validates the request shape, expiry, `recovery_id`, and vault/store
   metadata against local recovery metadata.
4. WASM computes a request fingerprint from the canonical request payload and
   shows a short pairing phrase. The helper confirms that phrase with Device A
   over the same out-of-band call before any local share is unsealed.
5. Device B performs local device/passkey authorization to unseal only its
   protected recovery share.
6. WASM encrypts that share to Device A's ephemeral request key and returns a
   response QR/link/paste payload.
7. Refresh, logout, tab close, dismissal, or request expiry clears the helper
   response state.

Device B must not call the normal vault unlock path, resolve
`secrets_key`/`members_key`, decrypt user secrets, or load the full vault
session merely to help.

---

## 5. QR Payloads

Payloads are versioned typed records owned by Rust/WASM. Svelte renders QR
codes and paste boxes; it does not validate or decrypt recovery shares.

### 5.1 Request payload

Device A renders a request payload:

```json
{
  "kind": "nook-recovery-request",
  "version": 1,
  "session_id": "<128-bit random base64url>",
  "recovery_id": "rec_...",
  "store_id": "store_...",
  "key_epoch": 12,
  "issued_at": "2026-07-09T00:00:00Z",
  "expires_at": "2026-07-09T00:10:00Z",
  "requester_public_key": "<X25519 public key base64url>"
}
```

The request contains no recovery share, no recovery root, no vault keys, and no
sync-provider credentials.

Both devices compute:

```text
canonical_request_payload =
  UTF-8(JSON.stringify({
    kind,
    version,
    session_id,
    recovery_id,
    store_id,
    key_epoch,
    issued_at,
    expires_at,
    requester_public_key
  }))
request_fingerprint = SHA-256(canonical_request_payload)
pairing_phrase = short-human-code(request_fingerprint)
```

The canonical request payload is built after parsing the typed request record.
It uses the exact field order shown above, no extra fields, no insignificant
whitespace, and string values exactly as they appear in the QR payload.
`issued_at` and `expires_at` are UTC RFC3339 strings with a `Z` suffix and no
fractional seconds. Binary values are unpadded base64url. Numeric fields are
unsigned base-10 JSON numbers. Parsers reject duplicate fields, unknown fields,
noncanonical time forms, and padded base64url before constructing the canonical
payload for fingerprint verification.

Device A displays the pairing phrase next to the request QR. After Device B
scans the request, it displays the same phrase and must require the helper to
confirm it with the requester through the outside channel before passkey/device
authorization starts. The phrase is not a secret; it is a short authentication
string that binds the human confirmation to `session_id`, `recovery_id`,
`store_id`, `key_epoch`, expiry, and Device A's ephemeral request public key.

### 5.2 Response payload

Device B renders a response payload:

```json
{
  "kind": "nook-recovery-response",
  "version": 1,
  "session_id": "<same session id>",
  "recovery_id": "rec_...",
  "store_id": "store_...",
  "key_epoch": 12,
  "request_fingerprint": "<sha256 canonical request payload base64url>",
  "pairing_method": "oob-phrase-v1",
  "helper_device_id": "26aa720ff5b4429c",
  "share_hint": {
    "group_index": 0,
    "member_index": 1
  },
  "ciphertext": "<base64url AEAD payload>"
}
```

The encrypted plaintext contains one canonical SLIP-0039 member share and the
same session binding fields. The AEAD associated data binds:

- `kind`
- `version`
- `session_id`
- `recovery_id`
- `store_id`
- `key_epoch`
- request fingerprint
- pairing method
- Device A request public key
- helper `device_id`
- share `group_index` and `member_index`

Device A rejects responses for the wrong session, wrong recovery id, wrong
store, wrong key epoch, expired request, request-fingerprint mismatch, duplicate
member index, malformed ciphertext, or stale share generation. Device B echoes
the request `store_id` and `key_epoch` in the response, and both devices verify
that those values match the active recovery generation for the local
`recovery_id` before any share is unsealed or accepted.

Device B must not expose the passkey prompt or unseal its local share until
WASM records a helper confirmation for the computed `request_fingerprint` and
`pairing_method`. This prevents a scanned but unverified request public key from
becoming sufficient to receive an encrypted share.

---

## 6. Storage Model

### Synced vault metadata

The vault may sync recovery policy metadata and the recovery envelope, but never
the recovery request/response exchange itself. Synced metadata may include:

- `recovery_id`
- policy version and fixed policy marker `2-of-3`
- recovery envelope ciphertext for `secrets_key` + `members_key`
- key epoch / rotation generation
- encrypted assignment metadata needed to know which active device owns which
  share

This metadata is not enough to recover without two protected device shares.

### Local device storage

Each enrolled helper device stores only its own SLIP-0039 member share, sealed
behind local device protection. The protected local share record is separate
from the unlocked vault session and can be unsealed after passkey/device
authorization for helper mode.

Local storage must never contain:

- plaintext recovery root
- plaintext SLIP-0039 share
- collected requester shares
- `secrets_key`
- `members_key`
- recovery response ciphertext created for an old requester session

### Session memory

Device A's recovery session is a WASM session object. It owns ephemeral private
keys, decrypted helper shares, threshold progress, and recovered root material.
It is dropped on refresh, logout, lock, tab close, cancellation, or success.

---

## 7. Rust Implementation Decision

Decision for #260: implement a Nook-owned current-SLIP-0039 module in
`nook-auth2`, using `rust-bitcoin/rust-wallet/src/sss.rs` as the primary
Apache-2.0 audit/reference source. Do not depend directly on the
`Internet-of-People/slip39-rust` crate.

### Candidate audit

| Candidate | Decision | Rationale |
|---|---|---|
| `Internet-of-People/slip39-rust` | Reject as a direct dependency | Published as `slip39` but GPL-3.0-or-later, old, command-oriented, and a wrapper around another crate. Useful only as a behavioral reference. |
| `rust-bitcoin/rust-wallet/src/sss.rs` | Use as primary reference, not blind vendoring | Apache-2.0 and contains generate/combine/share parsing plus test vectors, but the repo is archived and the code uses old wallet-local types and dependencies. |
| `yeastplume/rust-sssmc39` | Use as secondary reference only | Apache-2.0 and closer to a library, but explicitly work-in-progress and uses older dependency choices. |

Follow-up #261 should create a Nook-owned module rather than add a large
external dependency. It should preserve license attribution for adapted
Apache-2.0 source and replace old dependencies with current Nook-compatible
ones:

- use existing `getrandom`, `sha2`, `pbkdf2`, `hkdf`, `aes-gcm`, and
  `zeroize` where possible
- add a direct `hmac` dependency only if needed for the SLIP-0039 digest path
- avoid `ring`, `failure`, old `rust-crypto`, old `bitcoin` bitstream helpers,
  and CLI-only dependencies
- avoid `unsafe`
- keep the API fixed to Nook's 2-of-3 policy even if internal helpers are more
  general for test-vector coverage

### Current SLIP-0039 requirements to implement

SLIP-0039 is final and defines:

- two-level sharing; Nook's single-level MVP is represented as
  `GT = 1`, `G = 1`, `T_1 = 2`, `N_1 = 3`
- master secrets must have at least 128 bits of entropy and a bit length that
  is a multiple of 16
- implementations must support 128-bit and 256-bit master secrets
- English-only 1024-word mnemonic shares with RS1024 checksum
- checksum validation without automatic correction
- same identifier, extendable flag, iteration exponent, group threshold, group
  count, and share length across a recovery set
- distinct group/member indices
- passphrase printable ASCII; empty string when no passphrase is used
- current shares include the extendable-backup flag, while older sources may
  encode that bit as part of a 5-bit iteration exponent

New Nook shares should use the current SLIP-0039 wire format and set
`ext = 1`. The parser should accept both current and legacy test-vector shapes
when the upstream vectors require it, but the Nook generator should emit only
the current Nook-supported form.

---

## 8. Test Vector Requirements

Issue #261 must include official SLIP-0039 vector coverage from the upstream
spec:

- valid 128-bit and 256-bit examples with passphrase `TREZOR`
- invalid mnemonic/checksum examples that must fail
- mixed identifier/group/metadata examples that must fail
- wrong threshold / insufficient shares examples that must fail

Issue #261 must also add Nook fixed-policy tests:

- generate exactly three shares for a fixed 256-bit recovery root using the
  empty SLIP-0039 passphrase
- each of the three possible share pairs reconstructs the same recovery root
- each single share fails to reconstruct
- duplicate shares fail
- wrong-vault or stale-generation metadata fails before vault keys are exposed
- the recovered root opens the authenticated recovery envelope for
  `secrets_key` + `members_key`

Generation uses randomness, so stable tests should either use checked-in
fixture shares or an internal deterministic test RNG that is not exposed in
production APIs.

---

## 9. Security Checklist

Every implementation PR in #261 through #265 must preserve these invariants:

- Recovery request payloads are never written to sync providers, event logs,
  projections, provider outboxes, IndexedDB, app logs, or debug telemetry.
- Recovery response payloads are never written to sync providers, event logs,
  projections, provider outboxes, IndexedDB, app logs, or debug telemetry.
- Plaintext shares never cross into TypeScript/Svelte.
- Plaintext recovery root never crosses into TypeScript/Svelte.
- `secrets_key` and `members_key` stay in Rust/WASM session memory and are
  zeroized/cleared with existing session teardown rules.
- Device B helper mode unseals only the protected local recovery share; it does
  not open the vault session or decrypt user secrets.
- Device B helper mode requires out-of-band pairing phrase confirmation before
  local share unsealing, and response encryption is bound to the confirmed
  request fingerprint.
- Device A rejects duplicate member shares and any response not bound to the
  current session id, recovery id, store id, and request public key.
- Refresh/logout/tab close cancels the requester session because shares are not
  persisted anywhere.
- App logs and e2e attachments must redact share mnemonics, recovery roots,
  `secrets_key`, and `members_key`.

---

## 10. Implementation Sequence

1. #261 - implement fixed-policy SLIP-0039 primitives in `nook-auth2`.
2. #262 - add recovery root, recovery envelope, local share assignment, and
   share lifecycle.
3. #263 - expose requester/helper recovery session APIs through `nook-wasm`.
4. #264 - build the Device A / Device B Svelte UX near Onboard and Login.
5. #265 - add end-to-end validation and leak-prevention tests.

Do not start with UI. The UI must consume typed WASM states from the auth-owned
model so the recovery protocol does not drift into TypeScript.
