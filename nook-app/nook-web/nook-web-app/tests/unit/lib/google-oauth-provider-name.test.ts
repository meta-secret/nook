// @vitest-environment-options { "url": "http://localhost:5173/" }

import { afterEach, describe, expect, test, vi } from 'vitest'
import { err, ok } from 'neverthrow'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import {
  GoogleAccountIdentityKind,
  GoogleDriveOAuthScope,
  googleOAuthSession,
} from '$lib/auth/google/oauth'
import { OAuthFailure, OAuthFailureKind } from '$lib/auth/oauth-failure'
import {
  DEFAULT_DRIVE_BACKUP_NAME,
  OAUTH_FILE_PROVIDER_TYPE,
  defaultOAuthFileConfig,
  storedOAuthRemoteFileName,
} from '$lib/auth/providers'
import {
  ProviderPersistenceActions,
  ProviderPersistenceOutcome,
  ProviderSaveOutcome,
  VaultProviderActions,
} from '$lib/vault/providers.svelte'
import {
  GoogleVaultFolderOrigin,
  OAuthOperationOutcome,
  VaultOAuthActions,
} from '$lib/vault/oauth'
import {
  LoginSetupKind,
  OAuthFileDraftKind,
  StagedRemoteStorageKind,
} from '$lib/vault/state/provider.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

const wasm = vi.hoisted(() => ({
  connectGoogleDriveVaultFolder: vi.fn(),
  listGoogleDriveVaults: vi.fn(),
}))

vi.mock('$app-wasm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$app-wasm')>()),
  connect_google_drive_vault_folder: wasm.connectGoogleDriveVaultFolder,
  list_google_drive_vaults: wasm.listGoogleDriveVaults,
}))

const GOOGLE_TOKENS = {
  accessToken: 'test-google-access-token',
  expiresAt: '2030-01-01T00:00:00.000Z',
}

function mockGoogleTokenApplication() {
  const tokenRequest = vi
    .spyOn(googleOAuthSession, 'requestGoogleAccessToken')
    .mockResolvedValue(ok(GOOGLE_TOKENS))
  vi.spyOn(googleOAuthSession, 'fetchGoogleAccountEmail').mockResolvedValue(
    ok({
      kind: GoogleAccountIdentityKind.Available,
      label: 'e2e-user@example.com',
    }),
  )
  return tokenRequest
}

function signedInDriveSetup() {
  const state = VaultStateTestFixture.create()
  new VaultProviderActions(state).beginProviderSetup({
    request: { type: OAUTH_FILE_PROVIDER_TYPE, oauthPreset: 'google-drive' },
  })
  return state
}

describe('Google OAuth provider name persistence', () => {
  afterEach(() => vi.restoreAllMocks())

  test('connects the fixed Nook root and keeps the default backup name', async () => {
    const tokenRequest = mockGoogleTokenApplication()
    wasm.connectGoogleDriveVaultFolder.mockResolvedValue({
      id: 'vault-folder',
      name: 'Nook',
      existed: false,
    })
    const state = VaultStateTestFixture.create()
    const providerActions = new VaultProviderActions(state)
    providerActions.beginProviderSetup({
      request: {
        type: OAUTH_FILE_PROVIDER_TYPE,
        oauthPreset: 'google-drive',
      },
    })
    const oauthActions = new VaultOAuthActions(state)
    await oauthActions.signInWithGoogle()

    // First sign-in asks only for the non-sensitive `drive.file` scope and
    // leaves out earlier grants, so a past `drive.readonly` consent does not
    // bring back the unverified-app warning.
    expect(tokenRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: GoogleDriveOAuthScope.VaultFolder,
        includeGrantedScopes: false,
      }),
    )
    expect(state.loginSetup).toEqual({
      kind: LoginSetupKind.Active,
      providerType: OAUTH_FILE_PROVIDER_TYPE,
    })
    expect(state.oauthFileDraft).toMatchObject({
      kind: OAuthFileDraftKind.Configured,
      config: {
        fileName: storedOAuthRemoteFileName(DEFAULT_DRIVE_BACKUP_NAME),
      },
    })
    // Signed in, but no vault folder yet: nothing to connect to.
    expect(providerActions.stagedRemoteStorageArgs().kind).toBe(
      StagedRemoteStorageKind.Unavailable,
    )

    await expect(oauthActions.connectGoogleVaultFolder()).resolves.toEqual(
      ok({ name: 'Nook', origin: GoogleVaultFolderOrigin.Created }),
    )
    // Only the token: every account's root has the same fixed name.
    expect(wasm.connectGoogleDriveVaultFolder).toHaveBeenCalledWith(
      GOOGLE_TOKENS.accessToken,
    )
    const staged = providerActions.stagedRemoteStorageArgs()
    expect(staged.kind).toBe(StagedRemoteStorageKind.Available)
    if (staged.kind === StagedRemoteStorageKind.Available) {
      expect(staged.args.repo).toBe(
        `shared:vault-folder\t${DEFAULT_DRIVE_BACKUP_NAME}`,
      )
    }

    vi.spyOn(state, 'persistProviders').mockImplementation(async (opts) => {
      if (opts.providers) state.providers = opts.providers
      return ok(ProviderPersistenceOutcome.Persisted)
    })
    await expect(
      new ProviderPersistenceActions(state).ensureProviderSaved(),
    ).resolves.toEqual(ok(ProviderSaveOutcome.Saved))

    const savedProvider = state.providers.find(
      (provider) => provider.type === OAUTH_FILE_PROVIDER_TYPE,
    )
    expect(savedProvider?.oauthFile).toMatchObject({
      state: 'configured',
      config: {
        fileName: storedOAuthRemoteFileName(DEFAULT_DRIVE_BACKUP_NAME),
        folderId: { state: 'folderId', value: 'vault-folder' },
      },
    })
  })

  test('binds the existing Nook root and reports that it existed', async () => {
    mockGoogleTokenApplication()
    wasm.connectGoogleDriveVaultFolder.mockResolvedValue({
      id: 'existing-folder',
      name: 'Nook',
      existed: true,
    })
    const state = signedInDriveSetup()
    const oauthActions = new VaultOAuthActions(state)
    await oauthActions.signInWithGoogle()

    await expect(oauthActions.connectGoogleVaultFolder()).resolves.toEqual(
      ok({ name: 'Nook', origin: GoogleVaultFolderOrigin.Existing }),
    )
    expect(state.oauthFileDraft).toMatchObject({
      kind: OAuthFileDraftKind.Configured,
      config: { folderId: { state: 'folderId', value: 'existing-folder' } },
    })
  })

  test('refuses to pick between duplicated Nook roots', async () => {
    mockGoogleTokenApplication()
    wasm.connectGoogleDriveVaultFolder.mockRejectedValue(
      new Error(I18N_KEYS.ErrorsValidationGoogleDriveVaultFolderAmbiguous),
    )
    const state = signedInDriveSetup()
    const oauthActions = new VaultOAuthActions(state)
    await oauthActions.signInWithGoogle()

    await expect(oauthActions.connectGoogleVaultFolder()).resolves.toEqual(
      err(new OAuthFailure(OAuthFailureKind.GoogleVaultFolderAmbiguous)),
    )
    expect(
      new OAuthFailure(OAuthFailureKind.GoogleVaultFolderAmbiguous)
        .translationKey,
    ).toBe(I18N_KEYS.ErrorsValidationGoogleDriveVaultFolderAmbiguous)
    expect(state.oauthFileDraft).toMatchObject({
      config: { folderId: { state: 'root' } },
    })
  })

  test('lists the Nook root with the token and the open vault, failing visibly', async () => {
    mockGoogleTokenApplication()
    const state = signedInDriveSetup()
    const oauthActions = new VaultOAuthActions(state)
    await oauthActions.signInWithGoogle()
    const closed: Parameters<typeof oauthActions.listGoogleDriveVaults>[0] = {
      state: 'closed',
    }
    wasm.listGoogleDriveVaults.mockResolvedValue({ root: 'absent' })

    await expect(oauthActions.listGoogleDriveVaults(closed)).resolves.toEqual(
      ok({ root: 'absent' }),
    )
    expect(wasm.listGoogleDriveVaults).toHaveBeenCalledWith(
      GOOGLE_TOKENS.accessToken,
      closed,
    )

    wasm.listGoogleDriveVaults.mockRejectedValue(
      new Error(I18N_KEYS.ErrorsValidationGoogleDriveVaultFolderAmbiguous),
    )
    await expect(oauthActions.listGoogleDriveVaults(closed)).resolves.toEqual(
      err(new OAuthFailure(OAuthFailureKind.GoogleVaultFolderAmbiguous)),
    )
    wasm.listGoogleDriveVaults.mockRejectedValue(new Error('status 500'))
    await expect(oauthActions.listGoogleDriveVaults(closed)).resolves.toEqual(
      err(new OAuthFailure(OAuthFailureKind.GoogleVaultListing)),
    )
  })

  test('keeps the wider grant from authorizing an account on the saved provider', async () => {
    mockGoogleTokenApplication()
    wasm.connectGoogleDriveVaultFolder.mockResolvedValue({
      id: 'vault-folder',
      name: 'Nook',
      existed: false,
    })
    const state = signedInDriveSetup()
    const oauthActions = new VaultOAuthActions(state)
    await oauthActions.signInWithGoogle()
    await oauthActions.connectGoogleVaultFolder()
    vi.spyOn(state, 'persistProviders').mockImplementation(async (opts) => {
      if (opts.providers) state.providers = opts.providers
      return ok(ProviderPersistenceOutcome.Persisted)
    })
    await new ProviderPersistenceActions(state).ensureProviderSaved()
    const saved = state.providers.find(
      (provider) => provider.type === OAUTH_FILE_PROVIDER_TYPE,
    )
    if (saved?.oauthFile.state !== 'configured')
      throw new Error('expected a saved Drive provider')

    const adoption: Parameters<
      VaultOAuthActions['adoptGoogleProviderTokens']
    >[0] = {
      config: saved.oauthFile.config,
      tokens: {
        accessToken: 'shared-token',
        expiresAt: GOOGLE_TOKENS.expiresAt,
      },
    }
    await expect(
      oauthActions.adoptGoogleProviderTokens(adoption),
    ).resolves.toEqual(ok(OAuthOperationOutcome.GoogleTokensApplied))

    const sharedToken = { state: 'accessToken', value: 'shared-token' }
    expect(
      state.providers.find((provider) => provider.id === saved.id)?.oauthFile,
    ).toMatchObject({ config: { accessToken: sharedToken } })
    expect(state.oauthFileDraft).toMatchObject({
      config: { accessToken: sharedToken },
    })
  })

  test('keeps a saved backup name and the folder field when OAuth tokens are refreshed', async () => {
    mockGoogleTokenApplication()
    const state = VaultStateTestFixture.create()
    state.storageMode = OAUTH_FILE_PROVIDER_TYPE
    const configuredName = 'persisted-drive-backup'
    const configured = {
      ...defaultOAuthFileConfig({
        preset: 'google-drive',
        fileName: configuredName,
      }),
      accessToken: { state: 'accessToken' as const, value: 'old-access-token' },
    }
    state.configureOauthFile(configured)
    state.githubRepo = DEFAULT_DRIVE_BACKUP_NAME

    await new VaultOAuthActions(state).signInWithGoogle()

    expect(state.oauthFileDraft).toMatchObject({
      kind: OAuthFileDraftKind.Configured,
      config: { fileName: storedOAuthRemoteFileName(configuredName) },
    })
    expect(state.githubRepo).toBe(DEFAULT_DRIVE_BACKUP_NAME)
  })
})
