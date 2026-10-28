import { fireEvent, render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { ok } from 'neverthrow'
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
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import RemoteVaultChoice from '../../../../nook-web-shared/src/vault-app/lib/components/login/RemoteVaultChoice.svelte'

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
  const onChoose = vi.fn()
  const props = { vault, busy: false, onChoose } satisfies ComponentProps<
    typeof RemoteVaultChoice
  >
  return { view: render(RemoteVaultChoice, props), vault, onChoose }
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
    const { view, vault, onChoose } = renderChoice([
      choice(familyVault),
      choice(strangerVault),
    ])

    expect(view.getAllByTestId('provider-identity')).toHaveLength(2)
    expect(
      view
        .getAllByTestId('provider-identity')
        .map((card) => card.dataset.standing),
    ).toEqual(['unchecked', 'unchecked'])
    // Each identity is recovered once, whatever number of vaults it files.
    expect(view.getAllByTestId('remote-vault-choice-item')).toHaveLength(2)
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
    const [familyCard] = view.getAllByTestId('provider-identity')
    expect(familyCard?.textContent).toContain('Family')
    expect(familyCard?.textContent).toContain('Groceries')
    // The identity no passkey opened offers its hunt and a join instead.
    expect(view.getAllByTestId('provider-identity-ask-to-join')).toHaveLength(1)
    const [recover] = view.getAllByTestId('remote-vault-choice-item')
    expect(view.getAllByTestId('remote-vault-choice-item')).toHaveLength(1)
    expect(recover?.textContent).toContain(
      vault.t(I18N_KEYS.AccessCheckRecoverWithPasskey),
    )
    if (!recover) throw new Error('no recovery offered')
    await fireEvent.click(recover)
    expect(onChoose).toHaveBeenCalledWith('store_familyvault')
  })

  test('asking to join an identity this browser has no key for explains the join code', async () => {
    const locked: ProviderVaultSummary = {
      ...choice(strangerVault),
      actions: [],
    }
    const { view } = renderChoice([locked])

    await fireEvent.click(view.getByTestId('provider-identity-ask-to-join'))

    expect(view.getByTestId('provider-identity-join-help')).toBeTruthy()
  })
})
