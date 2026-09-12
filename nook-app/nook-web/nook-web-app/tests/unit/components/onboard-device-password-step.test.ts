import { err } from 'neverthrow'
import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/svelte'
import OnboardDevicePasswordStep from '$lib/components/onboard-device/OnboardDevicePasswordStep.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'

describe('onboard device password step', () => {
  test('retains entered credentials when password creation fails', async () => {
    const onAddPassword = vi.fn(async () =>
      err(new VaultStorageFailure(VaultStorageFailureKind.OperationFailed)),
    )
    const vault = VaultStateTestFixture.create()
    vi.spyOn(vault, 't').mockImplementation((request) =>
      typeof request === 'string' ? request : request.key,
    )
    const view = render(OnboardDevicePasswordStep, {
      vault,
      passwordEntries: [],
      effectivePasswordEntryId: '',
      subtitle: 'Protect this vault',
      isBusy: false,
      isGenerating: false,
      passwordError: 'Password creation failed',
      open: true,
      onAddPassword,
      onSelectPasswordEntry: vi.fn(),
    })
    const label = view.getByTestId('vault-password-label')
    const password = view.getByTestId('vault-password-input')
    const confirmation = view.getByTestId('vault-password-confirm')
    if (!(label instanceof HTMLInputElement))
      expect.fail('password label must be an input')
    if (!(password instanceof HTMLInputElement))
      expect.fail('password must be an input')
    if (!(confirmation instanceof HTMLInputElement))
      expect.fail('password confirmation must be an input')
    await fireEvent.input(label, { target: { value: 'Recovery' } })
    await fireEvent.input(password, {
      target: { value: 'long-enough-recovery-password' },
    })
    await fireEvent.input(confirmation, {
      target: { value: 'long-enough-recovery-password' },
    })
    await fireEvent.click(view.getByTestId('submit-vault-password'))
    await waitFor(() => expect(onAddPassword).toHaveBeenCalledOnce())

    expect(label.value).toBe('Recovery')
    expect(password.value).toBe('long-enough-recovery-password')
    expect(confirmation.value).toBe('long-enough-recovery-password')
  })
})
