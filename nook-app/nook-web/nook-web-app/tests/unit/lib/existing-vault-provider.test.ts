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
import type { ProviderActionsContext } from '$lib/vault/action-contexts'
import { prepareExistingVaultProvider } from '$lib/vault/existing-vault-provider.svelte'
import {
  LocalFolderDraftKind,
  OAuthFileDraftKind,
} from '$lib/vault/state/provider.svelte'

function providerState(): ProviderActionsContext {
  const oauthFile = defaultOAuthFileConfig({
    preset: 'google-drive',
    fileName: DEFAULT_DRIVE_BACKUP_NAME,
  })
  const localFolder = {
    directoryName: storedLocalFolderDirectory('Vaults'),
    handleId: storedLocalFolderHandle('folder'),
  }
  return {
    githubPat: 'github-token',
    githubRepo: 'vault-repository',
    oauthFileDraft: { kind: OAuthFileDraftKind.Configured, config: oauthFile },
    localFolderDraft: {
      kind: LocalFolderDraftKind.Configured,
      config: localFolder,
    },
    requireOauthFileConfig: () => oauthFile,
    requireLocalFolderConfig: () => localFolder,
  } as unknown as ProviderActionsContext
}

describe('existing vault provider snapshot', () => {
  test('uses the Rust-owned provider type as its only discriminant', () => {
    const state = providerState()

    const local = prepareExistingVaultProvider({
      state: state,
      setupType: LOCAL_PROVIDER_TYPE,
    })
    const github = prepareExistingVaultProvider({
      state: state,
      setupType: GITHUB_PROVIDER_TYPE,
    })
    const oauth = prepareExistingVaultProvider({
      state: state,
      setupType: OAUTH_FILE_PROVIDER_TYPE,
    })
    const folder = prepareExistingVaultProvider({
      state: state,
      setupType: LOCAL_FOLDER_PROVIDER_TYPE,
    })

    expect(local).toEqual({
      kind: NookExistingVaultProviderReadiness.Ready,
      provider: { setupType: LOCAL_PROVIDER_TYPE },
    })
    expect(github).toMatchObject({
      kind: NookExistingVaultProviderReadiness.Ready,
      provider: {
        setupType: GITHUB_PROVIDER_TYPE,
        githubPat: 'github-token',
        githubRepo: 'vault-repository',
      },
    })
    expect(oauth).toMatchObject({
      kind: NookExistingVaultProviderReadiness.Ready,
      provider: { setupType: OAUTH_FILE_PROVIDER_TYPE },
    })
    expect(folder).toMatchObject({
      kind: NookExistingVaultProviderReadiness.Ready,
      provider: { setupType: LOCAL_FOLDER_PROVIDER_TYPE },
    })
  })
})
