import { ok, err } from 'neverthrow'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import { describe, expect, test, vi } from 'vitest'
import type { Mock } from 'vitest'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import {
  LocalVaultPresence,
  provider_draft_gap_translation_key,
  type ProviderDraft,
} from '$app-wasm'
import {
  scopedProviderVault,
  type ProviderKind,
  type StorageProvider,
} from '$lib/auth/providers'
import type {
  ActiveProviderCredentialsContext,
  ProviderSaveContext,
} from '$lib/vault/action-contexts'
import {
  ActiveProviderCredentialsActions,
  ProviderPersistenceActions,
  ProviderPersistenceOutcome,
  ProviderSaveOutcome,
} from '$lib/vault/providers.svelte'
import type { TranslationRequest } from '$lib/vault/translation'
import {
  ActiveVaultKind,
  LoginSetupKind,
  LoginVaultSelectionKind,
} from '$lib/vault/state/provider.svelte'
import { ProviderSetupKinds } from '$lib/vault/provider-setup-kinds'
import { ProviderDraftFixture, ProviderRowFixture } from '../provider-fixtures'

type AdapterState = Omit<
  ProviderSaveContext,
  | 'persistProviders'
  | 'clearLoginSetup'
  | 'applyActiveProviderCredentials'
  | 'stageProviderDraft'
> & {
  persistProviders: Mock<ProviderSaveContext['persistProviders']>
  clearLoginSetup: Mock<() => void>
  applyActiveProviderCredentials: Mock<() => void>
  stageProviderDraft: Mock<(draft: ProviderDraft) => void>
}

type SaveSetup = {
  readonly kind: ProviderKind
  readonly draft: ProviderDraft
}

function providerState({ kind, draft }: SaveSetup): AdapterState {
  return {
    providers: [],
    activeVault: { kind: ActiveVaultKind.Open, storeId: 'vault-1' },
    hasActiveVaultStore: true,
    selectedLoginVault: { kind: LoginVaultSelectionKind.NotSelected },
    hasManager: false,
    admitManager: () =>
      err(new VaultStorageFailure(VaultStorageFailureKind.ManagerUnavailable)),
    enqueueStorage: async <T>(operation: () => T | Promise<T>) => operation(),
    loginSetup: { kind: LoginSetupKind.Active, providerKind: kind },
    addProviderOpen: true,
    isAuthenticated: true,
    providerDraft: draft,
    stageProviderDraft: vi.fn(),
    errorMsg: '',
    loginRequiresExistingVault: true,
    t: (request: TranslationRequest) =>
      typeof request === 'string' ? request : request.key,
    clearLoginSetup: vi.fn(),
    applyActiveProviderCredentials: vi.fn(),
    persistProviders: vi.fn(async () =>
      ok(ProviderPersistenceOutcome.Persisted),
    ),
  }
}

type ProjectionState = Omit<
  ActiveProviderCredentialsContext,
  'stageProviderDraft'
> & {
  stageProviderDraft: Mock<(draft: ProviderDraft) => void>
}

function projectionState(provider: StorageProvider): ProjectionState {
  return {
    localVaultPresence: LocalVaultPresence.Absent,
    loginSetup: { kind: LoginSetupKind.Inactive },
    syncProviders: [provider],
    providerDraft: ProviderDraftFixture.thisBrowser(),
    stageProviderDraft: vi.fn(),
  }
}

/** Each persisted row's label and provider type, from the first save. */
function persistedRows(
  state: AdapterState,
): ReadonlyArray<readonly [string, string]> {
  const [call] = state.persistProviders.mock.calls
  if (!call) throw new Error('expected the providers to be persisted')
  const [options] = call
  return options.providers.map((row) => [row.label, row.provider.type] as const)
}

function scoped(row: StorageProvider): StorageProvider {
  return { ...row, storeId: scopedProviderVault('vault-1') }
}

describe('provider save web adapter', () => {
  test.each([
    ['GitHub', ProviderRowFixture.github(ProviderRowFixture.unscoped('gh'))],
    [
      'Google Drive',
      ProviderRowFixture.googleDrive(ProviderRowFixture.unscoped('gd')),
    ],
    [
      'local folder',
      ProviderRowFixture.localFolder(ProviderRowFixture.unscoped('lf')),
    ],
    ['S3', ProviderRowFixture.s3(ProviderRowFixture.unscoped('s3'))],
  ])(
    'stages the draft of a saved %s row through the portable projection',
    (_name, row) => {
      const state = projectionState(row)

      new ActiveProviderCredentialsActions(
        state,
      ).applyActiveProviderCredentials()

      expect(state.stageProviderDraft).toHaveBeenCalledOnce()
      const [call] = state.stageProviderDraft.mock.calls
      if (!call) throw new Error('expected a staged draft')
      const [staged] = call
      expect(staged.type).toBe(row.provider.type)
    },
  )

  test('saves a new S3 provider with the connection its form produced', async () => {
    const state = providerState({
      kind: ProviderSetupKinds.S3,
      draft: ProviderDraftFixture.s3Ready(),
    })

    const saved = await new ProviderPersistenceActions(
      state,
    ).ensureProviderSaved()

    expect(saved).toEqual(ok(ProviderSaveOutcome.Saved))
    expect(persistedRows(state)).toEqual([['S3 · nook-dev/e2e', 's3']])
  })

  test.each([
    [
      'an S3 setup without its connection',
      ProviderSetupKinds.S3,
      's3Awaiting',
      's3Connection',
    ],
    [
      'a folder setup without its folder',
      ProviderSetupKinds.LOCAL_FOLDER,
      'localFolderAwaiting',
      'localFolder',
    ],
    [
      'a GitHub setup without its token',
      ProviderSetupKinds.GITHUB,
      'githubAwaitingToken',
      'githubToken',
    ],
  ] as const)(
    'reports %s with the gap Rust names, without saving',
    async (_name, kind, stage, gap) => {
      const state = providerState({
        kind,
        draft: ProviderDraftFixture[stage](),
      })

      const saved = await new ProviderPersistenceActions(
        state,
      ).ensureProviderSaved()

      expect(saved.isErr()).toBe(true)
      if (saved.isOk()) return
      expect(saved.error.translationKey).toBe(
        provider_draft_gap_translation_key(gap),
      )
      expect(state.persistProviders).not.toHaveBeenCalled()
    },
  )

  test('maps an explicit duplicate to translated state without persistence', async () => {
    const state = providerState({
      kind: ProviderSetupKinds.GITHUB,
      draft: ProviderDraftFixture.githubEntered(),
    })
    state.providers = [
      scoped(ProviderRowFixture.github(ProviderRowFixture.unscoped('gh'))),
    ]

    const saved = await new ProviderPersistenceActions(
      state,
    ).ensureProviderSaved()

    expect(saved.isErr()).toBe(true)
    if (saved.isOk()) return
    expect(saved.error.translationKey).toBe(
      I18N_KEYS.AuthStorageDuplicateSyncProvider,
    )
    expect(state.persistProviders).not.toHaveBeenCalled()
  })

  test('persists the saved rows, stages the saved draft and projects again', async () => {
    const draft = ProviderDraftFixture.githubEntered()
    const state = providerState({ kind: ProviderSetupKinds.GITHUB, draft })

    const saved = await new ProviderPersistenceActions(
      state,
    ).ensureProviderSaved()

    expect(saved).toEqual(ok(ProviderSaveOutcome.Saved))
    expect(persistedRows(state).map(([, type]) => type)).toEqual(['github'])
    expect(state.stageProviderDraft).toHaveBeenCalledWith(draft)
    expect(state.clearLoginSetup).toHaveBeenCalledOnce()
    expect(state.applyActiveProviderCredentials).toHaveBeenCalledOnce()
    expect(state.persistProviders).toHaveBeenCalledOnce()
  })
})
