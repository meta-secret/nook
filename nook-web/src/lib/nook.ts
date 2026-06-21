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
