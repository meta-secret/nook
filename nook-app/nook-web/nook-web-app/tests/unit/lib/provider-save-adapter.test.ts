import { describe, expect, test, vi } from 'vitest'
import type { Mock } from 'vitest'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import {
  GITHUB_PROVIDER_TYPE,
  LOCAL_FOLDER_PROVIDER_TYPE,
  providerPersistenceDefaults,
  scopedProviderVault,
  storedGithubPat,
  storedGithubRepository,
  type StorageProvider,
  type StorageProviderType,
} from '$lib/auth/providers'
import type { ProviderSaveContext } from '$lib/vault/action-contexts'
import { ensureProviderSaved } from '$lib/vault/providers.svelte'
import type { TranslationRequest } from '$lib/vault/translation'
import {
  ActiveVaultKind,
  LocalFolderDraftKind,
  LoginSetupKind,
  LoginVaultSelectionKind,
  OAuthFileDraftKind,
  OAuthSetupPresetKind,
} from '$lib/vault/state/provider.svelte'

type AdapterState = Omit<
  ProviderSaveContext,
  'persistProviders' | 'clearLoginSetup' | 'applyActiveProviderCredentials'
> & {
  persistProviders: Mock<() => Promise<void>>
  clearLoginSetup: Mock<() => void>
  applyActiveProviderCredentials: Mock<() => void>
}

function providerState(providerType: StorageProviderType): AdapterState {
  return {
    providers: [],
    activeVault: { kind: ActiveVaultKind.Open, storeId: 'vault-1' },
    hasActiveVaultStore: true,
    requireActiveVaultStoreId: () => 'vault-1',
    selectedLoginVault: { kind: LoginVaultSelectionKind.NotSelected },
    hasManager: false,
    requireManager: () => {
      throw new Error('provider save adapter fixture has no manager')
    },
    enqueueStorage: async <T>(operation: () => T | Promise<T>) => operation(),
    loginSetup: { kind: LoginSetupKind.Active, providerType },
    storageMode: providerType,
    addProviderOpen: true,
    isAuthenticated: true,
    githubPat: 'pat',
    githubRepo: 'owner/repo',
    oauthFileDraft: { kind: OAuthFileDraftKind.NotConfigured },
    oauthSetupSelection: { kind: OAuthSetupPresetKind.NotSelected },
    localFolderDraft: { kind: LocalFolderDraftKind.NotConfigured },
    errorMsg: '',
    loginRequiresExistingVault: true,
    t: (request: TranslationRequest) =>
      typeof request === 'string' ? request : request.key,
    configureOauthFile: vi.fn(),
    clearLoginSetup: vi.fn(),
    applyActiveProviderCredentials: vi.fn(),
    persistProviders: vi.fn(async () => {}),
  }
}

function githubProvider(): StorageProvider {
  return {
    ...providerPersistenceDefaults(),
    id: 'github-existing',
    type: GITHUB_PROVIDER_TYPE,
    label: 'GitHub · owner/repo',
    githubPat: storedGithubPat('pat'),
    githubRepo: storedGithubRepository('owner/repo'),
    storeId: scopedProviderVault('vault-1'),
    createdAt: '2026-08-11T00:00:00Z',
  }
}

describe('provider save web adapter', () => {
  test('maps an explicit duplicate to translated state without persistence', async () => {
    const state = providerState(GITHUB_PROVIDER_TYPE)
    state.providers = [githubProvider()]

    const saved = await ensureProviderSaved(state)

    expect(saved).toBe(false)
    expect(state.errorMsg).toBe(I18N_KEYS.AuthStorageDuplicateSyncProvider)
    expect(state.persistProviders).not.toHaveBeenCalled()
  })

  test('maps a missing local folder to translated state', async () => {
    const state = providerState(LOCAL_FOLDER_PROVIDER_TYPE)

    const saved = await ensureProviderSaved(state)

    expect(saved).toBe(false)
    expect(state.errorMsg).toBe(I18N_KEYS.AuthStorageLocalFolderChooseErr)
    expect(state.persistProviders).not.toHaveBeenCalled()
  })

  test('applies and persists a successful provider snapshot', async () => {
    const state = providerState(GITHUB_PROVIDER_TYPE)

    const saved = await ensureProviderSaved(state)

    expect(saved).toBe(true)
    expect(state.providers).toHaveLength(1)
    expect(state.providers[0]?.type).toBe(GITHUB_PROVIDER_TYPE)
    expect(state.clearLoginSetup).toHaveBeenCalledOnce()
    expect(state.applyActiveProviderCredentials).toHaveBeenCalledOnce()
    expect(state.persistProviders).toHaveBeenCalledOnce()
  })
})
