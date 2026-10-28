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
  IdentityPlanActions,
  IdentityPlanFailure,
  IdentityPlanFailureKind,
  IdentityPlanOutcome,
} from '$lib/vault/identity-plan-actions'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import OAuthProviderSetupWizard from '../../../../nook-web-shared/src/vault-app/lib/components/OAuthProviderSetupWizard.svelte'

afterEach(() => vi.restoreAllMocks())

/** What a rendered page offers to find its decision buttons. */
type DecisionView = {
  readonly getAllByTestId: (testId: string) => HTMLElement[]
}

/** The decision button of one kind, once the listing shows it. */
class DecisionButtons {
  static async of(view: DecisionView, decision: string): Promise<HTMLElement> {
    return vi.waitFor(() => {
      const found = view
        .getAllByTestId('provider-identity-decision')
        .find((button) => button.dataset.decision === decision)
      if (!found) throw new Error(`no ${decision} decision`)
      return found
    })
  }
}

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
        join: 'notAsked',
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

  test('lists each identity once, with its standing and its vaults by name', async () => {
    listVaults({
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
          summary('store_othervault2', { state: 'locked' }, ['requestAccess']),
        ],
        replacement: { state: 'unavailable' },
      },
    })
    const { view, vault } = renderWizard(signedInDrive())
    // Drive setup runs with an identity in use.
    vault.isAuthenticated = true

    await vi.waitFor(() =>
      expect(view.getAllByTestId('provider-identity')).toHaveLength(2),
    )
    const [own, other] = view.getAllByTestId('provider-identity')
    // The identity this browser syncs needs nothing decided.
    expect(own?.dataset.standing).toBe('thisBrowser')
    expect(own?.textContent).toContain('Personal')
    expect(own?.textContent).toContain('Family')
    expect(
      own?.querySelectorAll('[data-testid="provider-identity-decision"]'),
    ).toHaveLength(0)
    // The stranger is named by its three words; its log tells its facts;
    // its two vaults are listed once, under it.
    expect(other?.dataset.standing).toBe('unchecked')
    expect(
      other?.querySelector('[data-testid="provider-vault-identity"]')
        ?.textContent,
    ).toContain('ripple-canvas-orbit')
    expect(
      other?.querySelectorAll('[data-testid="provider-vault-row"]'),
    ).toHaveLength(2)
    expect(
      Array.from(
        other?.querySelectorAll(
          '[data-testid="provider-vault-identity-log"]',
        ) ?? [],
      ).map((line) => line.textContent),
    ).toContain(
      vault.t({
        key: I18N_KEYS.ProviderVaultsDevices,
        replacements: { count: '2' },
      }),
    )
    // It is decided as a whole: leave it, or ask to join it.
    const decisions = Array.from(
      other?.querySelectorAll<HTMLElement>(
        '[data-testid="provider-identity-decision"]',
      ) ?? [],
    )
    expect(decisions.map((button) => button.dataset.decision)).toEqual([
      'leave',
      'askToJoin',
    ])
    expect(decisions[0]?.getAttribute('aria-checked')).toBe('true')
    expect(view.getAllByTestId('connect-provider-btn')).toHaveLength(1)
    expect(view.getByTestId('connect-provider-btn').textContent).toContain(
      vault.t(I18N_KEYS.AuthStorageConnectAndSync),
    )
  })

  test('picking a decision plans it, and Leave as is takes it back out', async () => {
    listVaults({
      root: 'found',
      listing: {
        vaults: [
          summary('store_othervault1', { state: 'locked' }, ['requestAccess']),
        ],
        replacement: { state: 'unavailable' },
      },
    })
    const { view, vault } = renderWizard(signedInDrive())
    // Drive setup runs with an identity in use.
    vault.isAuthenticated = true

    const join = await DecisionButtons.of(view, 'askToJoin')
    await fireEvent.click(join)

    expect(join.getAttribute('aria-checked')).toBe('true')
    expect(
      view.getByTestId('provider-identity-plan-row').textContent,
    ).toContain(vault.t(I18N_KEYS.ProviderIdentitiesAskToJoin))
    expect(view.getByTestId('connect-provider-btn').textContent).toContain(
      vault.t(I18N_KEYS.ProviderIdentitiesConnectApply),
    )

    await fireEvent.click(await DecisionButtons.of(view, 'leave'))
    expect(view.queryAllByTestId('provider-identity-plan')).toHaveLength(0)
    expect(view.getByTestId('connect-provider-btn').textContent).toContain(
      vault.t(I18N_KEYS.AuthStorageConnectAndSync),
    )
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
                join: 'notAsked',
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
    // An identity that already opens needs no passkey hunt and no decision.
    expect(
      view.queryAllByTestId('provider-identity-find-passkey'),
    ).toHaveLength(0)
    expect(view.queryAllByTestId('provider-identity-decision')).toHaveLength(0)
    expect(check).not.toHaveBeenCalled()
  })

  test('finding the passkey offers adding or merging, and the plan runs before Connect & sync', async () => {
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
    const run = vi
      .spyOn(IdentityPlanActions.prototype, 'run')
      .mockResolvedValue(ok(IdentityPlanOutcome.Applied))
    const connect = vi
      .spyOn(VaultOAuthActions.prototype, 'connectGoogleVaultFolder')
      .mockResolvedValue(
        ok({ name: 'Nook', origin: GoogleVaultFolderOrigin.Existing }),
      )
    const { view, vault, onConnect } = renderWizard(signedInDrive())
    vault.isAuthenticated = true

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
      identity
        .querySelector('[data-testid="provider-vault-identity"]')
        ?.textContent?.trim(),
    ).toBe('Personal')
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
    // An identity the passkey opens is added to this browser or merged
    // into the identity in use, as a whole.
    expect(
      view
        .getAllByTestId('provider-identity-decision')
        .map((button) => button.dataset.decision),
    ).toEqual(['leave', 'addToBrowser', 'mergeIntoCurrent'])

    await fireEvent.click(await DecisionButtons.of(view, 'mergeIntoCurrent'))
    await fireEvent.click(view.getByTestId('connect-provider-btn'))

    await vi.waitFor(() => expect(onConnect).toHaveBeenCalledOnce())
    expect(run).toHaveBeenCalledOnce()
    const [request] = run.mock.calls[0] ?? []
    expect(request?.source).toEqual({
      kind: 'googleDrive',
      accessToken: 'drive-token',
    })
    expect(request?.planned.map((entry) => entry.decision)).toEqual([
      'mergeIntoCurrent',
    ])
    expect(connect).toHaveBeenCalledOnce()
  })

  test('a decision that fails stops the plan before Connect & sync', async () => {
    listVaults({
      root: 'found',
      listing: {
        vaults: [
          summary('store_othervault1', { state: 'locked' }, ['requestAccess']),
        ],
        replacement: { state: 'unavailable' },
      },
    })
    vi.spyOn(IdentityPlanActions.prototype, 'run').mockResolvedValue(
      err(new IdentityPlanFailure(IdentityPlanFailureKind.Join)),
    )
    const { view, vault, onConnect } = renderWizard(signedInDrive())
    // Drive setup runs with an identity in use.
    vault.isAuthenticated = true

    await fireEvent.click(await DecisionButtons.of(view, 'askToJoin'))
    await fireEvent.click(view.getByTestId('connect-provider-btn'))

    await vi.waitFor(() =>
      expect(view.getByTestId('google-oauth-error').textContent).toContain(
        vault.t(I18N_KEYS.ProviderIdentitiesJoinFailed),
      ),
    )
    expect(onConnect).not.toHaveBeenCalled()
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
    // Nothing here opens it: it can only be joined, by a device's approval.
    expect(
      view
        .getAllByTestId('provider-identity-decision')
        .map((button) => button.dataset.decision),
    ).toEqual(['leave', 'askToJoin'])
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
