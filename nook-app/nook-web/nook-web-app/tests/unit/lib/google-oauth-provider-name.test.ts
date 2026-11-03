// @vitest-environment-options { "url": "http://localhost:5173/" }

import { afterEach, describe, expect, test, vi } from 'vitest'
import { err, ok } from 'neverthrow'
import { NookDriveRootOrigin } from '$app-wasm'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import {
  GoogleAccountIdentityKind,
  GoogleDriveOAuthScope,
  googleOAuthSession,
} from '$lib/auth/google/oauth'
import { OAuthFailure, OAuthFailureKind } from '$lib/auth/oauth-failure'
import type { GoogleDriveProvider } from '$lib/auth/providers'
import {
  ProviderPersistenceActions,
  ProviderPersistenceOutcome,
  ProviderSaveOutcome,
  VaultProviderActions,
} from '$lib/vault/providers.svelte'
import { OAuthOperationOutcome, VaultOAuthActions } from '$lib/vault/oauth'
import { ProviderSetupKinds } from '$lib/vault/provider-setup-kinds'
import {
  LoginSetupKind,
  StagedRemoteStorageKind,
} from '$lib/vault/state/provider.svelte'
import type { VaultState } from '$lib/vault.svelte'
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
  accessToken: 'TEST-ONLY-google-access-token',
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

function signedInDriveSetup(): VaultState {
  const state = VaultStateTestFixture.create()
  new VaultProviderActions(state).beginProviderSetup({
    kind: ProviderSetupKinds.GOOGLE_DRIVE,
  })
  return state
}

/** Saves through the real save policy with persistence kept in memory. */
async function saveInMemory(state: VaultState): Promise<void> {
  vi.spyOn(state, 'persistProviders').mockImplementation(async (opts) => {
    state.providers = [...opts.providers]
    return ok(ProviderPersistenceOutcome.Persisted)
  })
  await expect(
    new ProviderPersistenceActions(state).ensureProviderSaved(),
  ).resolves.toEqual(ok(ProviderSaveOutcome.Saved))
}

describe('Google Drive sign-in and its vault folder', () => {
  afterEach(() => vi.restoreAllMocks())

  test('signs in, connects the fixed Nook root and saves the folder row', async () => {
    const tokenRequest = mockGoogleTokenApplication()
    wasm.connectGoogleDriveVaultFolder.mockResolvedValue({
      id: 'vault-folder',
      name: 'Nook',
      origin: NookDriveRootOrigin.Created,
    })
    const state = signedInDriveSetup()
    const providerActions = new VaultProviderActions(state)
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
      providerKind: ProviderSetupKinds.GOOGLE_DRIVE,
    })
    expect(state.providerDraft).toMatchObject({
      type: 'oauth-file',
      preset: 'google-drive',
      signIn: {
        state: 'signedIn',
        value: { account: { state: 'email', email: 'e2e-user@example.com' } },
      },
    })
    // Signed in, but no vault folder yet: nothing to connect to.
    expect(providerActions.stagedRemoteStorageArgs().kind).toBe(
      StagedRemoteStorageKind.Unavailable,
    )

    await expect(oauthActions.connectGoogleVaultFolder()).resolves.toEqual(
      ok({ name: 'Nook', origin: NookDriveRootOrigin.Created }),
    )
    // Only the token: every account's root has the same fixed name.
    expect(wasm.connectGoogleDriveVaultFolder).toHaveBeenCalledWith(
      GOOGLE_TOKENS.accessToken,
    )
    const staged = providerActions.stagedRemoteStorageArgs()
    expect(staged.kind).toBe(StagedRemoteStorageKind.Available)
    if (staged.kind === StagedRemoteStorageKind.Available) {
      expect(staged.args).toEqual({
        mode: 'google-drive',
        token: GOOGLE_TOKENS.accessToken,
        folderId: 'vault-folder',
      })
    }

    await saveInMemory(state)
    const savedProvider = state.providers.find(
      (provider) => provider.provider.type === 'oauth-file',
    )
    expect(savedProvider?.provider).toMatchObject({
      preset: 'google-drive',
      folderId: 'vault-folder',
    })
  })

  test('binds the existing Nook root and reports that it existed', async () => {
    mockGoogleTokenApplication()
    wasm.connectGoogleDriveVaultFolder.mockResolvedValue({
      id: 'existing-folder',
      name: 'Nook',
      origin: NookDriveRootOrigin.Existing,
    })
    const state = signedInDriveSetup()
    const oauthActions = new VaultOAuthActions(state)
    await oauthActions.signInWithGoogle()

    await expect(oauthActions.connectGoogleVaultFolder()).resolves.toEqual(
      ok({ name: 'Nook', origin: NookDriveRootOrigin.Existing }),
    )
    expect(state.providerDraft).toMatchObject({
      folder: { state: 'connected', value: 'existing-folder' },
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
    expect(state.providerDraft).toMatchObject({
      folder: { state: 'notConnected' },
    })
  })

  test('a Drive draft awaiting its sign-in cannot connect a folder', async () => {
    const state = signedInDriveSetup()
    await expect(
      new VaultOAuthActions(state).connectGoogleVaultFolder(),
    ).resolves.toEqual(
      err(new OAuthFailure(OAuthFailureKind.GoogleSharedSignInRequired)),
    )
    expect(wasm.connectGoogleDriveVaultFolder).not.toHaveBeenCalled()
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

  test('keeps the wider grant from authorizing an account on the saved rows', async () => {
    mockGoogleTokenApplication()
    wasm.connectGoogleDriveVaultFolder.mockResolvedValue({
      id: 'vault-folder',
      name: 'Nook',
      origin: NookDriveRootOrigin.Created,
    })
    const state = signedInDriveSetup()
    const oauthActions = new VaultOAuthActions(state)
    await oauthActions.signInWithGoogle()
    await oauthActions.connectGoogleVaultFolder()
    await saveInMemory(state)
    const saved = state.providers.find(
      (provider) => provider.provider.type === 'oauth-file',
    )
    if (
      saved?.provider.type !== 'oauth-file' ||
      saved.provider.preset !== 'google-drive'
    )
      throw new Error('expected a saved Drive provider')
    const drive: GoogleDriveProvider = saved.provider

    const adoption: Parameters<
      VaultOAuthActions['adoptGoogleProviderTokens']
    >[0] = {
      drive,
      tokens: {
        accessToken: 'TEST-ONLY-shared-token',
        expiresAt: GOOGLE_TOKENS.expiresAt,
      },
    }
    await expect(
      oauthActions.adoptGoogleProviderTokens(adoption),
    ).resolves.toEqual(ok(OAuthOperationOutcome.GoogleTokensApplied))

    expect(
      state.providers.find((provider) => provider.id === saved.id)?.provider,
    ).toMatchObject({
      authorization: { accessToken: 'TEST-ONLY-shared-token' },
      account: { state: 'email', email: 'e2e-user@example.com' },
    })
  })
})
