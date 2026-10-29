import { fireEvent, render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { err, ok } from 'neverthrow'
import { DeviceProtectionStatus } from '$app-wasm'
import type {
  CredentialCheckReport,
  IdentityControlSnapshot,
  NookGoogleDriveVaultListing,
  ProviderIdentityJoin,
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
  IdentityPlanOutcomeKind,
  type IdentityPlanOutcome,
} from '$lib/vault/identity-plan-actions'
import {
  IdentityControlViewKind,
  type IdentityControlView,
} from '$lib/vault/identity-control.svelte'
import type { VaultState } from '$lib/vault.svelte'
import { WorkspaceSection } from '$lib/vault/state/ui.svelte'
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

/** One vault of an identity of its own, whose log tells a join's answer. */
function joinedSummary(
  identityId: string,
  join: ProviderIdentityJoin,
): ProviderVaultSummary {
  const base = summary(
    `store_${identityId.slice('idn_'.length)}`,
    { state: 'locked' },
    ['requestAccess'],
  )
  return {
    ...base,
    identity: {
      ...base.identity,
      identityId,
      log: {
        state: 'read',
        devices: 1,
        newestDevice: { state: 'unreported' },
        vaults: 1,
        thisBrowser: false,
        join,
      },
    },
  }
}

/** Adding a sync provider runs with an identity in use. */
function useIdentity(vault: VaultState): void {
  const snapshot: IdentityControlSnapshot = {
    identityId: 'idn_personalide',
    identityLabel: 'Personal',
    standing: 'member',
    members: [{ appId: 'app_here', label: '', isCurrentInstallation: true }],
    joinRequests: [],
    vaults: [],
    mounts: [],
  }
  const ready: IdentityControlView = {
    kind: IdentityControlViewKind.Ready,
    snapshot,
  }
  vault.identityControl.view = ready
  vault.isAuthenticated = true
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
  test('before sign-in, the step draws where the identity goes instead of explaining it', () => {
    const { view, vault } = renderWizard(
      defaultOAuthFileConfig({ preset: 'google-drive', fileName: 'vault' }),
    )

    const step = view.getByTestId('google-setup-connection-step')
    const diagram = view.getByTestId('first-run-sync-diagram')
    expect(step.contains(diagram)).toBe(true)
    expect(diagram.textContent).toContain(
      vault.t(I18N_KEYS.ProviderPickerGoogleDrive),
    )
    expect(step.contains(view.getByTestId('google-sign-in-btn'))).toBe(true)
    // One diagram on the page: Connect & sync does not draw it again.
    expect(view.getAllByTestId('first-run-sync-diagram')).toHaveLength(1)
  })

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

  test('with an identity in use, lists each identity once with its one action', async () => {
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
    useIdentity(vault)

    await vi.waitFor(() =>
      expect(view.getAllByTestId('setup-identity')).toHaveLength(2),
    )
    const [own, other] = view.getAllByTestId('setup-identity')
    if (!other) throw new Error('the stranger is not listed')
    // The identity in use has no action of its own: the step's button
    // saves it here.
    expect(own?.dataset.setup).toBe('inUse')
    expect(own?.textContent).toContain('Personal')
    expect(
      own
        ?.querySelector('[data-testid="provider-identity-standing"]')
        ?.textContent?.trim(),
    ).toBe(vault.t(I18N_KEYS.FirstRunIdentityInUse))
    // Cards are about identities: no vault is listed or acted on.
    expect(own?.textContent).not.toContain('Family')
    expect(own?.querySelectorAll('button')).toHaveLength(0)
    // The stranger is named by its three words; its log tells its facts.
    expect(other.dataset.setup).toBe('requestToJoin')
    expect(
      other.querySelector('[data-testid="provider-vault-identity"]')
        ?.textContent,
    ).toContain('ripple-canvas-orbit')
    expect(
      other
        .querySelector('[data-testid="provider-identity-standing"]')
        ?.textContent?.trim(),
    ).toBe(vault.t(I18N_KEYS.FirstRunIdentityNotMember))
    expect(
      Array.from(
        other.querySelectorAll('[data-testid="provider-vault-identity-log"]'),
      ).map((line) => line.textContent),
    ).toContain(
      vault.t({
        key: I18N_KEYS.ProviderVaultsDevices,
        replacements: { count: '2' },
      }),
    )
    // Its one action asks to join it; nothing is planned or decided.
    expect(
      other.querySelectorAll('[data-testid="setup-identity-join"]'),
    ).toHaveLength(1)
    expect(view.queryAllByTestId('provider-identity-decision')).toHaveLength(0)
    // Or the identity in use is saved there as a new identity.
    expect(view.getAllByTestId('connect-provider-btn')).toHaveLength(1)
    const create = view.getByTestId('connect-provider-btn').textContent
    expect(create).toContain(vault.t(I18N_KEYS.FirstRunSyncCreateTitle))
    expect(create).toContain(
      vault.t({
        key: I18N_KEYS.ProviderIdentitiesNewIdentityDetail,
        replacements: { identity: 'Personal' },
      }),
    )
  })

  test('with an identity in use, asking to join runs at once and lists again', async () => {
    const listed = listVaults({
      root: 'found',
      listing: {
        vaults: [
          summary('store_othervault1', { state: 'locked' }, ['requestAccess']),
        ],
        replacement: { state: 'unavailable' },
      },
    })
    const applied: IdentityPlanOutcome = {
      kind: IdentityPlanOutcomeKind.Applied,
    }
    const run = vi
      .spyOn(IdentityPlanActions.prototype, 'run')
      .mockResolvedValue(ok(applied))
    const { view, vault, onConnect } = renderWizard(signedInDrive())
    useIdentity(vault)

    await fireEvent.click(await view.findByTestId('setup-identity-join'))

    await vi.waitFor(() => expect(listed).toHaveBeenCalledTimes(2))
    const call = run.mock.calls.at(0)
    if (!call) throw new Error('the join was not asked')
    const [request] = call
    expect(request.source).toEqual({
      kind: 'googleDrive',
      accessToken: 'drive-token',
    })
    expect(request.planned.map((entry) => entry.decision)).toEqual([
      'askToJoin',
    ])
    // Asking connects nothing: the step's button still saves the identity
    // in use.
    expect(onConnect).not.toHaveBeenCalled()
  })

  test('with an identity in use, a member continues and the provider connects', async () => {
    listVaults({
      root: 'found',
      listing: {
        vaults: [
          joinedSummary('idn_approvedabc', 'approved'),
          joinedSummary('idn_requestedab', 'requested'),
        ],
        replacement: { state: 'unavailable' },
      },
    })
    const applied: IdentityPlanOutcome = {
      kind: IdentityPlanOutcomeKind.Applied,
    }
    const run = vi
      .spyOn(IdentityPlanActions.prototype, 'run')
      .mockResolvedValue(ok(applied))
    const connect = vi
      .spyOn(VaultOAuthActions.prototype, 'connectGoogleVaultFolder')
      .mockResolvedValue(
        ok({ name: 'Nook', origin: GoogleVaultFolderOrigin.Created }),
      )
    const { view, vault, onConnect } = renderWizard(signedInDrive())
    useIdentity(vault)

    await vi.waitFor(() =>
      expect(view.getAllByTestId('setup-identity')).toHaveLength(2),
    )
    const [member, asked] = view.getAllByTestId('setup-identity')
    if (!asked) throw new Error('the asked identity is not listed')
    expect(
      member
        ?.querySelector('[data-testid="provider-identity-standing"]')
        ?.textContent?.trim(),
    ).toBe(vault.t(I18N_KEYS.FirstRunIdentityMember))
    expect(
      asked
        .querySelector('[data-testid="provider-identity-standing"]')
        ?.textContent?.trim(),
    ).toBe(vault.t(I18N_KEYS.AccessCheckIdentityRequested))
    expect(
      asked.querySelectorAll('[data-testid="setup-identity-check"]'),
    ).toHaveLength(1)

    await fireEvent.click(view.getByTestId('setup-identity-continue'))

    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())
    const call = run.mock.calls.at(0)
    if (!call) throw new Error('the member did not continue')
    const [request] = call
    expect(
      request.planned.map((entry) => [
        entry.choice.identity.identityId,
        entry.decision,
      ]),
    ).toEqual([['idn_approvedabc', 'finishJoining']])
    // Bringing the identity here completes the step: Drive connects.
    await vi.waitFor(() => expect(onConnect).toHaveBeenCalledOnce())
    expect(connect).toHaveBeenCalledOnce()
  })

  test('an identity unlocked without a vault is the identity in use there', async () => {
    listVaults({
      root: 'found',
      listing: {
        vaults: [joinedSummary('idn_approvedabc', 'approved')],
        replacement: { state: 'unavailable' },
      },
    })
    const { view, vault } = renderWizard(signedInDrive())
    useIdentity(vault)
    vault.isAuthenticated = false
    vault.deviceProtectionStatus = DeviceProtectionStatus.Unlocked
    vault.identityPage = WorkspaceSection.Sync

    await vi.waitFor(() =>
      expect(view.getAllByTestId('setup-identity')).toHaveLength(1),
    )
    expect(view.getByTestId('setup-identity-continue')).toBeTruthy()
    expect(view.getByTestId('connect-provider-btn').textContent).toContain(
      vault.t(I18N_KEYS.FirstRunSyncCreateTitle),
    )
  })

  test('on the recovery screen, picking a decision plans it, and Leave as is takes it back out', async () => {
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

  test('on the recovery screen, finding the passkey offers adding it, and the plan runs before Connect & sync', async () => {
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
    const applied: IdentityPlanOutcome = {
      kind: IdentityPlanOutcomeKind.Applied,
    }
    const run = vi
      .spyOn(IdentityPlanActions.prototype, 'run')
      .mockResolvedValue(ok(applied))
    const connect = vi
      .spyOn(VaultOAuthActions.prototype, 'connectGoogleVaultFolder')
      .mockResolvedValue(
        ok({ name: 'Nook', origin: GoogleVaultFolderOrigin.Existing }),
      )
    const { view, vault, onConnect } = renderWizard(signedInDrive())

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
    // With no identity in use, one the passkey opens is added to this
    // browser as a whole.
    expect(
      view
        .getAllByTestId('provider-identity-decision')
        .map((button) => button.dataset.decision),
    ).toEqual(['leave', 'addToBrowser'])

    await fireEvent.click(await DecisionButtons.of(view, 'addToBrowser'))
    await fireEvent.click(view.getByTestId('connect-provider-btn'))

    await vi.waitFor(() => expect(onConnect).toHaveBeenCalledOnce())
    expect(run).toHaveBeenCalledOnce()
    const call = run.mock.calls.at(0)
    if (!call) throw new Error('the plan did not run')
    const [request] = call
    expect(request.source).toEqual({
      kind: 'googleDrive',
      accessToken: 'drive-token',
    })
    expect(request.planned.map((entry) => entry.decision)).toEqual([
      'addToBrowser',
    ])
    expect(connect).toHaveBeenCalledOnce()
  })

  test('with an identity in use, an action that fails says so and connects nothing', async () => {
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
    useIdentity(vault)

    await fireEvent.click(await view.findByTestId('setup-identity-join'))

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
