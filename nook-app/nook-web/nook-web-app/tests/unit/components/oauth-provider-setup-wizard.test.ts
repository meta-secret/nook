import { fireEvent, render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { ok } from 'neverthrow'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import {
  defaultOAuthFileConfig,
  storedGoogleDriveFolder,
  storedOAuthCredential,
  type OAuthFileConfig,
} from '$lib/auth/providers'
import { VaultOAuthActions } from '$lib/vault/oauth'
import OAuthProviderSetupWizard from '../../../../nook-web-shared/src/vault-app/lib/components/OAuthProviderSetupWizard.svelte'

afterEach(() => vi.restoreAllMocks())

function signedInDrive(): OAuthFileConfig {
  return {
    ...defaultOAuthFileConfig({ preset: 'google-drive', fileName: 'vault' }),
    accessToken: storedOAuthCredential('drive-token'),
  }
}

function signedInDriveWithFolder(folderId: string): OAuthFileConfig {
  return { ...signedInDrive(), folderId: storedGoogleDriveFolder(folderId) }
}

function renderWizard(config: OAuthFileConfig) {
  const vault = VaultStateTestFixture.create()
  vault.configureOauthFile(config)
  const onConnect = vi.fn()
  const props = {
    vault,
    githubRepo: 'Team Vault',
    isVerifying: false,
    isInitializing: false,
    onCancelSetup: vi.fn(),
    onConnect,
  } satisfies ComponentProps<typeof OAuthProviderSetupWizard>
  return { view: render(OAuthProviderSetupWizard, props), onConnect }
}

describe('Google Drive provider setup', () => {
  test('offers no folder choice; connecting creates the vault folder first', async () => {
    const create = vi
      .spyOn(VaultOAuthActions.prototype, 'createGoogleVaultFolder')
      .mockResolvedValue(ok('Team Vault'))
    const { view, onConnect } = renderWizard(signedInDrive())

    expect(view.queryAllByRole('radio')).toHaveLength(0)
    expect(view.getByTestId('google-folder-on-connect').textContent).toContain(
      'Team Vault',
    )
    await fireEvent.click(view.getByTestId('connect-provider-btn'))

    await vi.waitFor(() => expect(onConnect).toHaveBeenCalledOnce())
    expect(create).toHaveBeenCalledOnce()
  })

  test('reuses the vault folder the provider already has', async () => {
    const create = vi.spyOn(
      VaultOAuthActions.prototype,
      'createGoogleVaultFolder',
    )
    const { view, onConnect } = renderWizard(
      signedInDriveWithFolder('vault-folder'),
    )

    expect(view.queryAllByTestId('google-folder-on-connect')).toHaveLength(0)
    await fireEvent.click(view.getByTestId('connect-provider-btn'))

    await vi.waitFor(() => expect(onConnect).toHaveBeenCalledOnce())
    expect(create).not.toHaveBeenCalled()
  })
})
