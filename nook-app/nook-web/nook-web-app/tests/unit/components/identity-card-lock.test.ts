import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/svelte'
import { tick, type ComponentProps } from 'svelte'
import IdentityCard from '$lib/components/identities/IdentityCard.svelte'
import {
  IdentityCardStatus,
  IdentityKeyKind,
  IdentityVaultRowState,
  type IdentityCardView,
} from '$lib/components/identities/identity-card-model'
import { PairedIdentityUnlockScope } from '$lib/app/extension-identity-adoption'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

function card(status: IdentityCardStatus): IdentityCardView {
  const view: IdentityCardView = {
    identityId: 'identity-personal',
    label: 'Personal',
    monogram: 'P',
    hue: 285,
    fingerprint: [],
    keyCount: 1,
    keyKind: IdentityKeyKind.Passkey,
    status,
    current: true,
    vaults: [
      {
        storeId: 'store-qwe',
        label: 'qwe',
        state: IdentityVaultRowState.Available,
      },
    ],
  }
  return view
}

function renderCard(status: IdentityCardStatus, preview = false) {
  const props: ComponentProps<typeof IdentityCard> = {
    vault: VaultStateTestFixture.create(),
    card: card(status),
    preview,
    onOpenVault: () => {},
  }
  return render(IdentityCard, props)
}

describe('identity card on lock', () => {
  test.each([IdentityCardStatus.Locked, IdentityCardStatus.Elsewhere])(
    'folds its unlocked-only panels away and keeps the vaults (%s)',
    (status) => {
      const view = renderCard(status)

      expect(view.queryByTestId('identity-card-fold')).toBeTruthy()
      expect(view.getByTestId('identity-vault-row').textContent).toContain(
        'qwe',
      )
    },
  )

  test('an unlocked card has nothing to fold', () => {
    const view = renderCard(IdentityCardStatus.Unlocked)

    expect(view.queryByTestId('identity-card-fold')).not.toBeTruthy()
  })

  test('the first-run preview stays still', () => {
    const view = renderCard(IdentityCardStatus.Locked, true)

    expect(view.queryByTestId('identity-card-fold')).not.toBeTruthy()
  })
})

describe('identity card rows that need the unlocked identity', () => {
  function renderCurrent(status: IdentityCardStatus) {
    const props: ComponentProps<typeof IdentityCard> = {
      vault: VaultStateTestFixture.create(),
      card: card(status),
      canAddVault: true,
      onOpenVault: () => {},
      onManageSection: () => {},
    }
    return render(IdentityCard, props)
  }

  test('a locked card keeps only its header and vaults', () => {
    const view = renderCurrent(IdentityCardStatus.Locked)

    expect(view.queryByTestId('identity-overview-toggle')).not.toBeTruthy()
    expect(view.queryByTestId('identity-new-vault')).not.toBeTruthy()
    expect(view.getByTestId('identity-vault-row')).toBeTruthy()
  })

  test('an unlocked card offers one Identity panel and New vault', () => {
    const view = renderCurrent(IdentityCardStatus.Unlocked)

    expect(view.getByTestId('identity-overview-toggle')).toBeTruthy()
    // Overview and Manage are one panel now: no separate menu row.
    expect(view.queryAllByTestId('identity-manage')).toHaveLength(0)
    expect(view.getByTestId('identity-new-vault')).toBeTruthy()
  })
})

describe('vault panel beside the identity card', () => {
  function renderCard(status: IdentityCardStatus) {
    const vault = VaultStateTestFixture.create()
    const onSelectVault = vi.fn()
    const onUnlockVault = vi.fn()
    const props: ComponentProps<typeof IdentityCard> = {
      vault,
      card: card(status),
      onOpenVault: () => {},
      onSelectVault,
      onUnlockVault,
    }
    const view = render(IdentityCard, props)
    return { vault, view, onSelectVault, onUnlockVault }
  }

  test('an unlocked identity opens a vault in place as its panel opens: no Open vault step', async () => {
    const { vault, view, onSelectVault, onUnlockVault } = renderCard(
      IdentityCardStatus.Unlocked,
    )

    await fireEvent.click(view.getByTestId('identity-vault-row'))

    expect(vault.vaultPanelStoreId).toBe('store-qwe')
    expect(onUnlockVault).toHaveBeenCalledExactlyOnceWith('store-qwe')
    expect(onSelectVault).not.toHaveBeenCalled()
    expect(view.queryByTestId('vault-panel-unlock')).not.toBeTruthy()
  })

  test('Unlock on the card with a vault panel open opens that vault once the identity is unlocked', async () => {
    const vault = VaultStateTestFixture.create()
    vault.vaultPanelStoreId = 'store-qwe'
    const onUnlockVault = vi.fn()
    const props: ComponentProps<typeof IdentityCard> = {
      vault,
      card: card(IdentityCardStatus.Locked),
      onOpenVault: () => {},
      onUnlockVault,
      onUnlock: async () => {
        // The identity unlocks before Unlock settles.
        await view.rerender({ card: card(IdentityCardStatus.Unlocked) })
      },
    }
    const view = render(IdentityCard, props)

    await fireEvent.click(view.getByTestId('identity-unlock'))
    await tick()

    expect(onUnlockVault).toHaveBeenCalledExactlyOnceWith('store-qwe')
  })

  test('an identity unlocked by anything else opens no extra vault', async () => {
    const { vault, view, onUnlockVault } = renderCard(IdentityCardStatus.Locked)
    vault.vaultPanelStoreId = 'store-qwe'
    await tick()

    await view.rerender({ card: card(IdentityCardStatus.Unlocked) })

    expect(onUnlockVault).not.toHaveBeenCalled()
  })

  test('a locked identity selects the vault and asks for its key in the panel', async () => {
    const { view, onSelectVault, onUnlockVault } = renderCard(
      IdentityCardStatus.Locked,
    )

    await fireEvent.click(view.getByTestId('identity-vault-row'))

    expect(onSelectVault).toHaveBeenCalledExactlyOnceWith('store-qwe')
    expect(onUnlockVault).not.toHaveBeenCalled()
    await fireEvent.click(view.getByTestId('vault-panel-unlock'))
    expect(onUnlockVault).toHaveBeenCalledExactlyOnceWith('store-qwe')
  })
})

describe('identity card unlock', () => {
  function renderLocked(status: IdentityCardStatus, selectedStoreId: string) {
    const onUnlock = vi.fn()
    const onUnlockElsewhere = vi.fn()
    const onUseIdentity = vi.fn()
    const props: ComponentProps<typeof IdentityCard> = {
      vault: VaultStateTestFixture.create(),
      card: card(status),
      selectedStoreId,
      onOpenVault: () => {},
      onUnlock,
      onUnlockElsewhere,
      onUseIdentity,
    }
    return {
      view: render(IdentityCard, props),
      onUnlock,
      onUnlockElsewhere,
      onUseIdentity,
    }
  }

  test('a card keyed on this browser unlocks the identity with its key', async () => {
    const { view, onUnlock, onUnlockElsewhere } = renderLocked(
      IdentityCardStatus.Locked,
      'store-qwe',
    )

    await fireEvent.click(view.getByTestId('identity-unlock'))

    expect(onUnlock).toHaveBeenCalledWith('identity-personal')
    expect(onUnlockElsewhere).not.toHaveBeenCalled()
  })

  test('a card keyed in the paired extension unlocks only its identity there', async () => {
    const { view, onUnlock, onUnlockElsewhere } = renderLocked(
      IdentityCardStatus.Elsewhere,
      'store-qwe',
    )

    await fireEvent.click(view.getByTestId('identity-unlock'))

    expect(onUnlockElsewhere).toHaveBeenCalledOnce()
    expect(onUnlock).not.toHaveBeenCalled()
  })

  test('an identity of another installation not in use here is used through the extension, leaving the one in use', async () => {
    const onUseIdentity = vi.fn()
    const onUnlockElsewhere = vi.fn()
    const dormant: IdentityCardView = {
      ...card(IdentityCardStatus.Elsewhere),
      current: false,
      vaults: [
        {
          storeId: 'store-qwe',
          label: 'qwe',
          state: IdentityVaultRowState.Dormant,
        },
      ],
    }
    const props: ComponentProps<typeof IdentityCard> = {
      vault: VaultStateTestFixture.create(),
      card: dormant,
      selectedStoreId: '',
      onOpenVault: () => {},
      onUnlockElsewhere,
      onUseIdentity,
    }
    const view = render(IdentityCard, props)

    // Its key is not on this browser, so switching to it locally cannot
    // work: the paired extension hands it over for its own vault.
    expect(view.queryByTestId('identity-unlock')).not.toBeTruthy()
    await fireEvent.click(view.getByTestId('identity-use'))
    expect(onUseIdentity).not.toHaveBeenCalled()
    expect(onUnlockElsewhere).toHaveBeenCalledWith({
      scope: PairedIdentityUnlockScope.CardVault,
      storeId: 'store-qwe',
      leavesCurrentIdentity: true,
    })
  })

  test('with no identity in use, an identity of another installation unlocks for its own vault even with none selected', async () => {
    const { view, onUnlockElsewhere } = renderLocked(
      IdentityCardStatus.Elsewhere,
      '',
    )

    await fireEvent.click(view.getByTestId('identity-unlock'))
    expect(onUnlockElsewhere).toHaveBeenCalledWith({
      scope: PairedIdentityUnlockScope.CardVault,
      storeId: 'store-qwe',
      leavesCurrentIdentity: false,
    })
  })
})

describe('identity card width beside a vault panel', () => {
  test('spreads across its row while a vault panel is open beside it', async () => {
    const view = renderCard(IdentityCardStatus.Unlocked)
    const article = view.getByTestId('identity-card')
    expect(article.dataset.spread).toBe('false')

    await fireEvent.click(view.getByTestId('identity-vault-row'))
    await tick()
    expect(article.dataset.spread).toBe('true')

    await fireEvent.click(view.getByTestId('identity-vault-row'))
    await tick()
    expect(article.dataset.spread).toBe('false')
  })
})
