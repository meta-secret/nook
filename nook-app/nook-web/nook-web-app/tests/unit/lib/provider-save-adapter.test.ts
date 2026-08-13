import { describe, expect, test, vi } from 'vitest'
import type { Mock } from 'vitest'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import {
  GITHUB_PROVIDER_TYPE,
  LOCAL_PROVIDER_TYPE,
  LOCAL_FOLDER_PROVIDER_TYPE,
  OAUTH_FILE_PROVIDER_TYPE,
  configuredLocalFolder,
  configuredOAuthFile,
  defaultOAuthFileConfig,
  providerPersistenceDefaults,
  scopedProviderVault,
  storedGithubPat,
  storedGithubRepository,
  storedLocalFolderDirectory,
  storedLocalFolderHandle,
  type LocalFolderConfig,
  type OAuthFileConfig,
  type StorageProvider,
  type StorageProviderType,
} from '$lib/auth/providers'
import type {
  ActiveProviderCredentialsContext,
  ProviderSaveContext,
} from '$lib/vault/action-contexts'
import {
  applyActiveProviderCredentials,
  ensureProviderSaved,
} from '$lib/vault/providers.svelte'
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

function projectionState(
  provider: StorageProvider,
): ActiveProviderCredentialsContext {
  return {
    localVaultPresent: false,
    loginSetup: { kind: LoginSetupKind.Inactive },
    syncProviders: [provider],
    storageMode: LOCAL_PROVIDER_TYPE,
    githubPat: '',
    githubRepo: 'nook',
    oauthFileDraft: { kind: OAuthFileDraftKind.NotConfigured },
    localFolderDraft: { kind: LocalFolderDraftKind.NotConfigured },
    configureOauthFile: vi.fn(),
    clearOauthFile: vi.fn(),
    configureLocalFolder: vi.fn(),
    clearLocalFolder: vi.fn(),
  }
}

function oauthProvider(config: OAuthFileConfig): StorageProvider {
  return {
    ...providerPersistenceDefaults(),
    id: 'oauth-existing',
    type: OAUTH_FILE_PROVIDER_TYPE,
    label: 'Google Drive',
    oauthFile: configuredOAuthFile(config),
    storeId: scopedProviderVault('vault-1'),
    createdAt: '2026-08-11T00:00:00Z',
  }
}

function localFolderProvider(config: LocalFolderConfig): StorageProvider {
  return {
    ...providerPersistenceDefaults(),
    id: 'folder-existing',
    type: LOCAL_FOLDER_PROVIDER_TYPE,
    label: 'Local folder',
    localFolder: configuredLocalFolder(config),
    storeId: scopedProviderVault('vault-1'),
    createdAt: '2026-08-11T00:00:00Z',
  }
}

describe('provider save web adapter', () => {
  test('applies a saved GitHub provider through the portable projection', () => {
    const state = projectionState(githubProvider())

    applyActiveProviderCredentials(state)

    expect(state.storageMode).toBe(GITHUB_PROVIDER_TYPE)
    expect(state.githubPat).toBe('pat')
    expect(state.githubRepo).toBe('owner/repo')
    expect(state.clearOauthFile).toHaveBeenCalledOnce()
    expect(state.clearLocalFolder).toHaveBeenCalledOnce()
  })

  test('applies a saved OAuth-file provider through the portable projection', () => {
    const oauthFile = defaultOAuthFileConfig({
      preset: 'google-drive',
      fileName: 'portable-vault.yaml',
    })
    const state = projectionState(oauthProvider(oauthFile))

    applyActiveProviderCredentials(state)

    expect(state.storageMode).toBe(OAUTH_FILE_PROVIDER_TYPE)
    expect(state.githubRepo).toBe('portable-vault.yaml')
    expect(state.configureOauthFile).toHaveBeenCalledWith(oauthFile)
    expect(state.clearLocalFolder).toHaveBeenCalledOnce()
  })

  test('applies a saved local-folder provider through the portable projection', () => {
    const localFolder: LocalFolderConfig = {
      directoryName: storedLocalFolderDirectory('Vaults'),
      handleId: storedLocalFolderHandle('folder-handle'),
    }
    const state = projectionState(localFolderProvider(localFolder))

    applyActiveProviderCredentials(state)

    expect(state.storageMode).toBe(LOCAL_FOLDER_PROVIDER_TYPE)
    expect(state.configureLocalFolder).toHaveBeenCalledWith(localFolder)
    expect(state.clearOauthFile).toHaveBeenCalledOnce()
  })

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
