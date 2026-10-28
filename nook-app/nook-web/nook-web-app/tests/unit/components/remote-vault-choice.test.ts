import { fireEvent, render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { ok } from 'neverthrow'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import initNookWasm, {
  type CredentialCheckReport,
  type FilingIdentity,
  type ProviderIdentityJoin,
  type ProviderVaultSummary,
} from '$app-wasm'
import {
  AccessCheckActions,
  AccessCheckTargetKind,
} from '$lib/vault/access-check'
import { IdentityJoinWaitKind } from '$lib/vault/identity-join-wait'
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
    actions: ['importSeparately'],
  }
}

function renderChoice(vaults: ProviderVaultSummary[]) {
  const vault = VaultStateTestFixture.create()
  vault.remoteVaultChoices = vaults
  const onApplied = vi.fn()
  const props = { vault, busy: false, onApplied } satisfies ComponentProps<
    typeof RemoteVaultChoice
  >
  return { view: render(RemoteVaultChoice, props), vault, onApplied }
}

function decisionsOf(card: HTMLElement | undefined): (string | undefined)[] {
  return [
    ...(card?.querySelectorAll('[data-testid="provider-identity-decision"]') ??
      []),
  ]
    .filter((button) => button instanceof HTMLElement)
    .map((button) => button.dataset.decision)
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
      credential: { kind: 'passkey', fingerprint: 'passkey_a1b2c3d4e5f60708' },
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
      .spyOn(AccessCheckActions.prototype, 'checkPasskey')
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
      kind: AccessCheckTargetKind.CurrentProvider,
    })
    const [familyCard, strangerCard] = view.getAllByTestId('provider-identity')
    expect(familyCard?.textContent).toContain('Family')
    expect(familyCard?.textContent).toContain('Groceries')
    expect(decisionsOf(familyCard)).toEqual(['leave', 'addToBrowser'])
    // The identity no passkey opened can only be asked to let this browser in.
    expect(decisionsOf(strangerCard)).toEqual(['leave', 'askToJoin'])
  })

  test('asking to join with no protected key queues the join for the device protection gate', async () => {
    const { view, vault, onApplied } = renderChoice([choice(strangerVault)])
    const ask = view
      .getAllByTestId('provider-identity-decision')
      .find((button) => button.dataset.decision === 'askToJoin')
    if (!ask) throw new Error('no join offered')
    await fireEvent.click(ask)
    await fireEvent.click(view.getByTestId('remote-vault-choice-apply'))

    await vi.waitFor(() =>
      expect(vault.identityJoin.kind).toBe(IdentityJoinWaitKind.Device),
    )
    expect(view.getByTestId('passkey-auth-overlay')).toBeTruthy()
    // Nothing is recovered yet: the join asks once a key exists.
    expect(onApplied).not.toHaveBeenCalled()
  })

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
    expect(decisionsOf(deniedCard)).toEqual(['leave', 'askToJoin'])

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
    expect(decisionsOf(approvedCard)).toEqual(['leave', 'finishJoining'])
  })
})
