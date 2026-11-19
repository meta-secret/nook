import { fireEvent, render, within } from '@testing-library/svelte'
import { tick, type ComponentProps } from 'svelte'
import { err, ok } from 'neverthrow'
import {
  apply_google_drive_sign_in,
  DeviceProtectionStatus,
  NookDriveRootOrigin,
} from '$app-wasm'
import type {
  CredentialCheckReport,
  ProviderDraft,
  IdentityControlSnapshot,
  NookGoogleDriveVaultListing,
  ProviderIdentityJoin,
  ProviderListedIdentity,
  ProviderVaultSummary,
} from '$app-wasm'
import { OAuthFailure, OAuthFailureKind } from '$lib/auth/oauth-failure'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import {
  ProviderDraftFixture,
  ProviderFixtureCredentials,
} from '../provider-fixtures'
import { VaultOAuthActions } from '$lib/vault/oauth'
import { FirstRunActions, ProviderFolderBinding } from '$lib/vault/first-run'
import type { OAuthProviderDraft } from '$lib/vault/provider-draft-reads'
import { ProviderSetupKinds } from '$lib/vault/provider-setup-kinds'
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

/** A Drive draft, as the wizard's host narrows it. */
function oauthDraft(draft: ProviderDraft): OAuthProviderDraft {
  switch (draft.type) {
    case 'oauth-file':
      return draft
    case 'local':
    case 'local-folder':
    case 'github':
    case 's3':
      throw new Error('expected a Drive draft')
  }
}

function signedInDrive(): OAuthProviderDraft {
  return oauthDraft(ProviderDraftFixture.googleDriveSignedIn())
}

/** The Drive source a signed-in draft lists from. */
const DRIVE_SOURCE = {
  kind: 'remote',
  source: {
    kind: 'googleDrive',
    accessToken: ProviderFixtureCredentials.DRIVE_TOKEN,
  },
} as const

function summary(
  storeId: string,
  access: ProviderVaultSummary['access'],
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
        recoveryPassphrases: 0,
        thisBrowser: false,
        join: 'notAsked',
      },
    },
    created: { state: 'reported', at: Date.UTC(2024, 0, 2) },
    lastActivity: { state: 'reported', at: Date.UTC(2024, 2, 1) },
    eventCount: 4,
    access,
  }
}

/** One vault of an identity of its own, whose log tells a join's answer. */
function joinedSummary(
  identityId: string,
  join: ProviderIdentityJoin,
): ProviderVaultSummary {
  const base = summary(`store_${identityId.slice('idn_'.length)}`, {
    state: 'locked',
  })
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
        recoveryPassphrases: 0,
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
    members: [
      {
        appId: 'app_here',
        label: '',
        isCurrentInstallation: true,
        onCurrentDevice: true,
        approvedBy: { kind: 'founder' },
      },
    ],
    devices: [],
    deviceCount: 1,
    extensionOnThisDevice: 'notJoined',
    joinRequests: [],
    vaults: [],
    mounts: [],
    recoveryPassphrases: [],
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

function renderWizard(draft: OAuthProviderDraft) {
  const vault = VaultStateTestFixture.create()
  vault.activateLoginSetup(ProviderSetupKinds.GOOGLE_DRIVE)
  vault.stageProviderDraft(draft)
  const onConnect = vi.fn()
  const props = {
    vault,
    draft,
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
      oauthDraft(ProviderDraftFixture.googleDriveAwaitingSignIn()),
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
        ok({ name: 'Nook', origin: NookDriveRootOrigin.Created }),
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
            ...summary('store_ownvault001', { state: 'syncs' }),
            name: { state: 'named', name: 'Family' },
            identity: {
              identityId: 'idn_personalide',
              shortId: 'personal',
              name: { state: 'named', name: 'Personal' },
              words: ['amber', 'falcon', 'tide'],
              log: { state: 'absent' },
            },
          },
          summary('store_othervault1', { state: 'locked' }),
          summary('store_othervault2', { state: 'locked' }),
        ],
        identities: [],
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
    expect(own?.contains(view.getByText('amber-falcon-tide'))).toBe(true)
    expect(
      own
        ?.querySelector('[data-testid="provider-identity-standing"]')
        ?.textContent?.trim(),
    ).toBe(vault.t(I18N_KEYS.FirstRunIdentityInUse))
    // Vaults are linked facts. Only the keyring can be acted on.
    expect(own?.textContent).toContain('Family')
    expect(own?.querySelectorAll('button')).toHaveLength(0)
    // The stranger shows only its three-word ID; its log tells its facts.
    expect(other.dataset.setup).toBe('requestToJoin')
    expect(within(other).getAllByText('ripple-canvas-orbit')).toHaveLength(1)
    expect(
      other
        .querySelector('[data-testid="provider-identity-standing"]')
        ?.textContent?.trim(),
    ).toBe(vault.t(I18N_KEYS.FirstRunIdentityNotMember))
    expect(
      within(other).getByTestId('provider-keyring-devices').textContent,
    ).toContain(vault.t(I18N_KEYS.ProviderVaultsDevicesUnavailable))
    expect(
      within(other).getByTestId('provider-keyring-vaults').textContent,
    ).toContain('store_othervault1')
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
        vaults: [summary('store_othervault1', { state: 'locked' })],
        identities: [],
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
    expect(request.source).toEqual(DRIVE_SOURCE)
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
        identities: [],
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
        ok({ name: 'Nook', origin: NookDriveRootOrigin.Created }),
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
        identities: [],
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

  test('on the recovery screen, a way in runs at once: no pick, no plan, no second button', async () => {
    const listed = listVaults({
      root: 'found',
      listing: {
        vaults: [summary('store_othervault1', { state: 'locked' })],
        identities: [],
      },
    })
    const applied: IdentityPlanOutcome = {
      kind: IdentityPlanOutcomeKind.Applied,
    }
    const run = vi
      .spyOn(IdentityPlanActions.prototype, 'run')
      .mockResolvedValue(ok(applied))
    const { view, vault, onConnect } = renderWizard(signedInDrive())

    const join = await DecisionButtons.of(view, 'askToJoin')
    // Each way in says what it needs, as its hint.
    expect(join.getAttribute('title')).toBe(
      vault.t(I18N_KEYS.ProviderIdentitiesAskToJoinDetail),
    )
    // The most direct way in leads; the others stay quieter beside it.
    expect(
      view
        .getAllByTestId('provider-identity-decision')
        .map((button) => [button.dataset.decision, button.dataset.lead]),
    ).toEqual([
      ['addToBrowser', 'true'],
      ['askToJoin', 'false'],
    ])
    // The step's own button is Connect & sync, whatever is clicked above.
    expect(view.getByTestId('connect-provider-btn').textContent).toContain(
      vault.t(I18N_KEYS.AuthStorageConnectAndSync),
    )

    await fireEvent.click(join)

    // One click asked to join; the folder is read again, nothing connects.
    await vi.waitFor(() => expect(listed).toHaveBeenCalledTimes(2))
    expect(run).toHaveBeenCalledOnce()
    const call = run.mock.calls.at(0)
    if (!call) throw new Error('the decision did not run')
    expect(call[0].planned.map((entry) => entry.decision)).toEqual([
      'askToJoin',
    ])
    expect(join.hasAttribute('aria-pressed')).toBe(false)
    expect(view.queryAllByTestId('provider-identity-plan')).toHaveLength(0)
    expect(onConnect).not.toHaveBeenCalled()
  })

  test('this browser opens an identity it is a device of without a check', async () => {
    listVaults({
      root: 'found',
      listing: {
        vaults: [
          {
            ...summary('store_ownvault001', { state: 'syncs' }),
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
                recoveryPassphrases: 0,
                thisBrowser: true,
                join: 'notAsked',
              },
            },
          },
        ],
        identities: [],
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

  test('on the recovery screen, finding the passkey offers adding it, and the keyring it adds keeps Drive without opening a vault', async () => {
    const first = summary('store_othervault1', { state: 'unchecked' })
    const second = summary('store_othervault2', { state: 'unchecked' })
    const listed: ProviderListedIdentity = {
      identity: first.identity,
      details: {
        devices: {
          state: 'listed',
          devices: [
            { label: 'Office laptop', appId: 'app_laptop' },
            { label: '', appId: 'app_phone' },
          ],
        },
        vaults: [first, second].map(({ storeId, name }) => ({ storeId, name })),
      },
    }
    listVaults({
      root: 'found',
      listing: {
        vaults: [first, second],
        identities: [listed],
      },
    })
    const opens: CredentialCheckReport = {
      credential: { fingerprint: 'passkey_a1b2c3d4e5f60708' },
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
    const keep = vi
      .spyOn(FirstRunActions.prototype, 'connectRecoveredKeyring')
      .mockResolvedValue(true)
    const { view, vault, onConnect } = renderWizard(signedInDrive())

    const identity = await view.findByTestId('provider-identity')
    const card = within(identity)
    expect(identity.dataset.standing).toBe('unchecked')
    expect(card.getAllByText('ripple-canvas-orbit')).toHaveLength(1)
    expect(card.queryAllByText('Personal')).toHaveLength(0)
    expect(identity.textContent).not.toContain('Family')
    const devices = within(card.getByTestId('provider-keyring-devices'))
    expect(devices.getByText('Office laptop').textContent).toBe('Office laptop')
    expect(
      devices.getByText(vault.t(I18N_KEYS.ProviderVaultsUnnamedDevice))
        .textContent,
    ).toBe(vault.t(I18N_KEYS.ProviderVaultsUnnamedDevice))
    const laptopId = devices.getByText('app_laptop')
    expect(laptopId.closest('details')?.hasAttribute('open')).toBe(false)
    const vaults = within(card.getByTestId('provider-keyring-vaults'))
    expect(
      vaults.getAllByText(
        vault.t(I18N_KEYS.ProviderVaultsVaultNameUnavailable),
      ),
    ).toHaveLength(2)
    expect(vaults.getByText('store_othervault1').textContent).toBe(
      'store_othervault1',
    )
    // The check sits on the identity, not on each vault.
    expect(view.getAllByTestId('provider-identity-find-passkey')).toHaveLength(
      1,
    )
    expect(view.getAllByTestId('connect-provider-btn')).toHaveLength(1)
    expect(
      view.getByTestId('provider-identity-find-passkey').textContent,
    ).toContain(vault.t(I18N_KEYS.ProviderVaultsRevealDetails))
    await fireEvent.click(view.getByTestId('provider-identity-find-passkey'))

    await vi.waitFor(() =>
      expect(identity.dataset.standing).toBe('openedByPasskey'),
    )
    expect(check).toHaveBeenCalledWith({
      kind: AccessCheckTargetKind.Source,
      source: DRIVE_SOURCE,
    })
    const heading = card.getByTestId('provider-vault-identity')
    expect(heading.textContent?.trim()).toBe('Personal')
    expect(heading.getAttribute('title')).toBe('idn_strangerabc')
    expect(card.getAllByText('ripple-canvas-orbit')).toHaveLength(1)
    expect(vaults.getByText('Family').textContent).toBe('Family')
    expect(vaults.getByText('Work').textContent).toBe('Work')
    expect(vaults.queryAllByRole('button')).toHaveLength(0)
    expect(run).not.toHaveBeenCalled()
    expect(onConnect).not.toHaveBeenCalled()
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
    ).toEqual(['addToBrowser'])
    await fireEvent.click(await DecisionButtons.of(view, 'addToBrowser'))

    // That one click recovers it: the keyring keeps Drive, with its vaults;
    // none of them is opened, and Connect & sync does not run.
    await vi.waitFor(() =>
      expect(keep).toHaveBeenCalledWith(ProviderFolderBinding.DriveFolder),
    )
    expect(onConnect).not.toHaveBeenCalled()
    expect(run).toHaveBeenCalledOnce()
    const call = run.mock.calls.at(0)
    if (!call) throw new Error('the decision did not run')
    const [request] = call
    expect(request.source).toEqual(DRIVE_SOURCE)
    expect(request.planned.map((entry) => entry.decision)).toEqual([
      'addToBrowser',
    ])
  })

  test('with an identity in use, an action that fails says so and connects nothing', async () => {
    listVaults({
      root: 'found',
      listing: {
        vaults: [summary('store_othervault1', { state: 'locked' })],
        identities: [],
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
        vaults: [summary('store_othervault1', { state: 'unchecked' })],
        identities: [],
      },
    })
    const none: CredentialCheckReport = {
      credential: { fingerprint: 'passkey_ffffffffffffffff' },
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
    expect(within(identity).getByRole('status').textContent).toContain(
      vault.t(I18N_KEYS.ProviderVaultsRevealNoMatch),
    )
    // Nothing here opens it: it can only be joined, by a device's approval.
    expect(
      view
        .getAllByTestId('provider-identity-decision')
        .map((button) => button.dataset.decision),
    ).toEqual(['askToJoin'])
  })

  test('ignores a pending setup passkey check after a new Drive sign-in', async () => {
    const listed = listVaults({
      root: 'found',
      listing: {
        vaults: [],
        identities: [
          {
            identity: {
              ...summary('store_othervault1', { state: 'unchecked' }).identity,
              log: {
                state: 'read',
                devices: 0,
                newestDevice: { state: 'unreported' },
                vaults: 0,
                recoveryPassphrases: 0,
                thisBrowser: false,
                join: 'notAsked',
              },
            },
            details: { devices: { state: 'listed', devices: [] }, vaults: [] },
          },
        ],
      },
    })
    let finishCheck: (report: CredentialCheckReport) => void = () => {}
    const report = new Promise<CredentialCheckReport>((resolve) => {
      finishCheck = resolve
    })
    const pending = report.then((checked) => ok(checked))
    const check = vi
      .spyOn(AccessCheckActions.prototype, 'checkPasskey')
      .mockReturnValue(pending)
    const { view, vault } = renderWizard(signedInDrive())
    useIdentity(vault)

    const card = within(await view.findByTestId('setup-identity'))
    expect(card.getByTestId('provider-keyring-devices').textContent).toContain(
      vault.t(I18N_KEYS.ProviderVaultsNoLinkedDevices),
    )
    expect(card.getByTestId('provider-keyring-vaults').textContent).toContain(
      vault.t(I18N_KEYS.ProviderVaultsNoLinkedVaults),
    )
    await fireEvent.click(card.getByTestId('provider-identity-find-passkey'))
    expect(check).toHaveBeenCalledOnce()

    const draft = oauthDraft(
      apply_google_drive_sign_in({
        draft: ProviderDraftFixture.googleDriveAwaitingSignIn(),
        access: {
          authorization: {
            accessToken: 'TEST-ONLY-other-drive-token',
            expiresAt: ProviderFixtureCredentials.EXPIRES_AT,
          },
          account: { state: 'email', email: 'other@example.test' },
        },
      }),
    )
    vault.stageProviderDraft(draft)
    await view.rerender({ draft })
    await vi.waitFor(() => expect(listed).toHaveBeenCalledTimes(2))
    await view.findByTestId('setup-identity')

    finishCheck({
      credential: { fingerprint: 'passkey_a1b2c3d4e5f60708' },
      identities: [
        {
          identityId: 'idn_strangerabc',
          words: ['ripple', 'canvas', 'orbit'],
          name: { state: 'named', name: 'Previous account label' },
          outcome: 'opens',
          vaults: [],
        },
      ],
    })
    await pending
    await tick()
    const current = within(view.getByTestId('setup-identity'))
    expect(current.queryAllByText('Previous account label')).toHaveLength(0)
    expect(
      current.getByTestId('provider-vault-identity').textContent?.trim(),
    ).toBe('ripple-canvas-orbit')
    expect(
      current
        .getByTestId('provider-identity-find-passkey')
        .hasAttribute('disabled'),
    ).toBe(false)
  })

  test('says it found the existing Nook root and syncs beside its vaults', async () => {
    listVaults({
      root: 'found',
      listing: {
        vaults: [],
        identities: [],
      },
    })
    vi.spyOn(
      VaultOAuthActions.prototype,
      'connectGoogleVaultFolder',
    ).mockResolvedValue(
      ok({ name: 'Nook', origin: NookDriveRootOrigin.Existing }),
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
      oauthDraft(ProviderDraftFixture.googleDriveConnected()),
    )

    await view.findByTestId('google-folder-on-connect')
    await fireEvent.click(view.getByTestId('connect-provider-btn'))

    await vi.waitFor(() => expect(onConnect).toHaveBeenCalledOnce())
    expect(create).not.toHaveBeenCalled()
  })
})
