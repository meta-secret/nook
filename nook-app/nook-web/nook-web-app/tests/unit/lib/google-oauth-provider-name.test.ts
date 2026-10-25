// @vitest-environment-options { "url": "http://localhost:5173/" }

import { afterEach, describe, expect, test, vi } from 'vitest'
import { ok } from 'neverthrow'
import {
  GoogleAccountIdentityKind,
  googleOAuthSession,
} from '$lib/auth/google/oauth'
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
import { VaultOAuthActions } from '$lib/vault/oauth'
import {
  LoginSetupKind,
  OAuthFileDraftKind,
  StagedRemoteStorageKind,
} from '$lib/vault/state/provider.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

const wasm = vi.hoisted(() => ({
  createGoogleDriveVaultFolder: vi.fn(),
}))

vi.mock('$app-wasm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$app-wasm')>()),
  create_google_drive_vault_folder: wasm.createGoogleDriveVaultFolder,
}))

const GOOGLE_TOKENS = {
  accessToken: 'test-google-access-token',
  expiresAt: '2030-01-01T00:00:00.000Z',
}

function mockGoogleTokenApplication() {
  vi.spyOn(googleOAuthSession, 'requestGoogleAccessToken').mockResolvedValue(
    ok(GOOGLE_TOKENS),
  )
  vi.spyOn(googleOAuthSession, 'fetchGoogleAccountEmail').mockResolvedValue(
    ok({
      kind: GoogleAccountIdentityKind.Available,
      label: 'e2e-user@example.com',
    }),
  )
}

describe('Google OAuth provider name persistence', () => {
  afterEach(() => vi.restoreAllMocks())

  test('keeps a new Drive name through OAuth, folder creation, and save', async () => {
    mockGoogleTokenApplication()
    wasm.createGoogleDriveVaultFolder.mockResolvedValue({
      id: 'vault-folder',
      name: 'onboarding-file-test',
    })
    const state = VaultStateTestFixture.create()
    const providerActions = new VaultProviderActions(state)
    providerActions.beginProviderSetup({
      request: {
        type: OAUTH_FILE_PROVIDER_TYPE,
        oauthPreset: 'google-drive',
      },
    })
    const requestedName = 'onboarding-file-test'
    state.githubRepo = requestedName

    const oauthActions = new VaultOAuthActions(state)
    await oauthActions.signInWithGoogle()

    expect(state.loginSetup).toEqual({
      kind: LoginSetupKind.Active,
      providerType: OAUTH_FILE_PROVIDER_TYPE,
    })
    expect(state.oauthFileDraft).toMatchObject({
      kind: OAuthFileDraftKind.Configured,
      config: {
        fileName: storedOAuthRemoteFileName(requestedName),
      },
    })
    expect(state.githubRepo).toBe(requestedName)
    // Signed in, but no vault folder yet: nothing to connect to.
    expect(providerActions.stagedRemoteStorageArgs().kind).toBe(
      StagedRemoteStorageKind.Unavailable,
    )

    await expect(oauthActions.createGoogleVaultFolder()).resolves.toEqual(
      ok(requestedName),
    )
    expect(wasm.createGoogleDriveVaultFolder).toHaveBeenCalledWith(
      GOOGLE_TOKENS.accessToken,
      requestedName,
    )
    const staged = providerActions.stagedRemoteStorageArgs()
    expect(staged.kind).toBe(StagedRemoteStorageKind.Available)
    if (staged.kind === StagedRemoteStorageKind.Available) {
      expect(staged.args.repo).toBe(`shared:vault-folder\t${requestedName}`)
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
        fileName: storedOAuthRemoteFileName(requestedName),
        folderId: { state: 'folderId', value: 'vault-folder' },
      },
    })
  })

  test('keeps an existing provider name when OAuth tokens are refreshed', async () => {
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
    expect(state.githubRepo).toBe(configuredName)
  })
})
