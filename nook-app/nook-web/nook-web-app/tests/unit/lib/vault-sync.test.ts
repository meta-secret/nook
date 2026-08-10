import { describe, expect, test } from 'vitest'
import {
  NookClientRunModeUtil,
  NookPendingSyncConflict,
  NookProviderSyncRevision,
  NookRuntimeConfig,
  NookSyncConflictReview,
  VaultSyncConflictKind,
} from '$app-wasm'
import { syncConflictLabel } from '$lib/vault/sync.svelte'
import {
  translationKey,
  translationReplacements,
  type TranslationRequest,
} from '$lib/vault/translation'

function buildConflict(kind: VaultSyncConflictKind): NookPendingSyncConflict {
  const revision = NookProviderSyncRevision.untracked()
  try {
    return kind === VaultSyncConflictKind.StoreId
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

function labelFor(review: NookSyncConflictReview): string {
  try {
    return syncConflictLabel({
      syncConflictReview: review,
      t: (request: TranslationRequest) => {
        const replacements = translationReplacements(request)
        return `${translationKey(request)}:${replacements.provider ?? ''}`
      },
    })
  } finally {
    review.free()
  }
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
    expect(labelFor(NookSyncConflictReview.clear())).toBe('')
  })

  test('uses the content conflict banner for normal conflicts', () => {
    expect(
      labelFor(
        NookSyncConflictReview.requiresDecision(
          buildConflict(VaultSyncConflictKind.Content),
        ),
      ),
    ).toBe('auth_storage.sync_conflict_banner:GitHub')
  })

  test('uses the store-id conflict banner for store mismatches', () => {
    expect(
      labelFor(
        NookSyncConflictReview.requiresDecision(
          buildConflict(VaultSyncConflictKind.StoreId),
        ),
      ),
    ).toBe('auth_storage.sync_conflict_store_id_banner:GitHub')
  })
})
