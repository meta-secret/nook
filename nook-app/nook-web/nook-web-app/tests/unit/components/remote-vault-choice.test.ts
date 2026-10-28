import { fireEvent, render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { err, ok } from 'neverthrow'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type {
  CredentialCheckReport,
  FilingIdentity,
  ProviderVaultSummary,
} from '$app-wasm'
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
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import RemoteVaultChoice from '../../../../nook-web-shared/src/vault-app/lib/components/login/RemoteVaultChoice.svelte'

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

const familyVault: ChoiceRequest = {
  storeId: 'store_familyvaulg',
  identity: family,
}
const strangerVault: ChoiceRequest = {
  storeId: 'store_othervaultg',
  identity: stranger,
}

function decisionsOf(card: HTMLElement | undefined): readonly string[] {
  return Array.from(
    card?.querySelectorAll<HTMLElement>(
      '[data-testid="provider-identity-decision"]',
    ) ?? [],
  ).map((button) => button.dataset.decision ?? '')
}

describe('Recovery choice between identities', () => {
  test('each identity is recovered or joined as a whole, and a found passkey narrows it', async () => {
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
              storeId: familyVault.storeId,
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
              storeId: strangerVault.storeId,
              shortId: 'otherva',
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

    const cards = view.getAllByTestId('provider-identity')
    expect(cards.map((card) => card.dataset.standing)).toEqual([
      'unchecked',
      'unchecked',
    ])
    expect(decisionsOf(cards[0])).toEqual([
      'leave',
      'addToBrowser',
      'askToJoin',
    ])
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
    expect(decisionsOf(strangerCard)).toEqual(['leave', 'askToJoin'])
    // Nothing is picked yet, so there is nothing to apply.
    expect(view.queryAllByTestId('remote-vault-choice-apply')).toHaveLength(0)
  })

  test('Apply runs the plan against the recovery provider, then opens what it recovered', async () => {
    const run = vi
      .spyOn(IdentityPlanActions.prototype, 'run')
      .mockResolvedValue(ok(IdentityPlanOutcome.Applied))
    const { view, vault, onApplied } = renderChoice([choice(familyVault)])

    await fireEvent.click(await DecisionButtons.of(view, 'addToBrowser'))
    expect(
      view.getByTestId('provider-identity-plan-row').textContent,
    ).toContain(vault.t(I18N_KEYS.ProviderIdentitiesRecover))
    await fireEvent.click(view.getByTestId('remote-vault-choice-apply'))

    await vi.waitFor(() => expect(onApplied).toHaveBeenCalledOnce())
    const [request] = run.mock.calls[0] ?? []
    expect(request?.source).toEqual({ kind: 'currentProvider' })
    expect(request?.planned.map((entry) => entry.decision)).toEqual([
      'addToBrowser',
    ])
  })

  test('a decision that fails says so and opens nothing', async () => {
    vi.spyOn(IdentityPlanActions.prototype, 'run').mockResolvedValue(
      err(new IdentityPlanFailure(IdentityPlanFailureKind.Add)),
    )
    const { view, vault, onApplied } = renderChoice([choice(familyVault)])

    await fireEvent.click(await DecisionButtons.of(view, 'addToBrowser'))
    await fireEvent.click(view.getByTestId('remote-vault-choice-apply'))

    await vi.waitFor(() =>
      expect(vault.errorMsg).toBe(
        vault.t(I18N_KEYS.ProviderIdentitiesAddFailed),
      ),
    )
    expect(onApplied).not.toHaveBeenCalled()
  })
})
