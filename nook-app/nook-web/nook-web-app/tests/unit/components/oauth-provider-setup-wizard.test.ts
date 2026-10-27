import { fireEvent, render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { err, ok } from 'neverthrow'
import type {
  NookGoogleDriveVaultListing,
  ProviderVaultSummary,
} from '$app-wasm'
import { OAuthFailure, OAuthFailureKind } from '$lib/auth/oauth-failure'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import {
  defaultOAuthFileConfig,
  storedGoogleDriveFolder,
  storedOAuthCredential,
  type OAuthFileConfig,
} from '$lib/auth/providers'
import { buttonVariants } from '$lib/components/ui/button/button-variants'
import { GoogleVaultFolderOrigin, VaultOAuthActions } from '$lib/vault/oauth'
import {
  ProviderVaultAccessActions,
  ProviderVaultAccessRequest,
  ProviderVaultActions,
  ProviderVaultImportStart,
  ProviderVaultOpeningKind,
} from '$lib/vault/provider-vaults'
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

function summary(
  storeId: string,
  access: ProviderVaultSummary['access'],
  actions: ProviderVaultSummary['actions'],
): ProviderVaultSummary {
  return {
    storeId,
    shortId: storeId.slice('store_'.length, 'store_'.length + 8),
    name: { state: 'unknown' },
    identity: {
      identityId: 'idn_strangerabc',
      shortId: 'stranger',
      name: { state: 'unknown' },
    },
    created: { state: 'reported', at: Date.UTC(2024, 0, 2) },
    lastActivity: { state: 'reported', at: Date.UTC(2024, 2, 1) },
    eventCount: 4,
    access,
    actions,
  }
}

function listVaults(listing: NookGoogleDriveVaultListing) {
  return vi
    .spyOn(VaultOAuthActions.prototype, 'listGoogleDriveVaults')
    .mockResolvedValue(ok(listing))
}

function renderWizard(config: OAuthFileConfig) {
  const vault = VaultStateTestFixture.create()
  vault.configureOauthFile(config)
  const onConnect = vi.fn()
  const props = {
    vault,
    isVerifying: false,
    isInitializing: false,
    onCancelSetup: vi.fn(),
    onConnect,
  } satisfies ComponentProps<typeof OAuthProviderSetupWizard>
  return { view: render(OAuthProviderSetupWizard, props), onConnect, vault }
}

describe('Google Drive provider setup', () => {
  test('offers no folder name; connecting opens or creates the Nook root first', async () => {
    listVaults({ root: 'absent' })
    const connect = vi
      .spyOn(VaultOAuthActions.prototype, 'connectGoogleVaultFolder')
      .mockResolvedValue(
        ok({ name: 'Nook', origin: GoogleVaultFolderOrigin.Created }),
      )
    const { view, onConnect, vault } = renderWizard(signedInDrive())

    expect(view.queryAllByTestId('drive-file-input')).toHaveLength(0)
    expect(view.queryAllByRole('textbox')).toHaveLength(0)
    await vi.waitFor(() =>
      expect(view.getByTestId('google-folder-on-connect').textContent).toBe(
        vault.t(I18N_KEYS.ProviderVaultsRootAbsent),
      ),
    )
    await fireEvent.click(view.getByTestId('connect-provider-btn'))

    await vi.waitFor(() => expect(onConnect).toHaveBeenCalledOnce())
    expect(connect).toHaveBeenCalledOnce()
    expect(view.queryAllByTestId('google-folder-existing')).toHaveLength(0)
    expect(vault.successMsg).toBe('')
  })

  test('lists each vault with how this device can open it', async () => {
    const list = listVaults({
      root: 'found',
      listing: {
        vaults: [
          {
            ...summary('store_ownvault001', { state: 'syncs' }, []),
            name: { state: 'named', name: 'Family' },
            identity: {
              identityId: 'idn_personalide',
              shortId: 'personal',
              name: { state: 'named', name: 'Personal' },
            },
          },
          summary('store_othervault1', { state: 'locked' }, ['requestAccess']),
        ],
        replacement: { state: 'unavailable' },
      },
    })
    const { view, vault } = renderWizard(signedInDrive())

    await vi.waitFor(() =>
      expect(view.getAllByTestId('provider-vault-row')).toHaveLength(2),
    )
    expect(list).toHaveBeenCalledWith({ state: 'closed' })
    const [own, other] = view.getAllByTestId('provider-vault-row')
    expect(own?.dataset.access).toBe('syncs')
    // A vault this browser keeps a name for is listed by it; another
    // identity's vault keeps its name sealed and shows its short id.
    expect(own?.textContent).toContain('Family')
    expect(own?.textContent).not.toContain('ownvault')
    expect(other?.textContent).toContain('othervau')
    // Each row names the identity whose folder files the vault.
    expect(
      own?.querySelector('[data-testid="provider-vault-identity"]')
        ?.textContent,
    ).toBe(
      vault.t({
        key: I18N_KEYS.ProviderVaultsFiledUnder,
        replacements: { identity: 'Personal' },
      }),
    )
    expect(
      other?.querySelector('[data-testid="provider-vault-identity"]')
        ?.textContent,
    ).toBe(
      vault.t({
        key: I18N_KEYS.ProviderVaultsFiledUnder,
        replacements: { identity: 'stranger' },
      }),
    )
    expect(own?.textContent).toContain(
      vault.t(I18N_KEYS.ProviderVaultsAccessSyncs),
    )
    const eventsRequest: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.ProviderVaultsEvents,
      replacements: { count: '4' },
    }
    expect(own?.textContent).toContain(vault.t(eventsRequest))
    // A vault nothing here opens says so and can only be requested.
    expect(other?.textContent).toContain(
      vault.t(I18N_KEYS.ProviderVaultsAccessLocked),
    )
    expect(other?.textContent).toContain(
      vault.t(I18N_KEYS.ProviderVaultsHintLocked),
    )
    expect(view.getAllByTestId('provider-vault-request-access')).toHaveLength(1)
    expect(view.queryAllByTestId('provider-vault-import')).toHaveLength(0)
    expect(view.queryAllByTestId('provider-vault-use-instead')).toHaveLength(0)
    // Connect & sync is the step's one primary action; a row's never competes.
    const secondary: Parameters<typeof buttonVariants>[0] = {
      variant: 'outline',
      size: 'sm',
    }
    expect(view.getByTestId('provider-vault-request-access').className).toBe(
      buttonVariants(secondary),
    )
    expect(view.getByTestId('connect-provider-btn').className).not.toContain(
      'border-input',
    )
  })

  test('imports another vault through the existing import flow', async () => {
    listVaults({
      root: 'found',
      listing: {
        vaults: [
          summary('store_othervault1', { state: 'backupPassword' }, [
            'importSeparately',
          ]),
        ],
        replacement: { state: 'unavailable' },
      },
    })
    const start = vi
      .spyOn(ProviderVaultActions.prototype, 'importSeparately')
      .mockReturnValue(ProviderVaultImportStart.ConnectNow)
    const connect = vi
      .spyOn(VaultOAuthActions.prototype, 'connectGoogleVaultFolder')
      .mockResolvedValue(
        ok({ name: 'Nook', origin: GoogleVaultFolderOrigin.Existing }),
      )
    const { view, onConnect } = renderWizard(signedInDrive())

    await fireEvent.click(await view.findByTestId('provider-vault-import'))

    await vi.waitFor(() => expect(onConnect).toHaveBeenCalledOnce())
    expect(start).toHaveBeenCalledWith('store_othervault1')
    expect(connect).toHaveBeenCalledOnce()
  })

  test('replaces an empty vault only after an explicit confirmation', async () => {
    listVaults({
      root: 'found',
      listing: {
        vaults: [
          summary('store_othervault1', { state: 'backupPassword' }, [
            'useInstead',
            'importSeparately',
          ]),
        ],
        replacement: { state: 'offered', emptyStoreId: 'store_localvault1' },
      },
    })
    const replace = vi
      .spyOn(ProviderVaultActions.prototype, 'replaceEmptyVault')
      .mockReturnValue(ProviderVaultImportStart.AfterLock)
    const { view, onConnect } = renderWizard(signedInDrive())

    await fireEvent.click(await view.findByTestId('provider-vault-use-instead'))
    expect(replace).not.toHaveBeenCalled()
    await fireEvent.click(view.getByTestId('provider-vault-replace-cancel'))
    expect(
      view.queryAllByTestId('provider-vault-replace-confirm'),
    ).toHaveLength(0)

    await fireEvent.click(view.getByTestId('provider-vault-use-instead'))
    await fireEvent.click(
      view.getByTestId('provider-vault-replace-confirm-btn'),
    )

    await vi.waitFor(() =>
      expect(replace).toHaveBeenCalledWith({
        emptyStoreId: 'store_localvault1',
        replacementStoreId: 'store_othervault1',
      }),
    )
    // The import continues after the identity locks, not here.
    expect(onConnect).not.toHaveBeenCalled()
  })

  test('merges a vault into the open one with its backup password', async () => {
    listVaults({
      root: 'found',
      listing: {
        vaults: [
          summary('store_othervault1', { state: 'backupPassword' }, [
            'mergeIntoOpen',
            'importSeparately',
          ]),
        ],
        replacement: { state: 'unavailable' },
      },
    })
    const merge = vi
      .spyOn(ProviderVaultAccessActions.prototype, 'mergeIntoOpen')
      .mockResolvedValue(ok(3))
    const { view, onConnect } = renderWizard(signedInDrive())

    await fireEvent.click(await view.findByTestId('provider-vault-merge'))
    const confirm = view.getByTestId('provider-vault-merge-confirm-btn')
    // Nothing opens the vault until its backup password is typed.
    expect(confirm.hasAttribute('disabled')).toBe(true)
    await fireEvent.input(view.getByTestId('provider-vault-merge-password'), {
      target: { value: 'correct horse battery staple' },
    })
    await fireEvent.click(confirm)

    await vi.waitFor(() =>
      expect(merge).toHaveBeenCalledWith({
        accessToken: 'drive-token',
        storeId: 'store_othervault1',
        opening: {
          kind: ProviderVaultOpeningKind.BackupPassword,
          password: 'correct horse battery staple',
        },
      }),
    )
    await vi.waitFor(() =>
      expect(
        view.queryAllByTestId('provider-vault-merge-confirm'),
      ).toHaveLength(0),
    )
    expect(onConnect).not.toHaveBeenCalled()
  })

  test('requests access to a vault it cannot open and lists it again', async () => {
    const list = listVaults({
      root: 'found',
      listing: {
        vaults: [
          summary('store_othervault1', { state: 'locked' }, ['requestAccess']),
        ],
        replacement: { state: 'unavailable' },
      },
    })
    const request = vi
      .spyOn(ProviderVaultAccessActions.prototype, 'requestAccess')
      .mockResolvedValue(ok(ProviderVaultAccessRequest.Saved))
    const { view } = renderWizard(signedInDrive())

    await fireEvent.click(
      await view.findByTestId('provider-vault-request-access'),
    )

    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith({
        accessToken: 'drive-token',
        storeId: 'store_othervault1',
      }),
    )
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2))
  })

  test('says it found the existing Nook root and syncs beside its vaults', async () => {
    listVaults({
      root: 'found',
      listing: { vaults: [], replacement: { state: 'unavailable' } },
    })
    vi.spyOn(
      VaultOAuthActions.prototype,
      'connectGoogleVaultFolder',
    ).mockResolvedValue(
      ok({ name: 'Nook', origin: GoogleVaultFolderOrigin.Existing }),
    )
    const { view, onConnect, vault } = renderWizard(signedInDrive())
    const noticeRequest: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.ProviderSetupGoogleFolderExisting,
      replacements: { folder: 'Nook' },
    }
    const notice = vault.t(noticeRequest)

    expect(await view.findByTestId('google-drive-vaults-empty')).toBeTruthy()
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

  test('shows why it will not choose between duplicated Nook roots', async () => {
    listVaults({ root: 'absent' })
    vi.spyOn(
      VaultOAuthActions.prototype,
      'connectGoogleVaultFolder',
    ).mockResolvedValue(
      err(new OAuthFailure(OAuthFailureKind.GoogleVaultFolderAmbiguous)),
    )
    const { view, onConnect, vault } = renderWizard(signedInDrive())

    await fireEvent.click(view.getByTestId('connect-provider-btn'))

    const ambiguous = vault.t(
      I18N_KEYS.ErrorsValidationGoogleDriveVaultFolderAmbiguous,
    )
    await vi.waitFor(() => expect(vault.errorMsg).toBe(ambiguous))
    // The connection step has collapsed after sign-in, so the error shows
    // in the open Connect & sync step, beside its button.
    await vi.waitFor(() =>
      expect(view.getByRole('alert').textContent?.trim()).toBe(ambiguous),
    )
    expect(view.getAllByTestId('google-oauth-error')).toHaveLength(1)
    expect(onConnect).not.toHaveBeenCalled()
  })

  test('a listing failure stays visible in the open step', async () => {
    vi.spyOn(
      VaultOAuthActions.prototype,
      'listGoogleDriveVaults',
    ).mockResolvedValue(
      err(new OAuthFailure(OAuthFailureKind.GoogleVaultListing)),
    )
    const { view, vault } = renderWizard(signedInDrive())

    const failed = vault.t(I18N_KEYS.ProviderSetupGoogleVaultsListFailed)
    await vi.waitFor(() =>
      expect(view.getByRole('alert').textContent?.trim()).toBe(failed),
    )
    expect(view.queryAllByTestId('provider-vault-row')).toHaveLength(0)
  })

  test('reuses the vault folder the provider already has', async () => {
    listVaults({ root: 'absent' })
    const create = vi.spyOn(
      VaultOAuthActions.prototype,
      'connectGoogleVaultFolder',
    )
    const { view, onConnect } = renderWizard(
      signedInDriveWithFolder('vault-folder'),
    )

    await fireEvent.click(view.getByTestId('connect-provider-btn'))

    await vi.waitFor(() => expect(onConnect).toHaveBeenCalledOnce())
    expect(create).not.toHaveBeenCalled()
  })
})
