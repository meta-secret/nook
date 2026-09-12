import { ok } from 'neverthrow'
import { describe, expect, test } from 'vitest'
import { NookExistingVaultProviderReadiness } from '$app-wasm'
import {
  DEFAULT_DRIVE_BACKUP_NAME,
  GITHUB_PROVIDER_TYPE,
  LOCAL_FOLDER_PROVIDER_TYPE,
  LOCAL_PROVIDER_TYPE,
  OAUTH_FILE_PROVIDER_TYPE,
  defaultOAuthFileConfig,
  storedLocalFolderDirectory,
  storedLocalFolderHandle,
} from '$lib/auth/providers'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import type { ProviderActionsContext } from '$lib/vault/action-contexts'
import { ExistingVaultProviderDraft } from '$lib/vault/existing-vault-provider.svelte'

function providerState(): ProviderActionsContext {
  const oauthFile = defaultOAuthFileConfig({
    preset: 'google-drive',
    fileName: DEFAULT_DRIVE_BACKUP_NAME,
  })
  const localFolder = {
    directoryName: storedLocalFolderDirectory('Vaults'),
    handleId: storedLocalFolderHandle('folder'),
  }
  const state = VaultStateTestFixture.create()
  state.githubPat = 'github-token'
  state.githubRepo = 'vault-repository'
  state.configureOauthFile(oauthFile)
  state.configureLocalFolder(localFolder)
  return state
}

describe('existing vault provider snapshot', () => {
  test('uses the Rust-owned provider type as its only discriminant', () => {
    const state = providerState()

    const local = new ExistingVaultProviderDraft({
      state: state,
      setupType: LOCAL_PROVIDER_TYPE,
    }).prepare()
    const github = new ExistingVaultProviderDraft({
      state: state,
      setupType: GITHUB_PROVIDER_TYPE,
    }).prepare()
    const oauth = new ExistingVaultProviderDraft({
      state: state,
      setupType: OAUTH_FILE_PROVIDER_TYPE,
    }).prepare()
    const folder = new ExistingVaultProviderDraft({
      state: state,
      setupType: LOCAL_FOLDER_PROVIDER_TYPE,
    }).prepare()

    expect(local).toEqual(
      ok({
        kind: NookExistingVaultProviderReadiness.Ready,
        provider: { setupType: LOCAL_PROVIDER_TYPE },
      }),
    )
    expect(github.isOk()).toBe(true)
    if (github.isOk())
      expect(github.value).toMatchObject({
        kind: NookExistingVaultProviderReadiness.Ready,
        provider: {
          setupType: GITHUB_PROVIDER_TYPE,
          githubPat: 'github-token',
          githubRepo: 'vault-repository',
        },
      })
    expect(oauth.isOk()).toBe(true)
    if (oauth.isOk())
      expect(oauth.value).toMatchObject({
        kind: NookExistingVaultProviderReadiness.Ready,
        provider: { setupType: OAUTH_FILE_PROVIDER_TYPE },
      })
    expect(folder.isOk()).toBe(true)
    if (folder.isOk())
      expect(folder.value).toMatchObject({
        kind: NookExistingVaultProviderReadiness.Ready,
        provider: { setupType: LOCAL_FOLDER_PROVIDER_TYPE },
      })
  })
})
