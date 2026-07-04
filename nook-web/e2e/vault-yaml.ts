import { parse as parseYaml } from 'yaml'

/** Parsed shape of nook-projection.yaml (matches nook-core StoredVaultYaml). */
type StoredSecretRecord = {
  id: string
  type: 'login' | 'api-key' | 'seed-phrase' | 'secure-note'
  data: string
}

type AuthYamlRecord = {
  pk_id: string
  secrets_key: string
  members_key: string
}

type MembersYamlRecord = {
  pk_id: string
  ciphertext: string
}

type PasswordEnvelopeYaml = {
  version?: number
  kdf?: string
  work_factor?: number
  ciphertext?: string
}

type PasswordEntryYaml = {
  id?: string
  label?: string
  envelope?: PasswordEnvelopeYaml
}

type UnlockYaml = {
  type?: string
  envelope?: PasswordEnvelopeYaml
  entries?: PasswordEntryYaml[]
}

type StoredVaultYaml = {
  secrets?: StoredSecretRecord[]
  auth?: AuthYamlRecord[]
  joins?: StoredSecretRecord[]
  members?: MembersYamlRecord[]
  unlock?: UnlockYaml
  password_entries?: PasswordEntryYaml[]
  /** Legacy field — pre-enum vaults wrote the envelope at the top level. */
  password_envelope?: PasswordEnvelopeYaml
}

type JoinRequestJson = {
  device_id?: string
  public_key?: string
}

export type VaultYamlSnapshot = {
  raw: string
  secretIds: string[]
  authPkIds: string[]
  joinEntries: Array<{ deviceId: string; publicKey: string }>
  memberPkIds: string[]
  unlockMode: 'keys' | 'password'
  hasPasswordEnvelope: boolean
  /**
   * Raw ciphertext of the active password envelope (when present). Useful
   * for waiting on password-rotation propagation: every rotation produces a
   * fresh ciphertext (scrypt nonce + random salt), so a poll that compares
   * against a previously-captured value is a reliable "rotated yet?" check.
   */
  passwordEnvelopeCiphertext: string | null
}

function parseJoinValue(
  key: string,
  value: string,
): { deviceId: string; publicKey: string } {
  const payload = JSON.parse(value) as JoinRequestJson
  return {
    deviceId: payload.device_id ?? key,
    publicKey: payload.public_key ?? '',
  }
}

function collectPasswordEntries(vault: StoredVaultYaml): PasswordEntryYaml[] {
  if (vault.password_entries && vault.password_entries.length > 0) {
    return vault.password_entries
  }
  if (vault.unlock?.entries && vault.unlock.entries.length > 0) {
    return vault.unlock.entries
  }
  if (vault.unlock?.type === 'password' && vault.unlock.envelope) {
    return [{ envelope: vault.unlock.envelope }]
  }
  if (vault.password_envelope) {
    return [{ envelope: vault.password_envelope }]
  }
  return []
}

export function parseVaultYamlSnapshot(yaml: string): VaultYamlSnapshot {
  const vault = parseYaml(yaml) as StoredVaultYaml

  const secretIds = (vault.secrets ?? []).map((record) => record.id)
  const authPkIds = (vault.auth ?? []).map((record) => record.pk_id)
  const memberPkIds = (vault.members ?? []).map((record) => record.pk_id)
  const joinEntries = (vault.joins ?? []).map((record) =>
    parseJoinValue(record.id, record.data),
  )

  const passwordEntries = collectPasswordEntries(vault)
  const hasPasswordEnvelope = passwordEntries.length > 0
  // Device-key auth rows are primary. Password-only vaults (legacy mutex) have
  // no auth section; hybrid vaults keep auth alongside password_entries.
  const unlockMode: 'keys' | 'password' =
    authPkIds.length > 0 ? 'keys' : hasPasswordEnvelope ? 'password' : 'keys'
  const activeEnvelope = passwordEntries[0]?.envelope
  const passwordEnvelopeCiphertext =
    typeof activeEnvelope?.ciphertext === 'string'
      ? activeEnvelope.ciphertext.trim()
      : null

  return {
    raw: yaml,
    secretIds,
    authPkIds,
    joinEntries,
    memberPkIds,
    unlockMode,
    hasPasswordEnvelope,
    passwordEnvelopeCiphertext,
  }
}

export function joinCountFromYaml(yaml: string): number {
  return parseVaultYamlSnapshot(yaml).joinEntries.length
}

export function assertGenesisVaultYaml(snapshot: VaultYamlSnapshot) {
  if (snapshot.authPkIds.length < 1) {
    throw new Error('Expected at least one auth pk_id in genesis vault')
  }
  if (snapshot.memberPkIds.length < 1) {
    throw new Error('Expected at least one members pk_id in genesis vault')
  }
  if (!snapshot.raw.includes('secrets_key:')) {
    throw new Error('Expected secrets_key in auth section')
  }
  if (!snapshot.raw.includes('members_key:')) {
    throw new Error('Expected members_key in auth section')
  }
  if (!snapshot.raw.includes('ciphertext:')) {
    throw new Error('Expected ciphertext in members section')
  }
  if (snapshot.joinEntries.length > 0) {
    throw new Error('Genesis vault should not contain join requests')
  }
  if (snapshot.raw.includes('dek:') || snapshot.raw.includes('dec:')) {
    throw new Error('Vault must not use legacy dek/dec fields')
  }
}

export function assertJoinPendingYaml(
  snapshot: VaultYamlSnapshot,
  deviceId?: string,
) {
  if (snapshot.joinEntries.length < 1) {
    throw new Error('Expected a pending join entry in vault YAML')
  }
  const join = deviceId
    ? snapshot.joinEntries.find((entry) => entry.deviceId === deviceId)
    : snapshot.joinEntries[0]
  if (!join) {
    throw new Error(`Join request for device ${deviceId ?? '(any)'} not found`)
  }
  if (!join.publicKey.startsWith('age1')) {
    throw new Error('Join request must include age1 public_key while pending')
  }
  if (snapshot.authPkIds.length < 1) {
    throw new Error('Vault must still have genesis auth while join is pending')
  }
}

export function assertEnrolledVaultYaml(
  snapshot: VaultYamlSnapshot,
  expectedMembers: number,
) {
  if (snapshot.joinEntries.length > 0) {
    throw new Error('Approved vault must not contain pending joins')
  }
  if (snapshot.authPkIds.length !== expectedMembers) {
    throw new Error(
      `Expected ${expectedMembers} auth entries, got ${snapshot.authPkIds.length}`,
    )
  }
  if (snapshot.memberPkIds.length !== expectedMembers) {
    throw new Error(
      `Expected ${expectedMembers} members entries, got ${snapshot.memberPkIds.length}`,
    )
  }

  const vault = parseYaml(snapshot.raw) as StoredVaultYaml
  const authHasPlaintextAgeKey = (vault.auth ?? []).some(
    (record) =>
      record.secrets_key.includes('age1') ||
      record.members_key.includes('age1'),
  )
  if (authHasPlaintextAgeKey) {
    throw new Error('Auth section must not store plaintext age1 public keys')
  }
}
