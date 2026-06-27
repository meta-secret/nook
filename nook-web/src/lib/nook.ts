import type { NookVaultManager, NookSecretRecord } from './nook-wasm/nook_wasm'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

export function isoTimestamp(): string {
  return new Date().toISOString()
}

/** Generate a compact, URL-safe random ID (64-bit, base64url, no padding). */
export function generateId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  const base64 = btoa(String.fromCharCode(...bytes))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Prefixed secret-store item id (`pass_{token}`). */
export function generateSecretId(): string {
  return `pass_${generateId()}`
}

export type SecretRecord = {
  id: string
  type: VaultItemType
  data: string
}

export type VaultItemType = 'login' | 'api-key' | 'seed-phrase' | 'secure-note'

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

export type SecureNoteVaultItem = {
  id: string
  type: 'secure-note'
  title: string
  note: string
}

export type VaultItem =
  | LoginVaultItem
  | ApiKeyVaultItem
  | SeedPhraseVaultItem
  | SecureNoteVaultItem

export type VaultItemInput =
  | Omit<LoginVaultItem, 'id'>
  | Omit<ApiKeyVaultItem, 'id'>
  | Omit<SeedPhraseVaultItem, 'id'>
  | Omit<SecureNoteVaultItem, 'id'>

export function vaultItemTitle(item: VaultItem): string {
  if (item.type === 'seed-phrase') return item.name
  if (item.type === 'secure-note') return item.title
  return item.websiteUrl
}

export function vaultItemSecret(item: VaultItem): string {
  if (item.type === 'login') return item.password
  if (item.type === 'api-key') return item.key
  if (item.type === 'seed-phrase') return item.seed
  return item.note
}

export function createVaultItemRecord(item: VaultItemInput): SecretRecord {
  const { type, ...value } = item
  return {
    id: generateSecretId(),
    type,
    data: stringifyYaml(value),
  }
}

export function vaultItemToInput(item: VaultItem): VaultItemInput {
  if (item.type === 'login') {
    return {
      type: 'login',
      websiteUrl: item.websiteUrl,
      username: item.username,
      password: item.password,
      notes: item.notes,
    }
  }
  if (item.type === 'api-key') {
    return {
      type: 'api-key',
      websiteUrl: item.websiteUrl,
      key: item.key,
      expiresAt: item.expiresAt,
    }
  }
  if (item.type === 'seed-phrase') {
    return {
      type: 'seed-phrase',
      name: item.name,
      seed: item.seed,
    }
  }
  return {
    type: 'secure-note',
    title: item.title,
    note: item.note,
  }
}

export function vaultItemDataYaml(item: VaultItemInput): string {
  return createVaultItemRecord(item).data
}

export function parseVaultItem(record: SecretRecord): VaultItem {
  const value = parseYaml(record.data) as Record<string, unknown>
  if (record.type === 'login') {
    return {
      id: record.id,
      type: 'login',
      websiteUrl: String(value.websiteUrl),
      username: String(value.username),
      password: String(value.password),
      notes: String(value.notes),
    }
  }
  if (record.type === 'api-key') {
    return {
      id: record.id,
      type: 'api-key',
      websiteUrl: String(value.websiteUrl),
      key: String(value.key),
      expiresAt: String(value.expiresAt),
    }
  }
  if (record.type === 'seed-phrase') {
    return {
      id: record.id,
      type: 'seed-phrase',
      name: String(value.name),
      seed: String(value.seed),
    }
  }
  return {
    id: record.id,
    type: 'secure-note',
    title: String(value.title),
    note: String(value.note),
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
  label: string
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
    label: String(entry.label ?? ''),
  }))
}

export type VaultSyncResult = {
  changed: boolean
  access_status?:
    | 'ready'
    | 'new_vault'
    | 'needs_enrollment'
    | 'join_pending'
    | 'password_required'
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
    id: r.id,
    type: r.type as VaultItemType,
    data: r.data,
  }))
}
