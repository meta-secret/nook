import type { AuthProvidersSnapshot } from '$lib/auth-providers'
import { hasLocalVault } from '$lib/local-vault'
import {
  ensureLocalProviderRow as ensureLocalProviderRowWasm,
  normalizeAuthSnapshot as normalizeAuthSnapshotWasm,
} from '$lib/nook-wasm/nook_wasm'

/** Drop deprecated `activeProviderId` from persisted auth snapshots. */
export function normalizeAuthSnapshot(raw: unknown): {
  snapshot: AuthProvidersSnapshot
  legacyActiveProviderId: string | null
  changed: boolean
} {
  return normalizeAuthSnapshotWasm(raw) as {
    snapshot: AuthProvidersSnapshot
    legacyActiveProviderId: string | null
    changed: boolean
  }
}

/** Ensure a local provider row exists for the active vault. */
export function ensureLocalProviderRow(
  snapshot: AuthProvidersSnapshot,
  activeStoreId?: string,
): AuthProvidersSnapshot {
  return ensureLocalProviderRowWasm(
    JSON.parse(JSON.stringify(snapshot)),
    activeStoreId ?? undefined,
  ) as AuthProvidersSnapshot
}

/** Ensure auth snapshots always keep a local provider row for this device. */
export async function ensureLocalAuthProviderSnapshot(
  snapshot: AuthProvidersSnapshot,
  _previousActiveProviderId: string | null = null,
): Promise<{ snapshot: AuthProvidersSnapshot; migrated: boolean }> {
  if (await hasLocalVault()) {
    return {
      snapshot: ensureLocalProviderRow(snapshot),
      migrated: false,
    }
  }
  return { snapshot, migrated: false }
}
