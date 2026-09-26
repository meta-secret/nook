import { ok } from 'neverthrow'
import { describe, expect, test, vi } from 'vitest'
import {
  NookVaultManager,
  draft_oauth_storage_args,
  existing_provider_save_setup,
  new_provider_save_setup,
  oauth_remote_storage_ref,
  staged_oauth_remote_storage_args,
  type StoredGoogleDrivePrivateTarget,
} from '$app-wasm'
import {
  defaultOAuthFileConfig,
  OAUTH_FILE_PROVIDER_TYPE,
  storedOAuthCredential,
  storedOAuthRemoteFileId,
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

describe('provider save setup wiring', () => {
  test('uses New for the draft and first staged private Drive projections', () => {
    const config: OAuthFileConfig = {
      ...defaultOAuthFileConfig({
        preset: 'google-drive',
        fileName: 'vault.yaml',
      }),
      accessToken: storedOAuthCredential('test-access-token'),
    }
    const state = VaultStateTestFixture.create()
    state.storageMode = OAUTH_FILE_PROVIDER_TYPE
    state.activateLoginSetup(OAUTH_FILE_PROVIDER_TYPE)
    state.configureOauthFile(config)
    const actions = new VaultProviderActions(state)
    const expectedStaged = staged_oauth_remote_storage_args(
      config,
      new_provider_save_setup(OAUTH_FILE_PROVIDER_TYPE),
    )

    try {
      expect(actions.wasmStorageArgs()).toEqual(
        draft_oauth_storage_args(
          config,
          new_provider_save_setup(OAUTH_FILE_PROVIDER_TYPE),
        ),
      )
      expect(actions.stagedRemoteStorageArgs()).toEqual({
        kind: StagedRemoteStorageKind.Available,
        args: expectedStaged.args,
      })
    } finally {
      expectedStaged.free()
    }
  })

  test('persists the Rust-resolved private folder target for a new provider', () => {
    const config: OAuthFileConfig = {
      ...defaultOAuthFileConfig({
        preset: 'google-drive',
        fileName: 'vault.yaml',
      }),
      accessToken: storedOAuthCredential('test-access-token'),
      fileId: storedOAuthRemoteFileId('historical-file-id'),
    }
    const folderTarget: StoredGoogleDrivePrivateTarget = {
      state: 'folderId',
      value: 'stable-folder-id',
    }
    const resolvedConfig: OAuthFileConfig = {
      ...config,
      drivePrivateTarget: folderTarget,
    }
    const remoteReference = oauth_remote_storage_ref(resolvedConfig)
    const manager = new NookVaultManager()
    vi.spyOn(manager, 'storage_remote_ref', 'get').mockReturnValue(
      remoteReference.value,
    )
    const state = VaultStateTestFixture.create()
    state.storageMode = OAUTH_FILE_PROVIDER_TYPE
    state.activateLoginSetup(OAUTH_FILE_PROVIDER_TYPE)
    state.configureOauthFile(config)
    state.admitManager = vi.fn(() => ok(manager))

    try {
      expect(
        new VaultProviderActions(state).syncOAuthRemoteRefFromManager(),
      ).toEqual(ok({ kind: OAuthRemoteReferenceSyncKind.Updated }))
      expect(state.oauthFileDraft).toEqual({
        kind: OAuthFileDraftKind.Configured,
        config: {
          ...config,
          drivePrivateTarget: folderTarget,
        },
      })
    } finally {
      remoteReference.free()
      manager.free()
    }
  })

  test('keeps an existing schema-one Drive provider on its legacy reference', () => {
    const config: OAuthFileConfig = {
      ...defaultOAuthFileConfig({
        preset: 'google-drive',
        fileName: 'vault.yaml',
      }),
      accessToken: storedOAuthCredential('test-access-token'),
      fileId: storedOAuthRemoteFileId('legacy-file-id'),
    }
    const remoteReference = oauth_remote_storage_ref(config)
    const manager = new NookVaultManager()
    vi.spyOn(manager, 'storage_remote_ref', 'get').mockReturnValue(
      remoteReference.value,
    )
    const expectedStaged = staged_oauth_remote_storage_args(
      config,
      existing_provider_save_setup(),
    )
    const state = VaultStateTestFixture.create()
    state.storageMode = OAUTH_FILE_PROVIDER_TYPE
    state.clearLoginSetup()
    state.configureOauthFile(config)
    state.admitManager = vi.fn(() => ok(manager))
    const actions = new VaultProviderActions(state)

    try {
      expect(actions.wasmStorageArgs()).toEqual(
        draft_oauth_storage_args(config, existing_provider_save_setup()),
      )
      expect(actions.stagedRemoteStorageArgs()).toEqual({
        kind: StagedRemoteStorageKind.Available,
        args: expectedStaged.args,
      })
      expect(actions.syncOAuthRemoteRefFromManager()).toEqual(
        ok({ kind: OAuthRemoteReferenceSyncKind.Unchanged }),
      )
      expect(state.oauthFileDraft).toEqual({
        kind: OAuthFileDraftKind.Configured,
        config,
      })
    } finally {
      expectedStaged.free()
      remoteReference.free()
      manager.free()
    }
  })
})
