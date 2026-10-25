import { ok } from 'neverthrow'
import { describe, expect, test, vi } from 'vitest'
import {
  NookVaultManager,
  draft_oauth_storage_args,
  oauth_remote_storage_ref,
  staged_oauth_remote_storage_args,
} from '$app-wasm'
import {
  defaultOAuthFileConfig,
  OAUTH_FILE_PROVIDER_TYPE,
  storedGoogleDriveFolder,
  storedOAuthCredential,
  type OAuthFileConfig,
} from '$lib/auth/providers'
import {
  OAuthRemoteReferenceSyncKind,
  VaultProviderActions,
} from '$lib/vault/providers.svelte'
import {
  OAuthFileDraftKind,
  StagedRemoteStorageKind,
} from '$lib/vault/state/provider.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

function driveConfig(): OAuthFileConfig {
  return {
    ...defaultOAuthFileConfig({
      preset: 'google-drive',
      fileName: 'vault.yaml',
    }),
    accessToken: storedOAuthCredential('test-access-token'),
    folderId: storedGoogleDriveFolder('vault-folder'),
  }
}

describe('provider storage wiring', () => {
  test('connects a new Drive provider through its shared vault folder', () => {
    const config = driveConfig()
    const state = VaultStateTestFixture.create()
    state.storageMode = OAUTH_FILE_PROVIDER_TYPE
    state.activateLoginSetup(OAUTH_FILE_PROVIDER_TYPE)
    state.configureOauthFile(config)
    const actions = new VaultProviderActions(state)
    const expectedStaged = staged_oauth_remote_storage_args(config)

    try {
      expect(actions.wasmStorageArgs()).toEqual(
        draft_oauth_storage_args(config),
      )
      expect(actions.wasmStorageArgs().repo).toBe(
        'shared:vault-folder\tvault.yaml',
      )
      expect(actions.stagedRemoteStorageArgs()).toEqual({
        kind: StagedRemoteStorageKind.Available,
        args: expectedStaged.args,
      })
    } finally {
      expectedStaged.free()
    }
  })

  test('a Drive provider without its vault folder has no connect target', () => {
    const config: OAuthFileConfig = {
      ...driveConfig(),
      folderId: { state: 'root' },
    }
    expect(() => staged_oauth_remote_storage_args(config)).toThrow()
  })

  test('keeps the vault folder when the manager reports the connected folder', () => {
    const config = driveConfig()
    const remoteReference = oauth_remote_storage_ref(config)
    const manager = new NookVaultManager()
    vi.spyOn(manager, 'storage_remote_ref', 'get').mockReturnValue('')
    const state = VaultStateTestFixture.create()
    state.storageMode = OAUTH_FILE_PROVIDER_TYPE
    state.clearLoginSetup()
    state.configureOauthFile(config)
    state.admitManager = vi.fn(() => ok(manager))

    try {
      expect(remoteReference.value).toBe('shared:vault-folder')
      expect(
        new VaultProviderActions(state).syncOAuthRemoteRefFromManager(),
      ).toEqual(ok({ kind: OAuthRemoteReferenceSyncKind.Unchanged }))
      expect(state.oauthFileDraft).toEqual({
        kind: OAuthFileDraftKind.Configured,
        config,
      })
    } finally {
      remoteReference.free()
      manager.free()
    }
  })
})
