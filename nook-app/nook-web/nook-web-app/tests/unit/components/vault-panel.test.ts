import { fireEvent, render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import VaultPanel from '../../../../nook-web-shared/src/vault-app/lib/components/identities/VaultPanel.svelte'
import {
  IdentityVaultRowState,
  type IdentityVaultRow,
} from '../../../../nook-web-shared/src/vault-app/lib/components/identities/identity-card-model'

type PanelOptions = {
  readonly state: IdentityVaultRowState
  readonly onDelete?: () => Promise<void>
}

class VaultPanelScenario {
  static render(options: PanelOptions) {
    const { state } = options
    const vault = VaultStateTestFixture.create()
    vi.spyOn(vault, 't').mockImplementation((request) =>
      typeof request === 'string' ? request : request.key,
    )
    const row: IdentityVaultRow = {
      storeId: 'store_awayvault01',
      label: 'Travel',
      state,
    }
    const props = {
      vault,
      row,
      identityName: 'Personal',
      unlockLabel: 'Unlock with passkey',
      onOpen: vi.fn(),
      onUnlock: vi.fn(),
      onUseIdentity: vi.fn(),
      onManage: vi.fn(),
      onClose: vi.fn(),
      ...(options.onDelete ? { onDelete: options.onDelete } : {}),
    } satisfies ComponentProps<typeof VaultPanel>
    return render(VaultPanel, props)
  }
}

describe('vault panel', () => {
  test('deletes a vault this browser does not hold only after its name is typed', async () => {
    const onDelete = vi.fn(async () => {})
    const panelOptions: PanelOptions = {
      state: IdentityVaultRowState.Unavailable,
      onDelete,
    }
    const view = VaultPanelScenario.render(panelOptions)

    expect(view.getByTestId('vault-panel-away')).toBeTruthy()
    expect(view.queryAllByTestId('vault-panel-unlock')).toHaveLength(0)
    expect(view.queryAllByTestId('vault-panel-manage')).toHaveLength(0)

    await fireEvent.click(view.getByTestId('vault-panel-delete'))
    const confirm = view.getByTestId('vault-panel-delete-confirm')
    expect(confirm.hasAttribute('disabled')).toBe(true)

    await fireEvent.input(view.getByTestId('vault-panel-delete-name'), {
      target: { value: 'Travel' },
    })
    expect(confirm.hasAttribute('disabled')).toBe(false)
    await fireEvent.click(confirm)
    expect(onDelete).toHaveBeenCalledOnce()
  })

  test('offers no deletion while the identity cannot sign it', () => {
    const panelOptions: PanelOptions = {
      state: IdentityVaultRowState.Unavailable,
    }
    const view = VaultPanelScenario.render(panelOptions)

    expect(view.getByTestId('vault-panel-away')).toBeTruthy()
    expect(view.queryAllByTestId('vault-panel-delete')).toHaveLength(0)
  })

  test('keeps the unlock path for a vault stored here', () => {
    const panelOptions: PanelOptions = {
      state: IdentityVaultRowState.Available,
    }
    const view = VaultPanelScenario.render(panelOptions)

    expect(view.getByTestId('vault-panel-unlock')).toBeTruthy()
    expect(view.queryAllByTestId('vault-panel-away')).toHaveLength(0)
  })
})
