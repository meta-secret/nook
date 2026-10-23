import { fireEvent, render } from '@testing-library/svelte'
import { flushSync, type ComponentProps } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import {
  DeviceProtectionStatus,
  type NookPasswordEntrySummary,
} from '$app-wasm'
import { DeviceRecoveryKind } from '$lib/components/device-recovery'
import type { VaultState } from '$lib/vault.svelte'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import VaultPanel from '../../../../nook-web-shared/src/vault-app/lib/components/identities/VaultPanel.svelte'
import {
  IdentityVaultRowState,
  type IdentityVaultRow,
} from '../../../../nook-web-shared/src/vault-app/lib/components/identities/identity-card-model'

type PanelOptions = {
  readonly state: IdentityVaultRowState
  readonly onDelete?: () => Promise<void>
  /** Passphrase labels the session holds for the vault. */
  readonly passphrases?: readonly string[]
}

function passphraseEntry(label: string): NookPasswordEntrySummary {
  return {
    id: `password_${label}`,
    label,
    createdAt: '2026-10-15T00:00:00Z',
    free: vi.fn(),
    [Symbol.dispose]: vi.fn(),
  } satisfies NookPasswordEntrySummary
}

class VaultPanelScenario {
  static render(options: PanelOptions) {
    const vault = VaultStateTestFixture.create()
    return { vault, view: this.renderWith({ vault, options }) }
  }

  static setPassphrases({
    vault,
    labels,
  }: {
    readonly vault: VaultState
    readonly labels: readonly string[]
  }): void {
    vault.passwordEntries = labels.map(passphraseEntry)
  }

  private static renderWith({
    vault,
    options,
  }: {
    readonly vault: VaultState
    readonly options: PanelOptions
  }) {
    const { state } = options
    vi.spyOn(vault, 't').mockImplementation((request) =>
      typeof request === 'string'
        ? request
        : `${request.key}${request.replacements?.count ? `:${request.replacements.count}` : ''}`,
    )
    const [labels = []] = [options.passphrases]
    this.setPassphrases({ vault, labels })
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
    const { view } = VaultPanelScenario.render(panelOptions)

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
    const { view } = VaultPanelScenario.render(panelOptions)

    expect(view.getByTestId('vault-panel-away')).toBeTruthy()
    expect(view.queryAllByTestId('vault-panel-delete')).toHaveLength(0)
  })

  test('keeps the unlock path for a vault stored here', () => {
    const panelOptions: PanelOptions = {
      state: IdentityVaultRowState.Available,
    }
    const { view } = VaultPanelScenario.render(panelOptions)

    expect(view.getByTestId('vault-panel-unlock')).toBeTruthy()
    expect(view.queryAllByTestId('vault-panel-away')).toHaveLength(0)
  })

  test('names the open vault passphrases and follows changes to them', () => {
    const panelOptions: PanelOptions = {
      state: IdentityVaultRowState.Open,
      passphrases: [],
    }
    const { vault, view } = VaultPanelScenario.render(panelOptions)
    const hint = () =>
      view.getByTestId('vault-panel-passphrases-hint').textContent
    const count = () =>
      view.getByTestId('vault-panel-passphrases-count').textContent

    expect(hint()).toBe(I18N_KEYS.WorkspaceVaultPanelPassphrasesNone)
    expect(count()).toBe('0')

    // Adding one on the Passphrases page updates the session's list; the
    // panel shows it without being reopened.
    VaultPanelScenario.setPassphrases({ vault, labels: ['Paper copy'] })
    flushSync()
    expect(hint()).toBe('Paper copy')
    expect(count()).toBe('1')

    VaultPanelScenario.setPassphrases({
      vault,
      labels: ['Paper copy', 'Office safe', 'Spouse', 'Lawyer'],
    })
    flushSync()
    expect(hint()).toBe(
      `Paper copy, Office safe ${I18N_KEYS.IdentityOverviewMore}:2`,
    )
    expect(count()).toBe('4')
  })

  test('shows a failed passkey unlock and its recovery beside the unlock button', () => {
    const panelOptions: PanelOptions = {
      state: IdentityVaultRowState.Available,
    }
    const { vault, view } = VaultPanelScenario.render(panelOptions)
    vault.deviceProtectionStatus = DeviceProtectionStatus.Passkey
    flushSync()

    expect(view.queryAllByTestId('vault-panel-unlock-error')).toHaveLength(0)
    expect(view.queryAllByTestId('device-recovery')).toHaveLength(0)

    vault.errorMsg = 'Passkey cancelled'
    flushSync()

    expect(view.getByTestId('vault-panel-unlock-error').textContent).toContain(
      'Passkey cancelled',
    )
    expect(view.getByTestId('device-recovery').dataset.kind).toBe(
      DeviceRecoveryKind.Passkey,
    )
    expect(view.getByTestId('device-protection-recovery-btn')).toBeTruthy()
  })

  test('offers a reset at once when this browser cannot read its key', () => {
    const panelOptions: PanelOptions = {
      state: IdentityVaultRowState.Available,
    }
    const { vault, view } = VaultPanelScenario.render(panelOptions)
    vault.deviceProtectionStatus = DeviceProtectionStatus.Error
    flushSync()

    expect(view.getByTestId('device-recovery').dataset.kind).toBe(
      DeviceRecoveryKind.Unavailable,
    )
  })

  test('offers no recovery for an open vault', () => {
    const panelOptions: PanelOptions = {
      state: IdentityVaultRowState.Open,
    }
    const { vault, view } = VaultPanelScenario.render(panelOptions)
    vault.deviceProtectionStatus = DeviceProtectionStatus.Error
    vault.errorMsg = 'Sync failed'
    flushSync()

    expect(view.queryAllByTestId('device-recovery')).toHaveLength(0)
    expect(view.queryAllByTestId('vault-panel-unlock-error')).toHaveLength(0)
  })

  test('keeps a locked vault passphrases out of its manage list', () => {
    const panelOptions: PanelOptions = {
      state: IdentityVaultRowState.Available,
      passphrases: ['Paper copy'],
    }
    const { view } = VaultPanelScenario.render(panelOptions)

    expect(view.getByTestId('vault-panel-passphrases-hint').textContent).toBe(
      I18N_KEYS.WorkspaceVaultPanelPassphrasesHint,
    )
    expect(view.queryAllByTestId('vault-panel-passphrases-count')).toHaveLength(
      0,
    )
  })

  test('shows access being set up, with progress, until the vault is open', () => {
    const panelOptions: PanelOptions = {
      state: IdentityVaultRowState.Available,
    }
    const { vault, view } = VaultPanelScenario.render(panelOptions)
    const panel = () => view.getByTestId('vault-panel-beside').textContent

    expect(view.queryAllByTestId('vault-panel-getting-access')).toHaveLength(0)
    expect(panel()).toContain(I18N_KEYS.WorkspaceStatusLocked)

    // Getting access to a large vault takes seconds: the panel says so.
    vault.isVerifying = true
    flushSync()
    const progress = view.getByTestId('vault-panel-getting-access')
    expect(progress.getAttribute('role')).toBe('status')
    expect(progress.textContent).toContain(
      I18N_KEYS.WorkspaceVaultPanelGettingAccess,
    )
    expect(panel()).toContain(I18N_KEYS.WorkspaceVaultGettingAccess)

    // A failed attempt ends the progress and leaves the unlock in place.
    vault.isVerifying = false
    flushSync()
    expect(view.queryAllByTestId('vault-panel-getting-access')).toHaveLength(0)
    expect(view.getByTestId('vault-panel-unlock')).toBeTruthy()
  })
})
