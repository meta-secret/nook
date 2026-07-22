import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

/** Parsed shape of nook-events (matches nook-core StoredVaultYaml). */
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
  entries?: PasswordEntryYaml[]
}

type StoredVaultYaml = {
  secrets?: StoredSecretRecord[]
  auth?: AuthYamlRecord[]
  joins?: StoredSecretRecord[]
  members?: MembersYamlRecord[]
  unlock?: UnlockYaml
  password_entries?: PasswordEntryYaml[]
  sentinel_shares?: StoredSecretRecord[]
}

type JoinRequestJson = {
  device_id?: string
  public_key?: string
}

type EventSecretRecord = {
  id?: string
  type?: StoredSecretRecord['type']
  ciphertext?: string
}

type VaultEventOperation = {
  type?: string
  secrets?: EventSecretRecord[]
  secret?: EventSecretRecord
  secret_id?: string
  old_id?: string
  new_secret?: EventSecretRecord
  chosen_secret_id?: string
  rejected_secret_ids?: string[]
  device_id?: string
  encryption_public_key?: string
  secrets_key_ciphertext?: string
  members_key_ciphertext?: string
  entry_id?: string
  label?: string
  created_at?: string
  envelope?: PasswordEnvelopeYaml
  password_entries?: PasswordEntryYaml[]
  shares?: Array<{ device_id?: string; ciphertext?: string }>
}

type VaultEventYaml = {
  created_at?: string
  operations?: VaultEventOperation[]
}

export type VaultYamlSnapshot = {
  raw: string
  secretIds: string[]
  authPkIds: string[]
  joinEntries: Array<{ deviceId: string; publicKey: string }>
  memberPkIds: string[]
  /** Count of sentinel share records / issued share payloads observed. */
  sentinelShareCount: number
  unlockMode: 'keys' | 'password'
  hasPasswordEnvelope: boolean
  /**
   * Raw ciphertext of the active password envelope (when present). Useful
   * for waiting on password-rotation propagation: every rotation produces a
   * fresh ciphertext (scrypt nonce + random salt), so a poll that compares
   * against a previously-captured value is a reliable "rotated yet?" check.
   */
  passwordEnvelopeCiphertext: string | undefined
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
  const sentinelShareCount = (vault.sentinel_shares ?? []).length

  const passwordEntries = collectPasswordEntries(vault)
  const hasPasswordEnvelope = passwordEntries.length > 0
  // Device-key auth rows are primary; hybrid vaults keep auth alongside
  // password_entries.
  const unlockMode: 'keys' | 'password' =
    authPkIds.length > 0 ? 'keys' : hasPasswordEnvelope ? 'password' : 'keys'
  const activeEnvelope = passwordEntries[0]?.envelope
  const passwordEnvelopeCiphertext =
    typeof activeEnvelope?.ciphertext === 'string'
      ? activeEnvelope.ciphertext.trim()
      : undefined

  return {
    raw: yaml,
    secretIds,
    authPkIds,
    joinEntries,
    memberPkIds,
    sentinelShareCount,
    unlockMode,
    hasPasswordEnvelope,
    passwordEnvelopeCiphertext,
  }
}

function eventSecretToStored(
  secret?: EventSecretRecord,
): StoredSecretRecord | undefined {
  if (!secret?.id) return undefined
  return {
    id: secret.id,
    type: secret.type ?? 'api-key',
    data: secret.ciphertext ?? '',
  }
}

function passwordEventEnvelope(
  envelope?: PasswordEnvelopeYaml,
): PasswordEnvelopeYaml {
  return envelope ?? {}
}

function sortEventYamls(eventYamls: string[]): VaultEventYaml[] {
  return eventYamls
    .map((yaml) => parseYaml(yaml) as VaultEventYaml)
    .sort((left, right) =>
      (left.created_at ?? '').localeCompare(right.created_at ?? ''),
    )
}

/** Materialize the e2e-visible remote state from immutable provider event YAML. */
export function parseVaultEventLogSnapshot(
  eventYamls: string[],
): VaultYamlSnapshot {
  const secrets = new Map<string, StoredSecretRecord>()
  const joins = new Map<string, { deviceId: string; publicKey: string }>()
  const auth = new Map<
    string,
    { pk_id: string; secrets_key: string; members_key: string }
  >()
  const members = new Map<string, { pk_id: string; ciphertext: string }>()
  const passwordEntries = new Map<string, PasswordEntryYaml>()
  const sentinelShares = new Map<string, StoredSecretRecord>()

  for (const event of sortEventYamls(eventYamls)) {
    for (const operation of event.operations ?? []) {
      switch (operation.type) {
        case 'vault-imported':
          for (const secret of operation.secrets ?? []) {
            const stored = eventSecretToStored(secret)
            if (stored) secrets.set(stored.id, stored)
          }
          passwordEntries.clear()
          for (const entry of operation.password_entries ?? []) {
            if (entry.id) passwordEntries.set(entry.id, entry)
          }
          break
        case 'epoch-checkpoint':
          for (const secret of operation.secrets ?? []) {
            const stored = eventSecretToStored(secret)
            if (stored) secrets.set(stored.id, stored)
          }
          break
        case 'secret-created': {
          const stored = eventSecretToStored(operation.secret)
          if (stored) secrets.set(stored.id, stored)
          break
        }
        case 'secret-deleted':
          if (operation.secret_id) secrets.delete(operation.secret_id)
          break
        case 'secret-replaced': {
          if (operation.old_id) secrets.delete(operation.old_id)
          const stored = eventSecretToStored(operation.new_secret)
          if (stored) secrets.set(stored.id, stored)
          break
        }
        case 'secret-conflict-resolved':
          for (const rejected of operation.rejected_secret_ids ?? []) {
            secrets.delete(rejected)
          }
          break
        case 'join-requested':
          if (operation.device_id) {
            joins.set(operation.device_id, {
              deviceId: operation.device_id,
              publicKey: operation.encryption_public_key ?? '',
            })
          }
          break
        case 'join-approved':
          if (operation.device_id) {
            joins.delete(operation.device_id)
            auth.set(operation.device_id, {
              pk_id: operation.device_id,
              secrets_key: operation.secrets_key_ciphertext ?? '',
              members_key: operation.members_key_ciphertext ?? '',
            })
            members.set(operation.device_id, {
              pk_id: operation.device_id,
              ciphertext: operation.members_key_ciphertext ?? '',
            })
          }
          break
        case 'sentinel-participant-enrolled':
          if (operation.device_id) {
            joins.delete(operation.device_id)
            members.set(operation.device_id, {
              pk_id: operation.device_id,
              ciphertext: '',
            })
          }
          break
        case 'sentinel-shares-issued':
          for (const share of operation.shares ?? []) {
            const deviceId = share.device_id?.trim()
            if (!deviceId) continue
            sentinelShares.set(deviceId, {
              id: `sentinel_share:${deviceId}`,
              type: 'secure-note',
              data: share.ciphertext ?? '',
            })
          }
          break
        case 'join-denied':
          if (operation.device_id) joins.delete(operation.device_id)
          break
        case 'device-revoked':
          if (operation.device_id) {
            joins.delete(operation.device_id)
            auth.delete(operation.device_id)
            members.delete(operation.device_id)
            sentinelShares.delete(operation.device_id)
          }
          break
        case 'password-added':
          if (operation.entry_id) {
            passwordEntries.set(operation.entry_id, {
              id: operation.entry_id,
              label: operation.label,
              envelope: passwordEventEnvelope(operation.envelope),
            })
          }
          break
        case 'password-rotated':
          if (operation.entry_id) {
            const existing = passwordEntries.get(operation.entry_id)
            passwordEntries.set(operation.entry_id, {
              id: operation.entry_id,
              label: existing?.label,
              envelope: passwordEventEnvelope(operation.envelope),
            })
          }
          break
        case 'password-removed':
          if (operation.entry_id) passwordEntries.delete(operation.entry_id)
          break
        case 'vault-cleared':
          secrets.clear()
          joins.clear()
          passwordEntries.clear()
          break
      }
    }
  }

  const projectionLikeYaml = stringifyYaml({
    secrets: [...secrets.values()],
    auth: [...auth.values()],
    joins: [...joins.values()].map((join) => ({
      id: join.deviceId,
      type: 'secure-note',
      data: JSON.stringify({
        device_id: join.deviceId,
        public_key: join.publicKey,
      }),
    })),
    members: [...members.values()],
    sentinel_shares: [...sentinelShares.values()],
    password_entries: [...passwordEntries.values()],
  })

  return parseVaultYamlSnapshot(projectionLikeYaml)
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
    throw new Error('Vault must not use unsupported dek/dec fields')
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
  // Simple vaults keep genesis auth while a join is pending. Sentinel genesis
  // never writes auth envelopes, so an empty auth section is expected there.
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

export async function waitForVaultEventLogSnapshot(
  getEventFileContents: () => string[],
  predicate: (snapshot: VaultYamlSnapshot) => boolean,
  options: { timeoutMs: number; intervalMs: number },
): Promise<VaultYamlSnapshot> {
  const deadline = Date.now() + options.timeoutMs
  let lastError = 'remote event log empty'

  while (Date.now() < deadline) {
    const events = getEventFileContents()
    if (events.length > 0) {
      try {
        const snapshot = parseVaultEventLogSnapshot(events)
        if (predicate(snapshot)) return snapshot
        lastError = `predicate not satisfied (secrets=${snapshot.secretIds.length}, joins=${snapshot.joinEntries.length})`
      } catch (error) {
        lastError =
          error instanceof Error ? error.message : 'invalid remote event log'
      }
    }
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs))
  }

  throw new Error(`Timed out waiting for remote event log: ${lastError}`)
}
