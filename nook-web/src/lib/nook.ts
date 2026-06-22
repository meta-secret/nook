import type { NookVaultManager, NookSecretRecord } from './nook-wasm/nook_wasm'

export function isoTimestamp(): string {
  return new Date().toISOString()
}

export type SecretRecord = {
  key: string
  value: string
}

export type VaultItemType = 'login' | 'api-key' | 'seed-phrase'

export type LoginVaultItem = {
  id: string
  type: 'login'
  websiteUrl: string
  username: string
  password: string
  notes: string
}

export type ApiKeyVaultItem = {
  id: string
  type: 'api-key'
  websiteUrl: string
  key: string
  expiresAt: string
}

export type SeedPhraseVaultItem = {
  id: string
  type: 'seed-phrase'
  name: string
  seed: string
}

export type VaultItem = LoginVaultItem | ApiKeyVaultItem | SeedPhraseVaultItem

export type VaultItemInput =
  | Omit<LoginVaultItem, 'id'>
  | Omit<ApiKeyVaultItem, 'id'>
  | Omit<SeedPhraseVaultItem, 'id'>

type StoredVaultItem = VaultItemInput & {
  format: 'nook-vault-item'
  version: 1
}

export function vaultItemTitle(item: VaultItem): string {
  return item.type === 'seed-phrase' ? item.name : item.websiteUrl
}

export function vaultItemSecret(item: VaultItem): string {
  if (item.type === 'login') return item.password
  if (item.type === 'api-key') return item.key
  return item.seed
}

export function createVaultItemRecord(item: VaultItemInput): SecretRecord {
  const stored: StoredVaultItem = {
    ...item,
    format: 'nook-vault-item',
    version: 1,
  }
  const title = item.type === 'seed-phrase' ? item.name : item.websiteUrl
  return {
    key: `item:${title}:${crypto.randomUUID()}`,
    value: JSON.stringify(stored),
  }
}

export function parseVaultItem(record: SecretRecord): VaultItem {
  try {
    const stored = JSON.parse(record.value) as Record<string, unknown>
    if (
      stored.format === 'nook-vault-item' &&
      stored.version === 1 &&
      (stored.type === 'login' ||
        stored.type === 'api-key' ||
        stored.type === 'seed-phrase')
    ) {
      if (stored.type === 'login') {
        return {
          id: record.key,
          type: 'login',
          websiteUrl: String(stored.websiteUrl ?? ''),
          username: String(stored.username ?? ''),
          password: String(stored.password ?? ''),
          notes: String(stored.notes ?? ''),
        }
      }
      if (stored.type === 'api-key') {
        return {
          id: record.key,
          type: 'api-key',
          websiteUrl: String(stored.websiteUrl ?? ''),
          key: String(stored.key ?? ''),
          expiresAt: String(stored.expiresAt ?? ''),
        }
      }
      return {
        id: record.key,
        type: 'seed-phrase',
        name: String(stored.name ?? ''),
        seed: String(stored.seed ?? ''),
      }
    }
  } catch {
    // Existing label/value records remain usable as API keys.
  }
  return {
    id: record.key,
    type: 'api-key',
    websiteUrl: record.key,
    key: record.value,
    expiresAt: '',
  }
}

export type JoinRequest = {
  device_id: string
  public_key: string
  requested_at: string
}

export type VaultMember = {
  auth_id: string
  device_id: string
  public_key: string
  enrolled_at: string
}

export function mapWasmJoinRequests(raw: unknown): JoinRequest[] {
  const records = Array.from(raw as ArrayLike<Record<string, string>>)
  return records.map((entry) => ({
    device_id: String(entry.device_id ?? ''),
    public_key: String(entry.public_key ?? ''),
    requested_at: String(entry.requested_at ?? ''),
  }))
}

export function mapWasmVaultMembers(raw: unknown): VaultMember[] {
  const records = Array.from(raw as ArrayLike<Record<string, string>>)
  return records.map((entry) => ({
    auth_id: String(entry.auth_id ?? ''),
    device_id: String(entry.device_id ?? ''),
    public_key: String(entry.public_key ?? ''),
    enrolled_at: String(entry.enrolled_at ?? ''),
  }))
}

export type VaultSyncResult = {
  changed: boolean
  access_status?: 'ready' | 'new_vault' | 'needs_enrollment' | 'join_pending'
}

export function mapVaultSyncResult(raw: unknown): VaultSyncResult & {
  secrets?: SecretRecord[]
  pending_joins?: JoinRequest[]
  vault_members?: VaultMember[]
} {
  const value = raw as Record<string, unknown>
  const result: VaultSyncResult & {
    secrets?: SecretRecord[]
    pending_joins?: JoinRequest[]
    vault_members?: VaultMember[]
  } = {
    changed: Boolean(value.changed),
  }
  if (typeof value.access_status === 'string') {
    result.access_status =
      value.access_status as VaultSyncResult['access_status']
  }
  if (value.secrets !== undefined) {
    result.secrets = mapWasmRecords(value.secrets)
  }
  if (value.pending_joins !== undefined) {
    result.pending_joins = mapWasmJoinRequests(value.pending_joins)
  }
  if (value.vault_members !== undefined) {
    result.vault_members = mapWasmVaultMembers(value.vault_members)
  }
  return result
}

export async function getVaultManager(): Promise<NookVaultManager> {
  const loadWasm = async () => {
    const wasm = await import('./nook-wasm/nook_wasm.js')
    await wasm.default()
    return new wasm.NookVaultManager()
  }

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () =>
        reject(
          new Error(
            'Vault engine timed out while loading. Refresh and try again.',
          ),
        ),
      15_000,
    )
  })

  return Promise.race([loadWasm(), timeout])
}

export function mapWasmRecords(rawRecords: unknown): SecretRecord[] {
  const records = Array.from(rawRecords as ArrayLike<NookSecretRecord>)
  return records.map((r) => ({
    key: r.key,
    value: r.value,
  }))
}
