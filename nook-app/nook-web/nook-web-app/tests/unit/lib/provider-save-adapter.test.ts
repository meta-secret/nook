import { ok, err } from 'neverthrow'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import { describe, expect, test, vi } from 'vitest'
import type { Mock } from 'vitest'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import {
  GITHUB_PROVIDER_TYPE,
  LOCAL_PROVIDER_TYPE,
  LOCAL_FOLDER_PROVIDER_TYPE,
  OAUTH_FILE_PROVIDER_TYPE,
  S3_PROVIDER_TYPE,
  configuredLocalFolder,
  configuredOAuthFile,
  configuredS3,
  defaultOAuthFileConfig,
  providerPersistenceDefaults,
  s3ConfigurationNotApplicable,
  scopedProviderVault,
  storedGithubPat,
  storedGithubRepository,
  storedLocalFolderDirectory,
  storedLocalFolderHandle,
  type LocalFolderConfig,
  type OAuthFileConfig,
  type S3ProviderConfig,
  type StorageProvider,
  type StorageProviderType,
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
  LocalFolderDraftKind,
  LoginSetupKind,
  LoginVaultSelectionKind,
  OAuthFileDraftKind,
  OAuthSetupPresetKind,
} from '$lib/vault/state/provider.svelte'
import { S3ConnectionFixture } from '../s3-connection-fixture'

type AdapterState = Omit<
  ProviderSaveContext,
  'persistProviders' | 'clearLoginSetup' | 'applyActiveProviderCredentials'
> & {
  persistProviders: Mock<ProviderSaveContext['persistProviders']>
  clearLoginSetup: Mock<() => void>
  applyActiveProviderCredentials: Mock<() => void>
}

function providerState(providerType: StorageProviderType): AdapterState {
  return {
    providers: [],
    activeVault: { kind: ActiveVaultKind.Open, storeId: 'vault-1' },
    hasActiveVaultStore: true,
    selectedLoginVault: { kind: LoginVaultSelectionKind.NotSelected },
    hasManager: false,
    admitManager: () =>
      err(new VaultStorageFailure(VaultStorageFailureKind.ManagerUnavailable)),
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
    s3Configuration: s3ConfigurationNotApplicable(),
    errorMsg: '',
    loginRequiresExistingVault: true,
    t: (request: TranslationRequest) =>
      typeof request === 'string' ? request : request.key,
    configureOauthFile: vi.fn(),
    clearLoginSetup: vi.fn(),
    applyActiveProviderCredentials: vi.fn(),
    persistProviders: vi.fn(async () =>
      ok(ProviderPersistenceOutcome.Persisted),
    ),
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
    s3Configuration: s3ConfigurationNotApplicable(),
    configureS3: vi.fn(),
    clearS3: vi.fn(),
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

function s3Provider(config: S3ProviderConfig): StorageProvider {
  return {
    ...providerPersistenceDefaults(),
    id: 's3-existing',
    type: S3_PROVIDER_TYPE,
    label: 'S3 · nook-dev/e2e',
    s3: configuredS3(config),
    createdAt: '2026-10-31T00:00:00Z',
  }
}

/** An S3 setup whose form produced this configuration. */
function s3SetupState(config: S3ProviderConfig): AdapterState {
  return {
    ...providerState(S3_PROVIDER_TYPE),
    githubPat: '',
    s3Configuration: configuredS3(config),
  }
}

describe('provider save web adapter', () => {
  test('applies a saved GitHub provider through the portable projection', () => {
    const state = projectionState(githubProvider())

    new ActiveProviderCredentialsActions(state).applyActiveProviderCredentials()

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

    new ActiveProviderCredentialsActions(state).applyActiveProviderCredentials()

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

    new ActiveProviderCredentialsActions(state).applyActiveProviderCredentials()

    expect(state.storageMode).toBe(LOCAL_FOLDER_PROVIDER_TYPE)
    expect(state.configureLocalFolder).toHaveBeenCalledWith(localFolder)
    expect(state.clearOauthFile).toHaveBeenCalledOnce()
  })

  test('applies a saved S3 provider through the portable projection', () => {
    const config = S3ConnectionFixture.configuration()
    const state = projectionState(s3Provider(config))

    new ActiveProviderCredentialsActions(state).applyActiveProviderCredentials()

    expect(state.storageMode).toBe(S3_PROVIDER_TYPE)
    expect(state.githubPat).toBe('')
    expect(state.configureS3).toHaveBeenCalledWith(config)
    expect(state.clearS3).not.toHaveBeenCalled()
    expect(state.clearOauthFile).toHaveBeenCalledOnce()
    expect(state.clearLocalFolder).toHaveBeenCalledOnce()
  })

  test('drops the S3 connection when another provider is in use', () => {
    const state = projectionState(githubProvider())

    new ActiveProviderCredentialsActions(state).applyActiveProviderCredentials()

    expect(state.clearS3).toHaveBeenCalledOnce()
    expect(state.configureS3).not.toHaveBeenCalled()
  })

  test('saves a new S3 provider with the block its form produced', async () => {
    const config = S3ConnectionFixture.configuration()
    const state = s3SetupState(config)

    const saved = await new ProviderPersistenceActions(
      state,
    ).ensureProviderSaved()

    expect(saved).toEqual(ok(ProviderSaveOutcome.Saved))
    expect(state.persistProviders).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: [
          expect.objectContaining({
            type: S3_PROVIDER_TYPE,
            label: 'S3 · nook-dev/e2e',
            s3: configuredS3(config),
          }),
        ],
      }),
    )
  })

  test('maps an S3 setup without its connection to translated state', async () => {
    const state = providerState(S3_PROVIDER_TYPE)

    const saved = await new ProviderPersistenceActions(
      state,
    ).ensureProviderSaved()

    expect(saved.isErr()).toBe(true)
    if (saved.isOk()) return
    expect(saved.error.translationKey).toBe(
      I18N_KEYS.ErrorsValidationS3StorageTargetInvalid,
    )
    expect(state.persistProviders).not.toHaveBeenCalled()
  })

  test('maps an explicit duplicate to translated state without persistence', async () => {
    const state = providerState(GITHUB_PROVIDER_TYPE)
    state.providers = [githubProvider()]

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

  test('maps a missing local folder to translated state', async () => {
    const state = providerState(LOCAL_FOLDER_PROVIDER_TYPE)

    const saved = await new ProviderPersistenceActions(
      state,
    ).ensureProviderSaved()

    expect(saved.isErr()).toBe(true)
    if (saved.isOk()) return
    expect(saved.error.translationKey).toBe(
      I18N_KEYS.AuthStorageLocalFolderChooseErr,
    )
    expect(state.persistProviders).not.toHaveBeenCalled()
  })

  test('applies and persists a successful provider snapshot', async () => {
    const state = providerState(GITHUB_PROVIDER_TYPE)

    const saved = await new ProviderPersistenceActions(
      state,
    ).ensureProviderSaved()

    expect(saved).toEqual(ok(ProviderSaveOutcome.Saved))
    expect(state.persistProviders).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: [expect.objectContaining({ type: GITHUB_PROVIDER_TYPE })],
      }),
    )
    expect(state.clearLoginSetup).toHaveBeenCalledOnce()
    expect(state.applyActiveProviderCredentials).toHaveBeenCalledOnce()
    expect(state.persistProviders).toHaveBeenCalledOnce()
  })
})
