import { fireEvent, render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { err, ok } from 'neverthrow'
import type {
  CredentialCheckReport,
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
import { GoogleVaultFolderOrigin, VaultOAuthActions } from '$lib/vault/oauth'
import { AccessCheckActions } from '$lib/vault/access-check'
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
      words: ['ripple', 'canvas', 'orbit'],
      log: {
        state: 'read',
        devices: 2,
        newestDevice: { state: 'reported', at: Date.UTC(2026, 9, 27) },
        vaults: 3,
      },
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
              words: ['amber', 'falcon', 'tide'],
              log: { state: 'absent' },
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
    // An identity this browser does not hold is named by its three words,
    // and its public control log says how many devices and vaults it has.
    expect(
      other?.querySelector('[data-testid="provider-vault-identity"]')
        ?.textContent,
    ).toBe(
      vault.t({
        key: I18N_KEYS.ProviderVaultsFiledUnder,
        replacements: { identity: 'ripple-canvas-orbit' },
      }),
    )
    // Only the stranger's row has log facts; its own vault's identity has none.
    const facts = view
      .getAllByTestId('provider-vault-identity-log')
      .map((line) => line.textContent)
    expect(facts).toContain(
      vault.t({
        key: I18N_KEYS.ProviderVaultsDevices,
        replacements: { count: '2' },
      }),
    )
    expect(facts).toContain(
      vault.t({
        key: I18N_KEYS.ProviderVaultsIdentityVaults,
        replacements: { count: '3' },
      }),
    )
    expect(facts).toHaveLength(3)
    expect(
      own?.querySelectorAll('[data-testid="provider-vault-identity-log"]'),
    ).toHaveLength(0)
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
    // A row's actions are choices; the step has one action button, and it
    // runs whichever choice is picked.
    const choice = view.getByTestId('provider-vault-request-access')
    expect(choice.getAttribute('type')).toBe('radio')
    const connectChoice = view.getByTestId('provider-vault-choice-connect')
    expect(connectChoice).toHaveProperty('checked', true)
    expect(view.getAllByTestId('connect-provider-btn')).toHaveLength(1)
    expect(view.queryAllByTestId('provider-vault-action-btn')).toHaveLength(0)

    await fireEvent.click(choice)
    expect(view.queryAllByTestId('connect-provider-btn')).toHaveLength(0)
    expect(view.getByTestId('provider-vault-action-btn').textContent).toContain(
      vault.t(I18N_KEYS.ProviderVaultsRequestAccess),
    )

    await fireEvent.click(connectChoice)
    expect(view.getAllByTestId('connect-provider-btn')).toHaveLength(1)
    expect(view.queryAllByTestId('provider-vault-action-btn')).toHaveLength(0)
  })

  test('keeps Connect & sync disabled until the Nook folder is listed', async () => {
    let finishListing: (listing: NookGoogleDriveVaultListing) => void = () => {}
    const listed = new Promise<NookGoogleDriveVaultListing>((resolve) => {
      finishListing = resolve
    })
    vi.spyOn(
      VaultOAuthActions.prototype,
      'listGoogleDriveVaults',
    ).mockReturnValue(listed.then((listing) => ok(listing)))
    const { view } = renderWizard(signedInDrive())

    await view.findByTestId('google-drive-vaults-loading')
    expect(
      view.getByTestId('connect-provider-btn').hasAttribute('disabled'),
    ).toBe(true)

    finishListing({ root: 'absent' })
    await view.findByTestId('google-folder-on-connect')
    expect(
      view.getByTestId('connect-provider-btn').hasAttribute('disabled'),
    ).toBe(false)
  })

  test('a checked passkey verifies the vaults it opens and shows their names', async () => {
    listVaults({
      root: 'found',
      listing: {
        vaults: [
          summary('store_othervault1', { state: 'unchecked' }, [
            'importSeparately',
          ]),
        ],
        replacement: { state: 'unavailable' },
      },
    })
    const opens: CredentialCheckReport = {
      credential: { kind: 'passkey', fingerprint: 'passkey_a1b2c3d4e5f60708' },
      identity: {
        state: 'member',
        identityId: 'idn_strangerabc',
        words: ['ripple', 'canvas', 'orbit'],
        name: { state: 'named', name: 'Personal' },
      },
      vaults: [
        {
          storeId: 'store_othervault1',
          shortId: 'othervau',
          filedUnder: ['ripple', 'canvas', 'orbit'],
          outcome: { state: 'opens', name: { state: 'named', name: 'Family' } },
        },
      ],
    }
    const check = vi
      .spyOn(AccessCheckActions.prototype, 'checkPasskey')
      .mockResolvedValue(ok(opens))
    const { view, vault } = renderWizard(signedInDrive())

    const row = await view.findByTestId('provider-vault-row')
    expect(row.textContent).not.toContain('Family')
    // Checking is a text link; the step keeps one action button.
    expect(view.getAllByTestId('connect-provider-btn')).toHaveLength(1)
    expect(view.queryAllByTestId('provider-vault-action-btn')).toHaveLength(0)
    await fireEvent.click(view.getByTestId('provider-vault-check-passkey'))

    await vi.waitFor(() => expect(row.textContent).toContain('Family'))
    expect(check).toHaveBeenCalledWith({
      kind: 'googleDrive',
      accessToken: 'drive-token',
    })
    expect(
      row.querySelector('[data-testid="provider-vault-identity"]')?.textContent,
    ).toBe(
      vault.t({
        key: I18N_KEYS.ProviderVaultsFiledUnder,
        replacements: { identity: 'Personal' },
      }),
    )
    const verification = view.getByTestId('provider-vault-verification')
    expect(verification.dataset.verified).toBe('true')
    expect(verification.textContent?.trim()).toBe(
      vault.t({
        key: I18N_KEYS.AccessCheckVaultVerified,
        replacements: { id: 'a1b2c3d4' },
      }),
    )
    // Importing a vault the checked passkey opens is recovering it with it.
    expect(
      view.getByTestId('provider-vault-import').closest('label')?.textContent,
    ).toContain(vault.t(I18N_KEYS.AccessCheckRecoverWithPasskey))
    expect(
      view.getByTestId('provider-vault-check-passkey').textContent,
    ).toContain(vault.t(I18N_KEYS.AccessCheckCheckAnotherPasskey))
  })

  test('a passkey that opens nothing marks the vault unverified', async () => {
    listVaults({
      root: 'found',
      listing: {
        vaults: [summary('store_othervault1', { state: 'unchecked' }, [])],
        replacement: { state: 'unavailable' },
      },
    })
    const none: CredentialCheckReport = {
      credential: { kind: 'passkey', fingerprint: 'passkey_ffffffffffffffff' },
      identity: { state: 'notAMember' },
      vaults: [
        {
          storeId: 'store_othervault1',
          shortId: 'othervau',
          filedUnder: ['ripple', 'canvas', 'orbit'],
          outcome: { state: 'doesNotOpen' },
        },
      ],
    }
    vi.spyOn(AccessCheckActions.prototype, 'checkPasskey').mockResolvedValue(
      ok(none),
    )
    const { view, vault } = renderWizard(signedInDrive())

    await fireEvent.click(
      await view.findByTestId('provider-vault-check-passkey'),
    )

    const verification = await view.findByTestId('provider-vault-verification')
    expect(verification.dataset.verified).toBe('false')
    expect(verification.textContent?.trim()).toBe(
      vault.t(I18N_KEYS.AccessCheckVaultNotVerified),
    )
    expect(view.getByTestId('provider-vault-row').textContent).toContain(
      'othervau',
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
    expect(onConnect).not.toHaveBeenCalled()
    await fireEvent.click(view.getByTestId('provider-vault-action-btn'))

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
    await fireEvent.click(view.getByTestId('provider-vault-action-btn'))
    expect(replace).not.toHaveBeenCalled()
    // The confirmation's own button is the only live action meanwhile.
    expect(
      view.getByTestId('provider-vault-action-btn').hasAttribute('disabled'),
    ).toBe(true)
    await fireEvent.click(view.getByTestId('provider-vault-replace-cancel'))
    expect(
      view.queryAllByTestId('provider-vault-replace-confirm'),
    ).toHaveLength(0)

    await fireEvent.click(view.getByTestId('provider-vault-action-btn'))
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
    await fireEvent.click(view.getByTestId('provider-vault-action-btn'))
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
    await fireEvent.click(view.getByTestId('provider-vault-action-btn'))

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

    await view.findByTestId('google-folder-on-connect')
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

    await view.findByTestId('google-folder-on-connect')
    await fireEvent.click(view.getByTestId('connect-provider-btn'))

    await vi.waitFor(() => expect(onConnect).toHaveBeenCalledOnce())
    expect(create).not.toHaveBeenCalled()
  })
})
