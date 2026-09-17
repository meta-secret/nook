import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { UnlockMethod } from '$lib/components/login/login-unlock-state'

/** Parsed shape of nook-events (matches nook-core StoredVaultYaml). */
enum StoredSecretRecordType {
  Login = 'login',
  ApiKey = 'api-key',
  SeedPhrase = 'seed-phrase',
  SecureNote = 'secure-note',
}

type StoredSecretRecord = {
  id: string
  type: StoredSecretRecordType
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

class VaultYamlDecoder {
  decodeStoredVault(value: unknown): StoredVaultYaml {
    try {
      const vaultValue = this.decodeObject(value, 'vault YAML')
      const vault: StoredVaultYaml = {}
      if ('secrets' in vaultValue) vault.secrets = this.decodeStoredSecrets(vaultValue.secrets)
      if ('auth' in vaultValue) vault.auth = this.decodeAuthRecords(vaultValue.auth)
      if ('joins' in vaultValue) vault.joins = this.decodeStoredSecrets(vaultValue.joins)
      if ('members' in vaultValue) vault.members = this.decodeMembers(vaultValue.members)
      if ('unlock' in vaultValue) vault.unlock = this.decodeUnlock(vaultValue.unlock)
      if ('password_entries' in vaultValue) {
        vault.password_entries = this.decodePasswordEntries(vaultValue.password_entries)
      }
      if ('sentinel_shares' in vaultValue) {
        vault.sentinel_shares = this.decodeStoredSecrets(vaultValue.sentinel_shares)
      }
      return vault
    } catch {
      return {}
    }
  }

  decodeEvent(value: unknown): VaultEventYaml {
    try {
      const eventValue = this.decodeObject(value, 'event YAML')
      const event: VaultEventYaml = {}
      const createdAt = this.optionalString(eventValue, 'created_at')
      if (createdAt !== undefined) event.created_at = createdAt
      if ('operations' in eventValue) {
        const operations = eventValue.operations
        if (!Array.isArray(operations)) return {}
        event.operations = operations.map((operation) =>
          this.decodeOperation(operation),
        )
      }
      return event
    } catch {
      return {}
    }
  }

  decodeJoin(value: unknown, fallbackId: string): { deviceId: string; publicKey: string } {
    let payload: object
    try {
      payload = this.decodeObject(value, 'join YAML')
    } catch {
      return { deviceId: fallbackId, publicKey: '' }
    }
    const deviceId = this.optionalString(payload, 'device_id') ?? fallbackId
    const publicKey = this.optionalString(payload, 'public_key') ?? ''
    return { deviceId, publicKey }
  }

  private decodeObject(value: unknown, label: string): object {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(`${label} must be an object`)
    }
    return value
  }

  private optionalString(value: object, key: string): string | undefined {
    if (!(key in value)) return undefined
    const field: unknown = Reflect.get(value, key)
    if (typeof field !== 'string') throw new TypeError(`${key} must be a string`)
    return field
  }

  private decodeStoredSecrets(value: unknown): StoredSecretRecord[] {
    if (!Array.isArray(value)) throw new TypeError('secrets must be an array')
    return value.map((entry) => {
      const secret = this.decodeObject(entry, 'secret')
      const id = this.optionalString(secret, 'id')
      const data = this.optionalString(secret, 'data')
      const type = this.optionalString(secret, 'type')
      if (!id || !data || !type) {
        throw new TypeError('secret fields are invalid')
      }
      return { id, data, type: this.decodeStoredSecretType(type) }
    })
  }

  private decodeStoredSecretType(value: string): StoredSecretRecordType {
    switch (value) {
      case StoredSecretRecordType.Login: return StoredSecretRecordType.Login
      case StoredSecretRecordType.ApiKey: return StoredSecretRecordType.ApiKey
      case StoredSecretRecordType.SeedPhrase: return StoredSecretRecordType.SeedPhrase
      case StoredSecretRecordType.SecureNote: return StoredSecretRecordType.SecureNote
      default: throw new TypeError('secret type is invalid')
    }
  }

  private decodeAuthRecords(value: unknown): AuthYamlRecord[] {
    if (!Array.isArray(value)) throw new TypeError('auth must be an array')
    return value.map((entry) => {
      const auth = this.decodeObject(entry, 'auth record')
      const pk_id = this.optionalString(auth, 'pk_id')
      const secrets_key = this.optionalString(auth, 'secrets_key')
      const members_key = this.optionalString(auth, 'members_key')
      if (!pk_id || !secrets_key || !members_key) {
        throw new TypeError('auth record fields are invalid')
      }
      return { pk_id, secrets_key, members_key }
    })
  }

  private decodeMembers(value: unknown): MembersYamlRecord[] {
    if (!Array.isArray(value)) throw new TypeError('members must be an array')
    return value.map((entry) => {
      const member = this.decodeObject(entry, 'member')
      const pk_id = this.optionalString(member, 'pk_id')
      const ciphertext = this.optionalString(member, 'ciphertext')
      if (!pk_id || !ciphertext) throw new TypeError('member fields are invalid')
      return { pk_id, ciphertext }
    })
  }

  private decodeUnlock(value: unknown): UnlockYaml {
    const unlockValue = this.decodeObject(value, 'unlock')
    const unlock: UnlockYaml = {}
    const type = this.optionalString(unlockValue, 'type')
    if (type !== undefined) unlock.type = type
    if ('entries' in unlockValue) unlock.entries = this.decodePasswordEntries(unlockValue.entries)
    return unlock
  }

  private decodePasswordEntries(value: unknown): PasswordEntryYaml[] {
    if (!Array.isArray(value)) throw new TypeError('password entries must be an array')
    return value.map((entry) => {
      const passwordEntry = this.decodeObject(entry, 'password entry')
      const decoded: PasswordEntryYaml = {}
      const id = this.optionalString(passwordEntry, 'id')
      const label = this.optionalString(passwordEntry, 'label')
      if (id !== undefined) decoded.id = id
      if (label !== undefined) decoded.label = label
      if ('envelope' in passwordEntry) decoded.envelope = this.decodePasswordEnvelope(passwordEntry.envelope)
      return decoded
    })
  }

  private decodePasswordEnvelope(value: unknown): PasswordEnvelopeYaml {
    const envelopeValue = this.decodeObject(value, 'password envelope')
    const envelope: PasswordEnvelopeYaml = {}
    if ('version' in envelopeValue) {
      const version: unknown = Reflect.get(envelopeValue, 'version')
      if (typeof version !== 'number') throw new TypeError('envelope version must be a number')
      envelope.version = version
    }
    if ('work_factor' in envelopeValue) {
      const workFactor: unknown = Reflect.get(envelopeValue, 'work_factor')
      if (typeof workFactor !== 'number') throw new TypeError('envelope work factor must be a number')
      envelope.work_factor = workFactor
    }
    const kdf = this.optionalString(envelopeValue, 'kdf')
    const ciphertext = this.optionalString(envelopeValue, 'ciphertext')
    if (kdf !== undefined) envelope.kdf = kdf
    if (ciphertext !== undefined) envelope.ciphertext = ciphertext
    return envelope
  }

  private decodeOperation(value: unknown): VaultEventOperation {
    const operationValue = this.decodeObject(value, 'event operation')
    const operation: VaultEventOperation = {}
    const stringFields = [
      'type', 'secret_id', 'old_id', 'chosen_secret_id', 'device_id',
      'encryption_public_key', 'secrets_key_ciphertext', 'members_key_ciphertext',
      'entry_id', 'label', 'created_at',
    ] as const
    for (const field of stringFields) {
      const decoded = this.optionalString(operationValue, field)
      if (decoded !== undefined) operation[field] = decoded
    }
    if ('secrets' in operationValue) operation.secrets = this.decodeEventSecrets(operationValue.secrets)
    if ('secret' in operationValue) operation.secret = this.decodeEventSecret(operationValue.secret)
    if ('new_secret' in operationValue) operation.new_secret = this.decodeEventSecret(operationValue.new_secret)
    if ('rejected_secret_ids' in operationValue) {
      operation.rejected_secret_ids = this.decodeStringList(operationValue.rejected_secret_ids)
    }
    if ('envelope' in operationValue) operation.envelope = this.decodePasswordEnvelope(operationValue.envelope)
    if ('password_entries' in operationValue) {
      operation.password_entries = this.decodePasswordEntries(operationValue.password_entries)
    }
    if ('shares' in operationValue) operation.shares = this.decodeShares(operationValue.shares)
    return operation
  }

  private decodeEventSecrets(value: unknown): EventSecretRecord[] {
    if (!Array.isArray(value)) throw new TypeError('event secrets must be an array')
    return value.map((entry) => this.decodeEventSecret(entry))
  }

  private decodeEventSecret(value: unknown): EventSecretRecord {
    const eventSecret = this.decodeObject(value, 'event secret')
    const id = this.optionalString(eventSecret, 'id')
    const ciphertext = this.optionalString(eventSecret, 'ciphertext')
    const type = this.optionalString(eventSecret, 'type')
    const decoded: EventSecretRecord = {}
    if (id !== undefined) decoded.id = id
    if (ciphertext !== undefined) decoded.ciphertext = ciphertext
    if (type !== undefined) {
      decoded.type = this.decodeStoredSecretType(type)
    }
    return decoded
  }

  private decodeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) throw new TypeError('string list must be an array')
    return value.map((entry) => {
      if (typeof entry !== 'string') throw new TypeError('string list value is invalid')
      return entry
    })
  }

  private decodeShares(value: unknown): Array<{ device_id?: string; ciphertext?: string }> {
    if (!Array.isArray(value)) throw new TypeError('shares must be an array')
    return value.map((entry) => {
      const shareValue = this.decodeObject(entry, 'share')
      const share: { device_id?: string; ciphertext?: string } = {}
      const deviceId = this.optionalString(shareValue, 'device_id')
      const ciphertext = this.optionalString(shareValue, 'ciphertext')
      if (deviceId !== undefined) share.device_id = deviceId
      if (ciphertext !== undefined) share.ciphertext = ciphertext
      return share
    })
  }
}

const vaultYamlDecoder = new VaultYamlDecoder()

export enum PasswordEnvelopeCiphertextStateKind {
  Absent = 'absent',
  Present = 'present',
}

export type PasswordEnvelopeCiphertextState =
  | { kind: PasswordEnvelopeCiphertextStateKind.Absent }
  | {
      kind: PasswordEnvelopeCiphertextStateKind.Present
      ciphertext: string
    }

export type VaultYamlSnapshot = {
  raw: string
  secretIds: string[]
  authPkIds: string[]
  joinEntries: Array<{ deviceId: string; publicKey: string }>
  memberPkIds: string[]
  /** Count of sentinel share records / issued share payloads observed. */
  sentinelShareCount: number
  unlockMode: UnlockMethod
  hasPasswordEnvelope: boolean
  /**
   * Raw ciphertext of the active password envelope (when present). Useful
   * for waiting on password-rotation propagation: every rotation produces a
   * fresh ciphertext (scrypt nonce + random salt), so a poll that compares
   * against a previously-captured value is a reliable "rotated yet?" check.
   */
  passwordEnvelopeCiphertext: PasswordEnvelopeCiphertextState
}

function parseJoinValue(
  key: string,
  value: string,
): { deviceId: string; publicKey: string } {
  const parsed: unknown = JSON.parse(value)
  return vaultYamlDecoder.decodeJoin(parsed, key)
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
  const parsed: unknown = parseYaml(yaml)
  const vault = vaultYamlDecoder.decodeStoredVault(parsed)

  const secretIds = ((v) => (v ? v : []))(vault.secrets).map(
    (record) => record.id,
  )
  const authPkIds = ((v) => (v ? v : []))(vault.auth).map(
    (record) => record.pk_id,
  )
  const memberPkIds = ((v) => (v ? v : []))(vault.members).map(
    (record) => record.pk_id,
  )
  const joinEntries = ((v) => (v ? v : []))(vault.joins).map((record) =>
    parseJoinValue(record.id, record.data),
  )
  const sentinelShareCount = ((v) => (v ? v : []))(vault.sentinel_shares).length

  const passwordEntries = collectPasswordEntries(vault)
  const hasPasswordEnvelope = passwordEntries.length > 0
  // Device-key auth rows are primary; hybrid vaults keep auth alongside
  // password_entries.
  const unlockMode =
    authPkIds.length > 0
      ? UnlockMethod.Keys
      : hasPasswordEnvelope
        ? UnlockMethod.Password
        : UnlockMethod.Keys
  const activeEnvelope = passwordEntries[0]?.envelope
  const passwordEnvelopeCiphertext: PasswordEnvelopeCiphertextState =
    typeof activeEnvelope?.ciphertext === 'string'
      ? {
          kind: PasswordEnvelopeCiphertextStateKind.Present,
          ciphertext: activeEnvelope.ciphertext.trim(),
        }
      : { kind: PasswordEnvelopeCiphertextStateKind.Absent }

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

enum EventSecretParseKind {
  Invalid = 'invalid',
  Valid = 'valid',
}

type EventSecretParse =
  | { kind: EventSecretParseKind.Invalid }
  | { kind: EventSecretParseKind.Valid; secret: StoredSecretRecord }

function eventSecretToStored(secret?: EventSecretRecord): EventSecretParse {
  if (!secret?.id) return { kind: EventSecretParseKind.Invalid }
  return {
    kind: EventSecretParseKind.Valid,
    secret: {
      id: secret.id,
      type: ((...[v = StoredSecretRecordType.ApiKey]) => v)(secret.type),
      data: ((v) => (v ? v : ''))(secret.ciphertext),
    },
  }
}

function passwordEventEnvelope(
  envelope?: PasswordEnvelopeYaml,
): PasswordEnvelopeYaml {
  return ((v) => (v ? v : {}))(envelope)
}

function sortEventYamls(eventYamls: string[]): VaultEventYaml[] {
  return eventYamls
    .map((yaml) => {
      const parsed: unknown = parseYaml(yaml)
      return vaultYamlDecoder.decodeEvent(parsed)
    })
    .sort((left, right) =>
      ((v) => (v ? v : ''))(left.created_at).localeCompare(
        ((v) => (v ? v : ''))(right.created_at),
      ),
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
    for (const operation of ((v) => (v ? v : []))(event.operations)) {
      if (!operation.type) continue
      switch (operation.type) {
        case 'vault-imported':
          for (const secret of ((v) => (v ? v : []))(operation.secrets)) {
            const stored = eventSecretToStored(secret)
            if (stored.kind === EventSecretParseKind.Valid) {
              secrets.set(stored.secret.id, stored.secret)
            }
          }
          passwordEntries.clear()
          for (const entry of ((v) => (v ? v : []))(
            operation.password_entries,
          )) {
            if (entry.id) passwordEntries.set(entry.id, entry)
          }
          break
        case 'epoch-checkpoint':
          for (const secret of ((v) => (v ? v : []))(operation.secrets)) {
            const stored = eventSecretToStored(secret)
            if (stored.kind === EventSecretParseKind.Valid) {
              secrets.set(stored.secret.id, stored.secret)
            }
          }
          break
        case 'secret-created': {
          const stored = eventSecretToStored(operation.secret)
          if (stored.kind === EventSecretParseKind.Valid) {
            secrets.set(stored.secret.id, stored.secret)
          }
          break
        }
        case 'secret-deleted':
          if (operation.secret_id) secrets.delete(operation.secret_id)
          break
        case 'secret-replaced': {
          if (operation.old_id) secrets.delete(operation.old_id)
          const stored = eventSecretToStored(operation.new_secret)
          if (stored.kind === EventSecretParseKind.Valid) {
            secrets.set(stored.secret.id, stored.secret)
          }
          break
        }
        case 'secret-conflict-resolved':
          for (const rejected of ((v) => (v ? v : []))(
            operation.rejected_secret_ids,
          )) {
            secrets.delete(rejected)
          }
          break
        case 'join-requested':
          if (operation.device_id) {
            joins.set(operation.device_id, {
              deviceId: operation.device_id,
              publicKey: ((v) => (v ? v : ''))(operation.encryption_public_key),
            })
          }
          break
        case 'join-approved':
          if (operation.device_id) {
            joins.delete(operation.device_id)
            auth.set(operation.device_id, {
              pk_id: operation.device_id,
              secrets_key: ((v) => (v ? v : ''))(
                operation.secrets_key_ciphertext,
              ),
              members_key: ((v) => (v ? v : ''))(
                operation.members_key_ciphertext,
              ),
            })
            members.set(operation.device_id, {
              pk_id: operation.device_id,
              ciphertext: ((v) => (v ? v : ''))(
                operation.members_key_ciphertext,
              ),
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
          for (const share of ((v) => (v ? v : []))(operation.shares)) {
            const deviceId = share.device_id?.trim()
            if (!deviceId) continue
            sentinelShares.set(deviceId, {
              id: `sentinel_share:${deviceId}`,
              type: StoredSecretRecordType.SecureNote,
              data: ((v) => (v ? v : ''))(share.ciphertext),
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
            const entry: PasswordEntryYaml = {
              id: operation.entry_id,
              envelope: passwordEventEnvelope(operation.envelope),
            }
            if (operation.label) entry.label = operation.label
            passwordEntries.set(operation.entry_id, entry)
          }
          break
        case 'password-rotated':
          if (operation.entry_id) {
            const existing = passwordEntries.get(operation.entry_id)
            const entry: PasswordEntryYaml = {
              id: operation.entry_id,
              envelope: passwordEventEnvelope(operation.envelope),
            }
            if (existing?.label) entry.label = existing.label
            passwordEntries.set(operation.entry_id, entry)
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
        default:
          break
      }
    }
  }

  const projectionLikeYaml = stringifyYaml({
    secrets: [...secrets.values()],
    auth: [...auth.values()],
    joins: [...joins.values()].map((join) => ({
      id: join.deviceId,
      type: StoredSecretRecordType.SecureNote,
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
    throw new Error(
      `Join request for device ${((...[v = '(any)']) => v)(deviceId)} not found`,
    )
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

  const parsed: unknown = parseYaml(snapshot.raw)
  const vault = vaultYamlDecoder.decodeStoredVault(parsed)
  const authHasPlaintextAgeKey = ((v) => (v ? v : []))(vault.auth).some(
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
