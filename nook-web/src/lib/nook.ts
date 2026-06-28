import type {
  NookJoinRequest,
  NookSecretRecord,
  NookVaultManager,
  NookVaultMember,
  NookVaultSyncResult,
} from './nook-wasm/nook_wasm'
import {
  NookSecretFormFields,
  buildSecretYaml as wasmBuildSecretYaml,
} from './nook-wasm/nook_wasm'

export type {
  NookJoinRequest,
  NookSecretRecord,
  NookVaultManager,
  NookVaultMember,
  NookVaultSyncResult,
  NookSecretFormFields,
}

/** UI alias — same typed object exported from WASM. */
export type JoinRequest = NookJoinRequest
export type VaultMember = NookVaultMember

/** UI-only tag for the add-secret type picker — canonical schema lives in `nook-core`. */
export type VaultItemType = 'login' | 'api-key' | 'seed-phrase' | 'secure-note'

/** Compact random id — prefer `NookVaultManager.generate_id()` when the manager is loaded. */
export function generateId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  const base64 = btoa(String.fromCharCode(...bytes))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Prefixed secret-store item id — prefer `NookVaultManager.generate_secret_id()` when available. */
export function generateSecretId(): string {
  return `secret_${generateId()}`
}

export function isoTimestamp(): string {
  return new Date().toISOString()
}

export type VaultSyncAccessStatus =
  | 'ready'
  | 'new_vault'
  | 'needs_enrollment'
  | 'join_pending'
  | 'password_required'

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

/** Build a validated YAML payload for `add_secret` / `replace_secret`. */
export function buildSecretYaml(
  secretType: VaultItemType,
  fields: Record<string, string>,
): string {
  return wasmBuildSecretYaml(
    secretType,
    new NookSecretFormFields(
      fields.websiteUrl ?? null,
      fields.username ?? null,
      fields.password ?? null,
      fields.notes ?? null,
      fields.key ?? null,
      fields.expiresAt ?? null,
      fields.name ?? null,
      fields.seed ?? null,
      fields.title ?? null,
      fields.note ?? null,
    ),
  )
}
