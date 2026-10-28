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
import {
  AccessCheckActions,
  AccessCheckTargetKind,
} from '$lib/vault/access-check'
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
        thisBrowser: false,
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
    // Vaults are grouped under the identity whose folder files them.
    const [ownIdentity, otherIdentity] =
      view.getAllByTestId('provider-identity')
    // The identity this browser syncs opens here; the stranger does not.
    expect(ownIdentity?.dataset.standing).toBe('thisBrowser')
    expect(otherIdentity?.dataset.standing).toBe('unchecked')
    expect(
      ownIdentity?.querySelector('[data-testid="provider-vault-identity"]')
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
      otherIdentity?.querySelector('[data-testid="provider-vault-identity"]')
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
      ownIdentity?.querySelectorAll(
        '[data-testid="provider-vault-identity-log"]',
      ),
    ).toHaveLength(0)
    const eventsRequest: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.ProviderVaultsEvents,
      replacements: { count: '4' },
    }
    expect(own?.textContent).toContain(vault.t(eventsRequest))
    // The identity that opens here needs nothing; the one nothing here
    // opens offers its passkey hunt and a join, once, on the identity.
    expect(
      ownIdentity?.querySelectorAll(
        '[data-testid="provider-identity-ask-to-join"]',
      ),
    ).toHaveLength(0)
    expect(view.getAllByTestId('provider-identity-ask-to-join')).toHaveLength(1)
    expect(view.getAllByTestId('provider-identity-find-passkey')).toHaveLength(
      1,
    )
    // Joining is the identity's; no vault row offers a request of its own.
    expect(view.queryAllByTestId('provider-vault-request-access')).toHaveLength(
      0,
    )
    expect(view.queryAllByTestId('provider-vault-import')).toHaveLength(0)
    expect(view.getAllByTestId('connect-provider-btn')).toHaveLength(1)
    expect(view.queryAllByTestId('provider-vault-action-btn')).toHaveLength(0)
  })

  test('recovering is a choice on the identity, run by the one action button', async () => {
    listVaults({
      root: 'found',
      listing: {
        vaults: [
          summary('store_othervault1', { state: 'unchecked' }, [
            'importSeparately',
          ]),
          summary('store_othervault2', { state: 'unchecked' }, [
            'importSeparately',
          ]),
        ],
        replacement: { state: 'unavailable' },
      },
    })
    const { view, vault } = renderWizard(signedInDrive())

    // Two vaults, one identity: one choice recovers the identity.
    const open = await view.findByTestId('provider-identity-open')
    expect(open.getAttribute('type')).toBe('radio')
    expect(open.closest('label')?.textContent).toContain(
      vault.t(I18N_KEYS.ProviderVaultsRecoverIdentity),
    )
    expect(view.queryAllByTestId('provider-vault-import')).toHaveLength(0)
    const connectChoice = view.getByTestId('provider-vault-choice-connect')
    expect(connectChoice).toHaveProperty('checked', true)

    await fireEvent.click(open)
    expect(view.queryAllByTestId('connect-provider-btn')).toHaveLength(0)
    expect(view.getByTestId('provider-vault-action-btn').textContent).toContain(
      vault.t(I18N_KEYS.ProviderVaultsRecoverIdentity),
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

  test('this browser opens an identity it is a device of without a check', async () => {
    listVaults({
      root: 'found',
      listing: {
        vaults: [
          {
            ...summary('store_ownvault001', { state: 'syncs' }, []),
            identity: {
              identityId: 'idn_personalide',
              shortId: 'personal',
              name: { state: 'named', name: 'Personal' },
              words: ['amber', 'falcon', 'tide'],
              log: {
                state: 'read',
                devices: 1,
                newestDevice: { state: 'unreported' },
                vaults: 1,
                thisBrowser: true,
              },
            },
          },
        ],
        replacement: { state: 'unavailable' },
      },
    })
    const check = vi.spyOn(AccessCheckActions.prototype, 'checkPasskey')
    const { view, vault } = renderWizard(signedInDrive())

    const identity = await view.findByTestId('provider-identity')
    expect(identity.dataset.standing).toBe('thisBrowser')
    expect(
      view.getByTestId('provider-identity-standing').textContent?.trim(),
    ).toBe(vault.t(I18N_KEYS.AccessCheckIdentityThisBrowser))
    // An identity that already opens needs no passkey hunt or join request.
    expect(
      view.queryAllByTestId('provider-identity-find-passkey'),
    ).toHaveLength(0)
    expect(view.queryAllByTestId('provider-identity-ask-to-join')).toHaveLength(
      0,
    )
    expect(check).not.toHaveBeenCalled()
  })

  test('finding the passkey opens the whole identity and names its vaults', async () => {
    listVaults({
      root: 'found',
      listing: {
        vaults: [
          summary('store_othervault1', { state: 'unchecked' }, [
            'importSeparately',
          ]),
          summary('store_othervault2', { state: 'unchecked' }, [
            'importSeparately',
          ]),
        ],
        replacement: { state: 'unavailable' },
      },
    })
    const opens: CredentialCheckReport = {
      credential: { kind: 'passkey', fingerprint: 'passkey_a1b2c3d4e5f60708' },
      identities: [
        {
          identityId: 'idn_strangerabc',
          words: ['ripple', 'canvas', 'orbit'],
          name: { state: 'named', name: 'Personal' },
          outcome: 'opens',
          vaults: [
            {
              storeId: 'store_othervault1',
              shortId: 'othervau',
              outcome: {
                state: 'opens',
                name: { state: 'named', name: 'Family' },
              },
            },
            {
              storeId: 'store_othervault2',
              shortId: 'othervau',
              outcome: {
                state: 'opens',
                name: { state: 'named', name: 'Work' },
              },
            },
          ],
        },
      ],
    }
    const check = vi
      .spyOn(AccessCheckActions.prototype, 'checkPasskey')
      .mockResolvedValue(ok(opens))
    const { view, vault } = renderWizard(signedInDrive())

    const identity = await view.findByTestId('provider-identity')
    expect(identity.dataset.standing).toBe('unchecked')
    expect(identity.textContent).not.toContain('Family')
    // The check sits on the identity, not on each vault.
    expect(view.getAllByTestId('provider-identity-find-passkey')).toHaveLength(
      1,
    )
    expect(view.getAllByTestId('connect-provider-btn')).toHaveLength(1)
    await fireEvent.click(view.getByTestId('provider-identity-find-passkey'))

    await vi.waitFor(() =>
      expect(identity.dataset.standing).toBe('openedByPasskey'),
    )
    expect(check).toHaveBeenCalledWith({
      kind: AccessCheckTargetKind.Source,
      source: { kind: 'googleDrive', accessToken: 'drive-token' },
    })
    expect(identity.textContent).toContain('Family')
    expect(identity.textContent).toContain('Work')
    expect(
      identity.querySelector('[data-testid="provider-vault-identity"]')
        ?.textContent,
    ).toBe(
      vault.t({
        key: I18N_KEYS.ProviderVaultsFiledUnder,
        replacements: { identity: 'Personal' },
      }),
    )
    expect(
      view.getByTestId('provider-identity-standing').textContent?.trim(),
    ).toBe(
      vault.t({
        key: I18N_KEYS.AccessCheckIdentityOpenedBy,
        replacements: { id: 'a1b2c3d4' },
      }),
    )
    expect(
      view.queryAllByTestId('provider-identity-find-passkey'),
    ).toHaveLength(0)
    // The opened identity is recovered with the passkey, as one choice.
    expect(view.queryAllByTestId('provider-vault-import')).toHaveLength(0)
    expect(
      view.getByTestId('provider-identity-open').closest('label')?.textContent,
    ).toContain(vault.t(I18N_KEYS.AccessCheckRecoverWithPasskey))
  })

  test('an identity no passkey opens offers the checker again and a join request', async () => {
    listVaults({
      root: 'found',
      listing: {
        vaults: [summary('store_othervault1', { state: 'unchecked' }, [])],
        replacement: { state: 'unavailable' },
      },
    })
    const none: CredentialCheckReport = {
      credential: { kind: 'passkey', fingerprint: 'passkey_ffffffffffffffff' },
      identities: [
        {
          identityId: 'idn_strangerabc',
          words: ['ripple', 'canvas', 'orbit'],
          name: { state: 'unknown' },
          outcome: 'doesNotOpen',
          vaults: [
            {
              storeId: 'store_othervault1',
              shortId: 'othervau',
              outcome: { state: 'doesNotOpen' },
            },
          ],
        },
      ],
    }
    vi.spyOn(AccessCheckActions.prototype, 'checkPasskey').mockResolvedValue(
      ok(none),
    )
    const { view, vault } = renderWizard(signedInDrive())

    await fireEvent.click(
      await view.findByTestId('provider-identity-find-passkey'),
    )

    const identity = view.getByTestId('provider-identity')
    await vi.waitFor(() => expect(identity.dataset.standing).toBe('notOpened'))
    expect(
      view.getByTestId('provider-identity-standing').textContent?.trim(),
    ).toBe(vault.t(I18N_KEYS.AccessCheckIdentityNotOpened))
    expect(view.getAllByTestId('provider-identity-find-passkey')).toHaveLength(
      1,
    )
    // No vault here can be requested, so joining needs a code from a device.
    await fireEvent.click(view.getByTestId('provider-identity-ask-to-join'))
    expect(
      view.getByTestId('provider-identity-join-help').textContent?.trim(),
    ).toBe(vault.t(I18N_KEYS.AccessCheckJoinWithCode))
  })

  test('a backup password check holds the step until it is checked or cancelled', async () => {
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
    const passwordOpens: CredentialCheckReport = {
      credential: { kind: 'backupPassword' },
      identities: [
        {
          identityId: 'idn_strangerabc',
          words: ['ripple', 'canvas', 'orbit'],
          name: { state: 'unknown' },
          outcome: 'vaultsOnly',
          vaults: [
            {
              storeId: 'store_othervault1',
              shortId: 'othervau',
              outcome: {
                state: 'opens',
                name: { state: 'named', name: 'Family' },
              },
            },
          ],
        },
      ],
    }
    const check = vi
      .spyOn(AccessCheckActions.prototype, 'checkBackupPassword')
      .mockResolvedValue(ok(passwordOpens))
    const { view, vault } = renderWizard(signedInDrive())

    await fireEvent.click(
      await view.findByTestId('provider-vault-check-password'),
    )
    // While the form is open its Check is the only live action.
    expect(
      view.getByTestId('connect-provider-btn').hasAttribute('disabled'),
    ).toBe(true)
    const submit = view.getByTestId('provider-vault-password-check-btn')
    expect(submit.hasAttribute('disabled')).toBe(true)
    await fireEvent.input(
      view.getByTestId('provider-vault-password-check-input'),
      { target: { value: 'correct horse battery staple' } },
    )
    await fireEvent.click(submit)

    await vi.waitFor(() =>
      expect(
        view.queryAllByTestId('provider-vault-password-check'),
      ).toHaveLength(0),
    )
    expect(check).toHaveBeenCalledWith({
      target: {
        kind: AccessCheckTargetKind.Source,
        source: { kind: 'googleDrive', accessToken: 'drive-token' },
      },
      password: 'correct horse battery staple',
    })
    const row = view.getByTestId('provider-vault-row')
    expect(row.textContent).toContain('Family')
    expect(
      view.getByTestId('provider-vault-verification').textContent?.trim(),
    ).toBe(vault.t(I18N_KEYS.AccessCheckVaultVerifiedPassword))
    expect(
      view.getByTestId('provider-vault-import').closest('label')?.textContent,
    ).toContain(vault.t(I18N_KEYS.AccessCheckRecoverWithPassword))
    expect(
      view.getByTestId('connect-provider-btn').hasAttribute('disabled'),
    ).toBe(false)
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

  test('asking to join requests access to each of its vaults and lists again', async () => {
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
      await view.findByTestId('provider-identity-ask-to-join'),
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
