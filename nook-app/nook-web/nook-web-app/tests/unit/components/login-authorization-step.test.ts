import { fireEvent, render, waitFor } from '@testing-library/svelte'
import { describe, expect, test, vi } from 'vitest'
import type { NookPasswordEntrySummary } from '$app-wasm'
import LoginAuthorizationStep from '$lib/components/login/LoginAuthorizationStep.svelte'
import {
  DeviceKeysUnlockCapabilityKind,
  PasswordUnlockCapabilityKind,
  type DeviceKeysUnlockCapability,
} from '$lib/components/login/login-unlock-state'
import type { VaultState } from '$lib/vault.svelte'
import {
  PasswordEntrySelectionKind,
  type PasswordEntrySelection,
} from '$lib/vault/state/session.svelte'

const vault = {
  t(key: string): string {
    return key
  },
} as unknown as VaultState

const passwordEntry = {
  id: 'password_backup',
  label: 'Backup',
  createdAt: 1,
} as unknown as NookPasswordEntrySummary

const selectedPasswordEntry: PasswordEntrySelection = {
  kind: PasswordEntrySelectionKind.NotSelected,
}

function authorizationProps(deviceKeysUnlock: DeviceKeysUnlockCapability) {
  return {
    vault,
    passwordEntries: [passwordEntry],
    selectedPasswordEntry,
    isVerifying: false,
    isInitializing: false,
    isUnlocking: false,
    loginPasswordPrompt: false,
    deviceKeysUnlock,
    onUnlock: vi.fn(),
    passwordUnlock: {
      kind: PasswordUnlockCapabilityKind.Available,
      unlock: vi.fn(),
    },
    onSelectPasswordEntry: vi.fn(),
    onConsumeLoginPasswordPrompt: vi.fn(),
  }
}

describe('LoginAuthorizationStep device-key capability transitions', () => {
  test('keeps keys selected but non-submittable while loading, then enables them', async () => {
    const view = render(
      LoginAuthorizationStep,
      authorizationProps({ kind: DeviceKeysUnlockCapabilityKind.Unknown }),
    )
    const keys = view.getByTestId(
      'login-unlock-method-keys',
    ) as HTMLButtonElement
    const submit = view.getByTestId('unlock-vault-btn') as HTMLButtonElement

    expect(keys.getAttribute('aria-checked')).toBe('true')
    expect(keys.disabled).toBe(true)
    expect(submit.disabled).toBe(true)

    await view.rerender(
      authorizationProps({ kind: DeviceKeysUnlockCapabilityKind.Available }),
    )

    await waitFor(() => {
      expect(keys.getAttribute('aria-checked')).toBe('true')
      expect(keys.disabled).toBe(false)
      expect(submit.disabled).toBe(false)
    })
  })

  test('falls back to backup password only when device keys are unavailable', async () => {
    const view = render(
      LoginAuthorizationStep,
      authorizationProps({ kind: DeviceKeysUnlockCapabilityKind.Unknown }),
    )

    await view.rerender(
      authorizationProps({
        kind: DeviceKeysUnlockCapabilityKind.Unavailable,
        reason: 'Unavailable for this vault',
      }),
    )

    await waitFor(() => {
      expect(
        view
          .getByTestId('login-unlock-method-password')
          .getAttribute('aria-checked'),
      ).toBe('true')
    })
  })

  test('does not override an explicit backup-password selection when keys resolve', async () => {
    const view = render(
      LoginAuthorizationStep,
      authorizationProps({ kind: DeviceKeysUnlockCapabilityKind.Unknown }),
    )
    const password = view.getByTestId('login-unlock-method-password')

    await fireEvent.click(password)
    expect(password.getAttribute('aria-checked')).toBe('true')

    await view.rerender(
      authorizationProps({ kind: DeviceKeysUnlockCapabilityKind.Available }),
    )

    await waitFor(() => {
      expect(password.getAttribute('aria-checked')).toBe('true')
    })
  })
})
