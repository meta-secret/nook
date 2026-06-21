import type { NookVaultManager, NookSecretRecord } from './nook-wasm/nook_wasm'

export type SecretRecord = {
  key: string
  value: string
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
