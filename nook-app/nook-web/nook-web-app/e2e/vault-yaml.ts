import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

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

type StoredVaultYaml = {
  secrets?: StoredSecretRecord[]
  auth?: AuthYamlRecord[]
  joins?: StoredSecretRecord[]
  members?: MembersYamlRecord[]
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
  shares?: Array<{ device_id?: string; ciphertext?: string }>
}

type VaultEventYaml = {
  created_at?: string
  operations?: VaultEventOperation[]
}

enum VaultYamlOptionalStringStateKind {
  Absent = 'absent',
  Present = 'present',
}

type VaultYamlOptionalStringState =
  | { kind: VaultYamlOptionalStringStateKind.Absent }
  | { kind: VaultYamlOptionalStringStateKind.Present; value: string }

class VaultYamlDecoder {
  decodeStoredVault(value: unknown): StoredVaultYaml {
    try {
      const vaultValue = this.decodeObject(value, 'vault YAML')
      const vault: StoredVaultYaml = {}
      if ('secrets' in vaultValue)
        vault.secrets = this.decodeStoredSecrets(vaultValue.secrets)
      if ('auth' in vaultValue)
        vault.auth = this.decodeAuthRecords(vaultValue.auth)
      if ('joins' in vaultValue)
        vault.joins = this.decodeStoredSecrets(vaultValue.joins)
      if ('members' in vaultValue)
        vault.members = this.decodeMembers(vaultValue.members)
      if ('sentinel_shares' in vaultValue) {
        vault.sentinel_shares = this.decodeStoredSecrets(
          vaultValue.sentinel_shares,
        )
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
      if (createdAt.kind === VaultYamlOptionalStringStateKind.Present) {
        event.created_at = createdAt.value
      }
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

  decodeJoin(
    value: unknown,
    fallbackId: string,
  ): { deviceId: string; publicKey: string } {
    let payload: Record<string, unknown>
    try {
      payload = this.decodeObject(value, 'join YAML')
    } catch {
      return { deviceId: fallbackId, publicKey: '' }
    }
    const deviceIdField = this.optionalString(payload, 'device_id')
    const publicKeyField = this.optionalString(payload, 'public_key')
    const deviceId =
      deviceIdField.kind === VaultYamlOptionalStringStateKind.Present
        ? deviceIdField.value
        : fallbackId
    const publicKey =
      publicKeyField.kind === VaultYamlOptionalStringStateKind.Present
        ? publicKeyField.value
        : ''
    return { deviceId, publicKey }
  }

  private decodeObject(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(`${label} must be an object`)
    }
    return Object.fromEntries(Object.entries(value))
  }

  private optionalString(
    value: Record<string, unknown>,
    key: string,
  ): VaultYamlOptionalStringState {
    if (!(key in value)) {
      return { kind: VaultYamlOptionalStringStateKind.Absent }
    }
    const field: unknown = Reflect.get(value, key)
    if (typeof field !== 'string')
      throw new TypeError(`${key} must be a string`)
    return { kind: VaultYamlOptionalStringStateKind.Present, value: field }
  }

  private decodeStoredSecrets(value: unknown): StoredSecretRecord[] {
    if (!Array.isArray(value)) throw new TypeError('secrets must be an array')
    return value.map((entry) => {
      const secret = this.decodeObject(entry, 'secret')
      const id = this.optionalString(secret, 'id')
      const data = this.optionalString(secret, 'data')
      const type = this.optionalString(secret, 'type')
      if (
        id.kind !== VaultYamlOptionalStringStateKind.Present ||
        data.kind !== VaultYamlOptionalStringStateKind.Present ||
        type.kind !== VaultYamlOptionalStringStateKind.Present ||
        !id.value ||
        !data.value ||
        !type.value
      ) {
        throw new TypeError('secret fields are invalid')
      }
      return {
        id: id.value,
        data: data.value,
        type: this.decodeStoredSecretType(type.value),
      }
    })
  }

  private decodeStoredSecretType(value: string): StoredSecretRecordType {
    switch (value) {
      case StoredSecretRecordType.Login:
        return StoredSecretRecordType.Login
      case StoredSecretRecordType.ApiKey:
        return StoredSecretRecordType.ApiKey
      case StoredSecretRecordType.SeedPhrase:
        return StoredSecretRecordType.SeedPhrase
      case StoredSecretRecordType.SecureNote:
        return StoredSecretRecordType.SecureNote
      default:
        throw new TypeError('secret type is invalid')
    }
  }

  private decodeAuthRecords(value: unknown): AuthYamlRecord[] {
    if (!Array.isArray(value)) throw new TypeError('auth must be an array')
    return value.map((entry) => {
      const auth = this.decodeObject(entry, 'auth record')
      const pk_id = this.optionalString(auth, 'pk_id')
      const secrets_key = this.optionalString(auth, 'secrets_key')
      const members_key = this.optionalString(auth, 'members_key')
      if (
        pk_id.kind !== VaultYamlOptionalStringStateKind.Present ||
        secrets_key.kind !== VaultYamlOptionalStringStateKind.Present ||
        members_key.kind !== VaultYamlOptionalStringStateKind.Present ||
        !pk_id.value ||
        !secrets_key.value ||
        !members_key.value
      ) {
        throw new TypeError('auth record fields are invalid')
      }
      return {
        pk_id: pk_id.value,
        secrets_key: secrets_key.value,
        members_key: members_key.value,
      }
    })
  }

  private decodeMembers(value: unknown): MembersYamlRecord[] {
    if (!Array.isArray(value)) throw new TypeError('members must be an array')
    return value.map((entry) => {
      const member = this.decodeObject(entry, 'member')
      const pk_id = this.optionalString(member, 'pk_id')
      const ciphertext = this.optionalString(member, 'ciphertext')
      if (
        pk_id.kind !== VaultYamlOptionalStringStateKind.Present ||
        ciphertext.kind !== VaultYamlOptionalStringStateKind.Present ||
        !pk_id.value ||
        !ciphertext.value
      )
        throw new TypeError('member fields are invalid')
      return { pk_id: pk_id.value, ciphertext: ciphertext.value }
    })
  }

  private decodeOperation(value: unknown): VaultEventOperation {
    const operationValue = this.decodeObject(value, 'event operation')
    const operation: VaultEventOperation = {}
    const stringFields = [
      'type',
      'secret_id',
      'old_id',
      'chosen_secret_id',
      'device_id',
      'encryption_public_key',
      'secrets_key_ciphertext',
      'members_key_ciphertext',
    ] as const
    for (const field of stringFields) {
      const decoded = this.optionalString(operationValue, field)
      if (decoded.kind === VaultYamlOptionalStringStateKind.Present) {
        operation[field] = decoded.value
      }
    }
    if ('secrets' in operationValue)
      operation.secrets = this.decodeEventSecrets(operationValue.secrets)
    if ('secret' in operationValue)
      operation.secret = this.decodeEventSecret(operationValue.secret)
    if ('new_secret' in operationValue)
      operation.new_secret = this.decodeEventSecret(operationValue.new_secret)
    if ('rejected_secret_ids' in operationValue) {
      operation.rejected_secret_ids = this.decodeStringList(
        operationValue.rejected_secret_ids,
      )
    }
    if ('shares' in operationValue)
      operation.shares = this.decodeShares(operationValue.shares)
    return operation
  }

  private decodeEventSecrets(value: unknown): EventSecretRecord[] {
    if (!Array.isArray(value))
      throw new TypeError('event secrets must be an array')
    return value.map((entry) => this.decodeEventSecret(entry))
  }

  private decodeEventSecret(value: unknown): EventSecretRecord {
    const eventSecret = this.decodeObject(value, 'event secret')
    const id = this.optionalString(eventSecret, 'id')
    const ciphertext = this.optionalString(eventSecret, 'ciphertext')
    const type = this.optionalString(eventSecret, 'type')
    const decoded: EventSecretRecord = {}
    if (id.kind === VaultYamlOptionalStringStateKind.Present) {
      decoded.id = id.value
    }
    if (ciphertext.kind === VaultYamlOptionalStringStateKind.Present) {
      decoded.ciphertext = ciphertext.value
    }
    if (type.kind === VaultYamlOptionalStringStateKind.Present) {
      decoded.type = this.decodeStoredSecretType(type.value)
    }
    return decoded
  }

  private decodeStringList(value: unknown): string[] {
    if (!Array.isArray(value))
      throw new TypeError('string list must be an array')
    return value.map((entry) => {
      if (typeof entry !== 'string')
        throw new TypeError('string list value is invalid')
      return entry
    })
  }

  private decodeShares(
    value: unknown,
  ): Array<{ device_id?: string; ciphertext?: string }> {
    if (!Array.isArray(value)) throw new TypeError('shares must be an array')
    return value.map((entry) => {
      const shareValue = this.decodeObject(entry, 'share')
      const share: { device_id?: string; ciphertext?: string } = {}
      const deviceId = this.optionalString(shareValue, 'device_id')
      const ciphertext = this.optionalString(shareValue, 'ciphertext')
      if (deviceId.kind === VaultYamlOptionalStringStateKind.Present) {
        share.device_id = deviceId.value
      }
      if (ciphertext.kind === VaultYamlOptionalStringStateKind.Present) {
        share.ciphertext = ciphertext.value
      }
      return share
    })
  }
}

const vaultYamlDecoder = new VaultYamlDecoder()

export type VaultYamlSnapshot = {
  raw: string
  secretIds: string[]
  authPkIds: string[]
  joinEntries: Array<{ deviceId: string; publicKey: string }>
  memberPkIds: string[]
  /** Count of sentinel share records / issued share payloads observed. */
  sentinelShareCount: number
}

function parseJoinValue(
  key: string,
  value: string,
): { deviceId: string; publicKey: string } {
  const parsed: unknown = JSON.parse(value)
  return vaultYamlDecoder.decodeJoin(parsed, key)
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


  return {
    raw: yaml,
    secretIds,
    authPkIds,
    joinEntries,
    memberPkIds,
    sentinelShareCount,
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
        case 'vault-cleared':
          secrets.clear()
          joins.clear()
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
  })

  return parseVaultYamlSnapshot(projectionLikeYaml)
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
