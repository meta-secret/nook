import { ok } from 'neverthrow'
import { describe, expect, test, vi } from 'vitest'
import {
  NookVaultManager,
  draft_oauth_storage_args,
  oauth_remote_storage_ref,
  staged_oauth_remote_storage_args,
  staged_s3_remote_storage_args,
} from '$app-wasm'
import {
  configuredS3,
  defaultOAuthFileConfig,
  OAUTH_FILE_PROVIDER_TYPE,
  S3_PROVIDER_TYPE,
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
import { S3ConnectionFixture } from '../s3-connection-fixture'
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
      expect(actions.wasmStorageArgs()).toEqual({
        mode: 'google-drive',
        token: 'test-access-token',
        folderId: 'vault-folder',
        fileName: 'vault.yaml',
      })
      expect(actions.stagedRemoteStorageArgs()).toEqual({
        kind: StagedRemoteStorageKind.Available,
        args: expectedStaged.args,
      })
    } finally {
      expectedStaged.free()
    }
  })

  test('a signed-in Drive provider stays incomplete until its vault folder exists', () => {
    const config: OAuthFileConfig = {
      ...driveConfig(),
      folderId: { state: 'root' },
    }
    const state = VaultStateTestFixture.create()
    state.storageMode = OAUTH_FILE_PROVIDER_TYPE
    state.activateLoginSetup(OAUTH_FILE_PROVIDER_TYPE)
    state.configureOauthFile(config)
    expect(new VaultProviderActions(state).stagedRemoteStorageArgs()).toEqual({
      kind: StagedRemoteStorageKind.Unavailable,
    })
  })

  test('stages an S3 setup’s connection through Rust', () => {
    const state = VaultStateTestFixture.create()
    state.storageMode = S3_PROVIDER_TYPE
    state.activateLoginSetup(S3_PROVIDER_TYPE)
    state.configureS3(S3ConnectionFixture.configuration())
    const expectedStaged = staged_s3_remote_storage_args(
      configuredS3(S3ConnectionFixture.configuration()),
    )

    try {
      expect(new VaultProviderActions(state).stagedRemoteStorageArgs()).toEqual(
        {
          kind: StagedRemoteStorageKind.Available,
          args: expectedStaged.args,
        },
      )
      expect(expectedStaged.args.mode).toBe(S3_PROVIDER_TYPE)
    } finally {
      expectedStaged.free()
    }
  })

  test('an S3 setup without its connection stages nothing', () => {
    const state = VaultStateTestFixture.create()
    state.storageMode = S3_PROVIDER_TYPE
    state.activateLoginSetup(S3_PROVIDER_TYPE)
    expect(new VaultProviderActions(state).stagedRemoteStorageArgs()).toEqual({
      kind: StagedRemoteStorageKind.Unavailable,
    })
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
