import { fireEvent, render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { ok } from 'neverthrow'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import initNookWasm, {
  NookVaultManager,
  DeviceProtectionStatus,
  type CredentialCheckReport,
  type FilingIdentity,
  type NookIdentityAdded,
  type ProviderIdentityJoin,
  type ProviderVaultSummary,
} from '$app-wasm'
import { AccessCheckActions } from '$lib/vault/access-check'
import {
  DeviceProtectionActions,
  DeviceProtectionActionOutcome,
} from '$lib/vault/device-protection.svelte'
import {
  IdentityPlanActions,
  IdentityPlanOutcomeKind,
} from '$lib/vault/identity-plan-actions'
import { IdentityJoinWaitKind } from '$lib/vault/identity-join-wait'
import { IdentityPages } from '$lib/vault/identity-pages'
import { FirstRunActions, ProviderFolderBinding } from '$lib/vault/first-run'
import {
  RemoteVaultChoices,
  type RemoteVaultChoiceList,
} from '$lib/vault/state/provider.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import RemoteVaultChoice from '../../../../nook-web-shared/src/vault-app/lib/components/login/RemoteVaultChoice.svelte'

beforeAll(async () => {
  await initNookWasm()
})

afterEach(() => vi.restoreAllMocks())

const family: FilingIdentity = {
  identityId: 'idn_familyident',
  shortId: 'familyid',
  name: { state: 'unknown' },
  words: ['ripple', 'canvas', 'orbit'],
  log: { state: 'absent' },
}

const stranger: FilingIdentity = {
  identityId: 'idn_strangerabc',
  shortId: 'stranger',
  name: { state: 'unknown' },
  words: ['amber', 'falcon', 'tide'],
  log: { state: 'absent' },
}

/** The stranger, with its log telling where this browser's join stands. */
function strangerWhoseJoinIs(join: ProviderIdentityJoin): FilingIdentity {
  return {
    ...stranger,
    log: {
      state: 'read',
      devices: 2,
      newestDevice: { state: 'unreported' },
      vaults: 1,
      recoveryPassphrases: 0,
      thisBrowser: false,
      join,
    },
  }
}

/** One recoverable vault filed under one identity. */
type ChoiceRequest = { storeId: string; identity: FilingIdentity }

function choice({ storeId, identity }: ChoiceRequest): ProviderVaultSummary {
  return {
    storeId,
    shortId: storeId.slice('store_'.length, 'store_'.length + 8),
    name: { state: 'unknown' },
    identity,
    created: { state: 'unreported' },
    lastActivity: { state: 'unreported' },
    eventCount: 3,
    access: { state: 'unchecked' },
  }
}

function renderChoice(
  vaults: ProviderVaultSummary[],
  identities: FilingIdentity[] = [],
) {
  const vault = VaultStateTestFixture.create()
  const choices: RemoteVaultChoiceList = {
    vaults,
    identities: identities.map((identity) => ({
      identity,
      details: { devices: { state: 'Unavailable' }, vaults: [] },
    })),
  }
  vault.remoteVaultChoices = new RemoteVaultChoices(choices)
  const onApplied = vi.fn()
  const props = { vault, busy: false, onApplied } satisfies ComponentProps<
    typeof RemoteVaultChoice
  >
  return { view: render(RemoteVaultChoice, props), vault, onApplied }
}

/** One card from a listing, which may be missing. */
type ListedCard = ReturnType<HTMLElement[]['at']>

/** The decisions an identity card offers, in order. */
function decisionsOf(card: ListedCard): string[] {
  if (!card) throw new Error('no identity card')
  return Array.from(
    card.querySelectorAll<HTMLElement>(
      '[data-testid="provider-identity-decision"]',
    ),
  ).map((button) => String(button.dataset.decision))
}

const familyVault: ChoiceRequest = {
  storeId: 'store_familyvault',
  identity: family,
}
const strangerVault: ChoiceRequest = {
  storeId: 'store_othervault1',
  identity: stranger,
}

describe('Recovery vault choice', () => {
  test('vaults are grouped by identity, and a found passkey opens its whole identity', async () => {
    const report: CredentialCheckReport = {
      credential: { fingerprint: 'passkey_a1b2c3d4e5f60708' },
      identities: [
        {
          identityId: family.identityId,
          words: family.words,
          name: { state: 'named', name: 'Family' },
          outcome: 'opens',
          vaults: [
            {
              storeId: 'store_familyvault',
              shortId: 'familyva',
              outcome: {
                state: 'opens',
                name: { state: 'named', name: 'Groceries' },
              },
            },
          ],
        },
        {
          identityId: stranger.identityId,
          words: stranger.words,
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
    const check = vi
      .spyOn(AccessCheckActions.prototype, 'checkKeyring')
      .mockResolvedValue(ok(report))
    const { view } = renderChoice([choice(familyVault), choice(strangerVault)])

    expect(
      view
        .getAllByTestId('provider-identity')
        .map((card) => card.dataset.standing),
    ).toEqual(['unchecked', 'unchecked'])
    const [whichPasskey] = view.getAllByTestId('provider-identity-find-passkey')
    if (!whichPasskey) throw new Error('no passkey check offered')
    await fireEvent.click(whichPasskey)

    await vi.waitFor(() =>
      expect(
        view
          .getAllByTestId('provider-identity')
          .map((card) => card.dataset.standing),
      ).toEqual(['openedByPasskey', 'notOpened']),
    )
    // A staged provider is read through the session's manager.
    expect(check).toHaveBeenCalledWith({
      kind: 'currentProvider',
    })
    const [familyCard, strangerCard] = view.getAllByTestId('provider-identity')
    expect(familyCard?.textContent).toContain('Family')
    expect(decisionsOf(familyCard)).toEqual(['addToBrowser'])
    // The identity no passkey opened can only be asked to let this browser in.
    expect(decisionsOf(strangerCard)).toEqual(['askToJoin'])

    // A second selection replaces the first match and its Open action.
    const neither: CredentialCheckReport = {
      credential: { fingerprint: 'passkey_ffffffffffffffff' },
      identities: report.identities.map((identity) => ({
        ...identity,
        name: { state: 'unknown' },
        outcome: 'doesNotOpen',
        vaults: [],
      })),
    }
    check.mockResolvedValueOnce(ok(neither))
    await fireEvent.click(view.getByTestId('provider-identity-find-passkey'))
    await vi.waitFor(() =>
      expect(familyCard?.dataset.standing).toBe('notOpened'),
    )
    expect(decisionsOf(familyCard)).toEqual(['askToJoin'])
  })

  test('a keyring that owns no vault is listed with its ways in', () => {
    const { view } = renderChoice([], [strangerWhoseJoinIs('notAsked')])

    const [card] = view.getAllByTestId('provider-identity')
    expect(card?.dataset.storeIds).toBe('')
    expect(decisionsOf(card)).toEqual(['addToBrowser', 'askToJoin'])
  })

  test.each(['inUse', 'besideIdentityInUse'] as const)(
    'a keyring opened after a single passkey selection keeps the provider (%s)',
    async (selection) => {
      const report: CredentialCheckReport = {
        credential: { fingerprint: 'passkey_a1b2c3d4e5f60708' },
        identities: [
          {
            identityId: family.identityId,
            words: family.words,
            name: { state: 'named', name: 'Family' },
            outcome: 'opens',
            vaults: [
              {
                storeId: 'store_familyvault',
                shortId: 'familyva',
                outcome: { state: 'opens', name: { state: 'unknown' } },
              },
            ],
          },
        ],
      }
      const { view, vault, onApplied } = renderChoice([
        choice(familyVault),
        choice(strangerVault),
      ])
      const manager = new NookVaultManager()
      const addedFamily: NookIdentityAdded = {
        identityId: family.identityId,
        selection,
      }
      const beside = vi
        .spyOn(IdentityPages.prototype, 'keyringAddedBeside')
        .mockResolvedValue()
      const check = vi
        .spyOn(manager, 'check_keyring_passkey')
        .mockResolvedValue(report)
      const clear = vi
        .spyOn(manager, 'clear_keyring_passkey_check')
        .mockImplementation(() => {})
      const promptAgain = vi.spyOn(manager, 'add_identity_with_passkey')
      vi.spyOn(manager, 'device_protection_status').mockResolvedValue(
        DeviceProtectionStatus.Unlocked,
      )
      const added = vi
        .spyOn(manager, 'open_keyring_with_checked_passkey')
        .mockResolvedValue(addedFamily)
      vi.spyOn(vault, 'admitManager').mockReturnValue(ok(manager))
      VaultStateTestFixture.runStorageImmediately(vault)
      const keep = vi
        .spyOn(FirstRunActions.prototype, 'connectRecoveredKeyring')
        .mockResolvedValue(true)
      const [whichPasskey] = view.getAllByTestId(
        'provider-identity-find-passkey',
      )
      if (!whichPasskey) throw new Error('no passkey check offered')
      await fireEvent.click(whichPasskey)
      const recover = await vi.waitFor(() => {
        const button = view
          .getAllByTestId('provider-identity-decision')
          .find((each) => each.dataset.decision === 'addToBrowser')
        if (!button) throw new Error('no recovery offered')
        return button
      })
      await fireEvent.click(recover)
      // The one click recovers it: there is no second button to apply it.
      expect(view.queryAllByTestId('remote-vault-choice-apply')).toHaveLength(0)

      // The keyring keeps this provider with its vaults, and the page lands
      // on the keyrings page: no vault is imported, and nothing is listed again.
      switch (selection) {
        case 'inUse':
          await vi.waitFor(() =>
            expect(keep).toHaveBeenCalledExactlyOnceWith(
              ProviderFolderBinding.Named,
            ),
          )
          expect(vault.deviceProtectionReady).toBe(true)
          break
        case 'besideIdentityInUse':
          await vi.waitFor(() =>
            expect(beside).toHaveBeenCalledWith({
              identityId: family.identityId,
              label: 'Family',
            }),
          )
          expect(keep).not.toHaveBeenCalled()
          expect(vault.deviceProtectionReady).toBe(false)
          break
      }
      expect(added).toHaveBeenCalledExactlyOnceWith(
        { kind: 'currentProvider' },
        family.identityId,
      )
      expect(check).toHaveBeenCalledOnce()
      expect(promptAgain).not.toHaveBeenCalled()
      view.unmount()
      await vi.waitFor(() => expect(clear).toHaveBeenCalledOnce())
      expect(onApplied).not.toHaveBeenCalled()
    },
  )

  test('asking to join with no protected key queues the join for the device protection gate', async () => {
    const { view, vault, onApplied } = renderChoice([choice(strangerVault)])
    const ask = view
      .getAllByTestId('provider-identity-decision')
      .find((button) => button.dataset.decision === 'askToJoin')
    if (!ask) throw new Error('no join offered')
    await fireEvent.click(ask)

    await vi.waitFor(() =>
      expect(vault.identityJoin.kind).toBe(IdentityJoinWaitKind.Device),
    )
    expect(view.getByTestId('passkey-auth-overlay')).toBeTruthy()
    // Nothing is recovered yet: the join asks once a key exists.
    expect(onApplied).not.toHaveBeenCalled()
  })

  test.each([
    DeviceProtectionStatus.Unlocked,
    DeviceProtectionStatus.Pin,
    DeviceProtectionStatus.Passkey,
  ] as const)(
    'a known member opens using its existing device protection (%s)',
    async (protection) => {
      const identity = strangerWhoseJoinIs('notAsked')
      if (identity.log.state !== 'read') throw new Error('expected keyring log')
      const member = {
        ...identity,
        log: { ...identity.log, thisBrowser: true },
      }
      const { view, vault } = renderChoice([], [member])
      vault.deviceProtectionStatus = protection
      const run = vi
        .spyOn(IdentityPlanActions.prototype, 'run')
        .mockResolvedValue(ok({ kind: IdentityPlanOutcomeKind.Applied }))
      const keep = vi
        .spyOn(FirstRunActions.prototype, 'connectRecoveredKeyring')
        .mockResolvedValue(true)
      const unlock = () => {
        vault.deviceProtectionStatus = DeviceProtectionStatus.Unlocked
        return Promise.resolve(DeviceProtectionActionOutcome.Ready)
      }
      const pin = vi
        .spyOn(DeviceProtectionActions.prototype, 'unlockPinDeviceProtection')
        .mockImplementation(unlock)
      const passkey = vi
        .spyOn(DeviceProtectionActions.prototype, 'unlockDeviceProtection')
        .mockImplementation(unlock)

      const open = view.getByTestId('provider-identity-decision')
      await fireEvent.click(open)
      if (protection !== DeviceProtectionStatus.Unlocked) {
        expect(run).not.toHaveBeenCalled()
        await fireEvent.click(view.getByTestId('passkey-auth-overlay-dismiss'))
        expect(run).not.toHaveBeenCalled()
        await fireEvent.click(open)
      }
      switch (protection) {
        case DeviceProtectionStatus.Pin:
          await fireEvent.input(
            view.getByTestId('device-protection-pin-unlock-input'),
            { target: { value: '123456' } },
          )
          await fireEvent.click(
            view.getByTestId('device-protection-pin-unlock-btn'),
          )
          expect(pin).toHaveBeenCalledWith({
            pin: '123456',
            initializeSession: false,
          })
          expect(passkey).not.toHaveBeenCalled()
          break
        case DeviceProtectionStatus.Passkey:
          await fireEvent.click(
            view.getByTestId('device-protection-unlock-btn'),
          )
          expect(passkey).toHaveBeenCalledWith({ initializeSession: false })
          break
        case DeviceProtectionStatus.Unlocked:
          expect(view.queryAllByTestId('passkey-auth-overlay')).toHaveLength(0)
          expect(passkey).not.toHaveBeenCalled()
          expect(pin).not.toHaveBeenCalled()
      }
      await vi.waitFor(() =>
        expect(keep).toHaveBeenCalledWith(ProviderFolderBinding.Named),
      )
      expect(run).toHaveBeenCalledOnce()
    },
  )

  test('the log tells a requested, denied, or approved join apart', () => {
    const { view } = renderChoice([
      choice({
        storeId: 'store_othervault1',
        identity: strangerWhoseJoinIs('requested'),
      }),
    ])
    const [requested] = view.getAllByTestId('provider-identity')
    expect(requested?.dataset.standing).toBe('joinRequested')
    expect(decisionsOf(requested)).toEqual([])

    const denied = renderChoice([
      choice({
        storeId: 'store_othervault1',
        identity: strangerWhoseJoinIs('denied'),
      }),
    ])
    const deniedCard = denied.view.getAllByTestId('provider-identity').at(-1)
    expect(deniedCard?.dataset.standing).toBe('joinDenied')
    expect(decisionsOf(deniedCard)).toEqual(['askToJoin'])

    const approved = renderChoice([
      choice({
        storeId: 'store_othervault1',
        identity: strangerWhoseJoinIs('approved'),
      }),
    ])
    const approvedCard = approved.view
      .getAllByTestId('provider-identity')
      .at(-1)
    expect(approvedCard?.dataset.standing).toBe('joinApproved')
    expect(decisionsOf(approvedCard)).toEqual(['finishJoining'])
  })
})
