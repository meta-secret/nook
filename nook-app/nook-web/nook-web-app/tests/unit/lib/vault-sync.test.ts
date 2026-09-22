import { err } from 'neverthrow'
import { describe, expect, test, vi } from 'vitest'
import {
  DeviceProtectionStatus,
  NookClientRunModeUtil,
  NookPendingSyncConflict,
  NookProviderSyncRevision,
  NookRuntimeConfig,
  NookSyncConflictReview,
  JoinEnrollmentState,
  ProviderSyncFreshness,
  VaultSyncConflictKind,
} from '$app-wasm'
import {
  SyncConflictPresentation,
  VaultSyncActions,
} from '$lib/vault/sync.svelte'
import {
  TranslationMessage,
  type TranslationRequest,
} from '$lib/vault/translation'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'

function buildConflict(kind: VaultSyncConflictKind): NookPendingSyncConflict {
  const revision = NookProviderSyncRevision.untracked()
  try {
    return kind === VaultSyncConflictKind.StoreId
      ? NookPendingSyncConflict.store_id(
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
    return new SyncConflictPresentation({
      syncConflictReview: review,
      t: (request: TranslationRequest) => {
        const replacements = new TranslationMessage(
          request,
        ).translationReplacements()
        return `${new TranslationMessage(request).translationKey()}:${((v) => (v ? v : ''))(replacements.provider)}`
      },
    }).label
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
    expect(config.resolve_vault_sync_interval_ms('1000')).toBe(60_000)
  })

  test('e2e build honors VITE_VAULT_SYNC_INTERVAL_MS', () => {
    const config = new NookRuntimeConfig(
      NookClientRunModeUtil.parse('production'),
      true,
    )
    expect(config.resolve_vault_sync_interval_ms('1000')).toBe(1000)
  })

  test('dev mode honors VITE_VAULT_SYNC_INTERVAL_MS', () => {
    const config = new NookRuntimeConfig(
      NookClientRunModeUtil.parse('development'),
      false,
    )
    expect(config.resolve_vault_sync_interval_ms('500')).toBe(500)
  })
})

describe('automatic vault sync', () => {
  test('keeps a join-approval polling failure visible while unauthenticated', async () => {
    const state = VaultStateTestFixture.create()
    state.isAuthenticated = false
    state.joinEnrollmentPrompt = JoinEnrollmentState.Pending
    state.syncFromStorage = vi.fn(async () =>
      err(new VaultStorageFailure(VaultStorageFailureKind.OperationFailed)),
    )
    state.scheduleSync = vi.fn(
      (request: Parameters<typeof state.scheduleSync>[0]) => request.callback(),
    )

    new VaultSyncActions(state).startVaultSync()
    await Promise.resolve()
    await Promise.resolve()

    expect(state.errorMsg).toBe(I18N_KEYS.AuthStorageSyncFailed)
  })

  test('does not carry a join polling failure into the newly unlocked session', async () => {
    const state = VaultStateTestFixture.create()
    state.isAuthenticated = false
    state.joinEnrollmentPrompt = JoinEnrollmentState.Pending
    state.syncFromStorage = vi.fn(async () => {
      state.sessionEpoch += 1
      state.isAuthenticated = true
      state.joinEnrollmentPrompt = JoinEnrollmentState.None
      return err(
        new VaultStorageFailure(VaultStorageFailureKind.OperationFailed),
      )
    })
    state.scheduleSync = vi.fn(
      (request: Parameters<typeof state.scheduleSync>[0]) => request.callback(),
    )

    new VaultSyncActions(state).startVaultSync()
    await Promise.resolve()
    await Promise.resolve()

    expect(state.errorMsg).toBe('')
  })

  test('keeps an actionable background failure visible while unlocked', async () => {
    const state = VaultStateTestFixture.create()
    state.isAuthenticated = true
    state.deviceProtectionStatus = DeviceProtectionStatus.Unlocked
    state.syncFromStorage = vi.fn(async () =>
      err(new VaultStorageFailure(VaultStorageFailureKind.OperationFailed)),
    )
    state.scheduleSync = vi.fn()

    new VaultSyncActions(state).startVaultSync()
    await Promise.resolve()
    await Promise.resolve()

    expect(state.errorMsg).toBe(I18N_KEYS.AuthStorageSyncFailed)
  })

  test('does not promote a late background failure into a replacement session', async () => {
    const state = VaultStateTestFixture.create()
    state.isAuthenticated = true
    state.deviceProtectionStatus = DeviceProtectionStatus.Unlocked
    state.errorMsg = ''
    state.syncFromStorage = vi.fn(async () => {
      state.sessionEpoch += 1
      return err(
        new VaultStorageFailure(VaultStorageFailureKind.OperationFailed),
      )
    })
    state.scheduleSync = vi.fn()

    new VaultSyncActions(state).startVaultSync()
    await Promise.resolve()
    await Promise.resolve()

    expect(state.syncFromStorage).toHaveBeenCalledWith(
      ProviderSyncFreshness.Scheduled,
    )
    expect(state.errorMsg).toBe('')
  })
})

describe('syncConflictLabel', () => {
  test('returns an empty label when no conflict is staged', () => {
    expect(labelFor(NookSyncConflictReview.clear())).toBe('')
  })

  test('uses the content conflict banner for normal conflicts', () => {
    expect(
      labelFor(
        NookSyncConflictReview.requires_decision(
          buildConflict(VaultSyncConflictKind.Content),
        ),
      ),
    ).toBe('auth_storage.sync_conflict_banner:GitHub')
  })

  test('uses the store-id conflict banner for store mismatches', () => {
    expect(
      labelFor(
        NookSyncConflictReview.requires_decision(
          buildConflict(VaultSyncConflictKind.StoreId),
        ),
      ),
    ).toBe('auth_storage.sync_conflict_store_id_banner:GitHub')
  })
})
