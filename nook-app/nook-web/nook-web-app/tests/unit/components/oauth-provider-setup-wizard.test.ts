import { fireEvent, render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { err, ok } from 'neverthrow'
import { OAuthFailure, OAuthFailureKind } from '$lib/auth/oauth-failure'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import {
  defaultOAuthFileConfig,
  storedGoogleDriveFolder,
  storedOAuthCredential,
  type OAuthFileConfig,
} from '$lib/auth/providers'
import { GoogleVaultFolderOrigin, VaultOAuthActions } from '$lib/vault/oauth'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
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
  return { view: render(OAuthProviderSetupWizard, props), onConnect, vault }
}

describe('Google Drive provider setup', () => {
  test('offers no folder choice; connecting opens or creates the vault folder first', async () => {
    const connect = vi
      .spyOn(VaultOAuthActions.prototype, 'connectGoogleVaultFolder')
      .mockResolvedValue(
        ok({ name: 'Team Vault', origin: GoogleVaultFolderOrigin.Created }),
      )
    const { view, onConnect, vault } = renderWizard(signedInDrive())

    expect(view.queryAllByRole('radio')).toHaveLength(0)
    expect(view.getByTestId('google-folder-on-connect').textContent).toContain(
      'Team Vault',
    )
    await fireEvent.click(view.getByTestId('connect-provider-btn'))

    await vi.waitFor(() => expect(onConnect).toHaveBeenCalledOnce())
    expect(connect).toHaveBeenCalledOnce()
    expect(view.queryAllByTestId('google-folder-existing')).toHaveLength(0)
    expect(vault.successMsg).toBe('')
  })

  test('says it found the existing folder and syncs with its data', async () => {
    vi.spyOn(
      VaultOAuthActions.prototype,
      'connectGoogleVaultFolder',
    ).mockResolvedValue(
      ok({ name: 'nook-events', origin: GoogleVaultFolderOrigin.Existing }),
    )
    const { view, onConnect, vault } = renderWizard(signedInDrive())
    const noticeRequest: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.ProviderSetupGoogleFolderExisting,
      replacements: { folder: 'nook-events' },
    }
    const notice = vault.t(noticeRequest)

    await fireEvent.click(view.getByTestId('connect-provider-btn'))

    await vi.waitFor(() => expect(onConnect).toHaveBeenCalledOnce())
    await vi.waitFor(() =>
      expect(view.getByTestId('google-folder-existing').textContent).toBe(
        notice,
      ),
    )
    // The notice outlives the wizard once the provider is connected.
    expect(vault.successMsg).toBe(notice)
  })

  test('shows why it will not choose between several folders', async () => {
    vi.spyOn(
      VaultOAuthActions.prototype,
      'connectGoogleVaultFolder',
    ).mockResolvedValue(
      err(new OAuthFailure(OAuthFailureKind.GoogleVaultFolderAmbiguous)),
    )
    const { view, onConnect, vault } = renderWizard(signedInDrive())

    await fireEvent.click(view.getByTestId('connect-provider-btn'))

    await vi.waitFor(() =>
      expect(vault.errorMsg).toBe(
        vault.t(I18N_KEYS.ErrorsValidationGoogleDriveVaultFolderAmbiguous),
      ),
    )
    expect(onConnect).not.toHaveBeenCalled()
  })

  test('reuses the vault folder the provider already has', async () => {
    const create = vi.spyOn(
      VaultOAuthActions.prototype,
      'connectGoogleVaultFolder',
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
