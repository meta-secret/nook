import { describe, expect, test } from 'vitest'
import {
  NookClientRunModeUtil,
  NookPendingSyncConflict,
  NookRuntimeConfig,
} from '$lib/nook-wasm/nook_wasm'
import { syncConflictLabel, type PendingSyncConflict } from '$lib/vault/sync'

function buildConflict(kind?: string): PendingSyncConflict {
  return new NookPendingSyncConflict(
    'provider-1',
    'GitHub',
    'local',
    'remote',
    1,
    1,
    'github',
    'token',
    'owner/repo',
    undefined,
    kind,
    undefined,
    undefined,
  )
}

function labelFor(conflict: PendingSyncConflict | undefined): string {
  return syncConflictLabel({
    pendingSyncConflict: conflict,
    t: (key, values) => `${key}:${values?.provider ?? ''}`,
  })
}

describe('resolveVaultSyncIntervalMs', () => {
  test('production build ignores fast-sync env and uses 60s', () => {
    const config = new NookRuntimeConfig(
      NookClientRunModeUtil.parse('production'),
      false,
    )
    expect(config.resolveVaultSyncIntervalMs('1000')).toBe(60_000)
  })

  test('e2e build honors VITE_VAULT_SYNC_INTERVAL_MS', () => {
    const config = new NookRuntimeConfig(
      NookClientRunModeUtil.parse('production'),
      true,
    )
    expect(config.resolveVaultSyncIntervalMs('1000')).toBe(1000)
  })

  test('dev mode honors VITE_VAULT_SYNC_INTERVAL_MS', () => {
    const config = new NookRuntimeConfig(
      NookClientRunModeUtil.parse('development'),
      false,
    )
    expect(config.resolveVaultSyncIntervalMs('500')).toBe(500)
  })
})

describe('syncConflictLabel', () => {
  test('returns an empty label when no conflict is staged', () => {
    expect(labelFor(undefined)).toBe('')
  })

  test('uses the content conflict banner for normal conflicts', () => {
    expect(labelFor(buildConflict())).toBe(
      'auth_storage.sync_conflict_banner:GitHub',
    )
  })

  test('uses the store-id conflict banner for store mismatches', () => {
    expect(labelFor(buildConflict('store_id'))).toBe(
      'auth_storage.sync_conflict_store_id_banner:GitHub',
    )
  })
})
