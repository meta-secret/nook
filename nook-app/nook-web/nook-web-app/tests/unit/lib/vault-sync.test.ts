import { describe, expect, test } from 'vitest'
import {
  NookClientRunModeUtil,
  NookPendingSyncConflict,
  NookProviderSyncRevision,
  NookRuntimeConfig,
  type NookPendingSyncConflict as PendingSyncConflict,
} from '$app-wasm'
import { syncConflictLabel } from '$lib/vault/sync.svelte'
import {
  SyncConflictReviewKind,
  type SyncConflictReview,
} from '$lib/vault/state/sync.svelte'

enum TestSyncConflictKind {
  Content = 'content',
  StoreId = 'store-id',
}

function buildConflict(kind: TestSyncConflictKind): PendingSyncConflict {
  const revision = NookProviderSyncRevision.untracked()
  try {
    return kind === TestSyncConflictKind.StoreId
      ? NookPendingSyncConflict.storeId(
          'provider-1',
          'GitHub',
          'local',
          'remote',
          'github',
          'token',
          'owner/repo',
          revision,
          'store-local',
          'store-remote',
        )
      : NookPendingSyncConflict.content(
          'provider-1',
          'GitHub',
          'local',
          'remote',
          1,
          1,
          'github',
          'token',
          'owner/repo',
          revision,
        )
  } finally {
    revision.free()
  }
}

function labelFor(review: SyncConflictReview): string {
  return syncConflictLabel({
    syncConflictReview: review,
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
    expect(labelFor({ kind: SyncConflictReviewKind.Clear })).toBe('')
  })

  test('uses the content conflict banner for normal conflicts', () => {
    expect(
      labelFor({
        kind: SyncConflictReviewKind.RequiresDecision,
        conflict: buildConflict(TestSyncConflictKind.Content),
      }),
    ).toBe('auth_storage.sync_conflict_banner:GitHub')
  })

  test('uses the store-id conflict banner for store mismatches', () => {
    expect(
      labelFor({
        kind: SyncConflictReviewKind.RequiresDecision,
        conflict: buildConflict(TestSyncConflictKind.StoreId),
      }),
    ).toBe('auth_storage.sync_conflict_store_id_banner:GitHub')
  })
})
