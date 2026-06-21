import { parse as parseYaml } from 'yaml'

/** Parsed shape of nook-vault.yaml (matches nook-core StoredVaultYaml). */
type StoredSecretRecord = {
  key: string
  value: string
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

type StoredVaultYaml = {
  secrets?: StoredSecretRecord[]
  auth?: AuthYamlRecord[]
  joins?: StoredSecretRecord[]
  members?: MembersYamlRecord[]
}

type JoinRequestJson = {
  device_id?: string
  public_key?: string
}

export type VaultYamlSnapshot = {
  raw: string
  secretLabels: string[]
  authPkIds: string[]
  joinEntries: Array<{ deviceId: string; publicKey: string }>
  memberPkIds: string[]
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

export function parseVaultYamlSnapshot(yaml: string): VaultYamlSnapshot {
  const vault = parseYaml(yaml) as StoredVaultYaml

  const secretLabels = (vault.secrets ?? []).map((record) => record.key)
  const authPkIds = (vault.auth ?? []).map((record) => record.pk_id)
  const memberPkIds = (vault.members ?? []).map((record) => record.pk_id)
  const joinEntries = (vault.joins ?? []).map((record) =>
    parseJoinValue(record.key, record.value),
  )

  return {
    raw: yaml,
    secretLabels,
    authPkIds,
    joinEntries,
    memberPkIds,
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
