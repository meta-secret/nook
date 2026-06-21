import type { NookVaultManager, NookSecretRecord } from './nook-wasm/nook_wasm'

export type SecretRecord = {
  key: string
  value: string
}

export async function getVaultManager(): Promise<NookVaultManager> {
  const wasm = await import('./nook-wasm/nook_wasm.js')
  await wasm.default()
  return new wasm.NookVaultManager()
}

export function mapWasmRecords(rawRecords: NookSecretRecord[]): SecretRecord[] {
  return rawRecords.map((r) => ({
    key: r.key,
    value: r.value,
  }))
}
