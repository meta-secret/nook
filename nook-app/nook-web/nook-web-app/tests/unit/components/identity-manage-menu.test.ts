import { render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import IdentityManageMenu from '../../../../nook-web-shared/src/vault-app/lib/components/identities/IdentityManageMenu.svelte'

afterEach(() => vi.restoreAllMocks())

describe('identity manage menu', () => {
  test('leads with a sync provider and holds adding a device until one exists', () => {
    const vault = VaultStateTestFixture.create()
    vault.providers = []
    vault.providersLoaded = true
    const props = {
      vault,
      onSelect: vi.fn(),
    } satisfies ComponentProps<typeof IdentityManageMenu>
    const view = render(IdentityManageMenu, props)

    const items = view.getAllByRole('menuitem')
    expect(items.map((item) => item.dataset.testid)).toEqual([
      'identity-menu-sync',
      'identity-menu-add-device',
      'identity-menu-vaults',
    ])
    expect(
      view.getByTestId('identity-menu-add-device').hasAttribute('disabled'),
    ).toBe(true)
  })

  test('keeps adding a device first while the providers are still loading', () => {
    const vault = VaultStateTestFixture.create()
    vault.providersLoaded = false
    const props = {
      vault,
      onSelect: vi.fn(),
    } satisfies ComponentProps<typeof IdentityManageMenu>
    const view = render(IdentityManageMenu, props)

    expect(view.getAllByRole('menuitem')[0]?.dataset.testid).toBe(
      'identity-menu-add-device',
    )
    expect(
      view.getByTestId('identity-menu-add-device').hasAttribute('disabled'),
    ).toBe(false)
  })
})
