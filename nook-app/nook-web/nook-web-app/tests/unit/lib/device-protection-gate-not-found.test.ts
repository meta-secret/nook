import { afterEach, describe, expect, test, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/svelte'
import { tick, type ComponentProps } from 'svelte'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { DeviceProtectionStatus } from '$app-wasm'
import DeviceProtectionGate from '$lib/components/DeviceProtectionGate.svelte'
import { DeviceProtectionGateFrame } from '$lib/components/device-protection-gate-state'
import type { VaultState } from '$lib/vault.svelte'
import {
  DeviceProtectionActionOutcome,
  DeviceProtectionActions,
} from '$lib/vault/device-protection.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

/** The browser closed its passkey picker without returning a passkey. */
function lookupEndsWithoutPasskey(vault: VaultState) {
  return vi
    .spyOn(
      DeviceProtectionActions.prototype,
      'recoverDeviceProtectionWithPasskey',
    )
    .mockImplementation(async () => {
      vault.errorMsg = I18N_KEYS.DeviceProtectionPasskeyRecoveryNotAllowed
      return DeviceProtectionActionOutcome.PasskeyNotAllowed
    })
}

function renderSetupGate(vault: VaultState) {
  const props: ComponentProps<typeof DeviceProtectionGate> = {
    vault,
    frame: DeviceProtectionGateFrame.Embedded,
    creationOnly: false,
    initializeSession: true,
    recoveryAppId: '',
    onBeforeProtectionAction: vi.fn(),
    onProtectionReady: vi.fn(),
  }
  return render(DeviceProtectionGate, props)
}

function setupVault(): VaultState {
  const vault = VaultStateTestFixture.create()
  vault.deviceProtectionStatus = DeviceProtectionStatus.Missing
  vi.spyOn(vault, 't').mockImplementation((request) =>
    typeof request === 'string' ? request : request.key,
  )
  return vault
}

async function settle(): Promise<void> {
  await Promise.resolve()
  await tick()
}

describe('device protection gate when no passkey is found', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('offers creating a passkey instead of an error', async () => {
    const vault = setupVault()
    lookupEndsWithoutPasskey(vault)
    const gate = renderSetupGate(vault)

    await fireEvent.click(
      gate.getByTestId('device-protection-use-existing-choice'),
    )
    await settle()

    expect(
      gate.getByTestId('device-protection-not-found-workflow'),
    ).toBeTruthy()
    expect(gate.getByRole('alert').textContent).toContain(
      I18N_KEYS.DeviceProtectionNotFoundTitle,
    )
    expect(vault.errorMsg).toBe('')
    const create = gate.getByTestId('device-protection-create-new-choice')
    expect(create.textContent).toContain(
      I18N_KEYS.DeviceProtectionNewPasskeyAlternativeAction,
    )
    expect(
      gate.getByTestId('device-protection-next-step').textContent,
    ).toContain(I18N_KEYS.DeviceProtectionNextStep)
    expect(document.activeElement).toBe(create)
  })

  test('says why when looking again still finds no passkey', async () => {
    const vault = setupVault()
    const lookup = lookupEndsWithoutPasskey(vault)
    const gate = renderSetupGate(vault)

    await fireEvent.click(
      gate.getByTestId('device-protection-use-existing-choice'),
    )
    await settle()
    await fireEvent.click(
      gate.getByTestId('device-protection-use-existing-choice'),
    )
    await settle()

    expect(lookup).toHaveBeenCalledTimes(2)
    expect(
      gate.getByTestId('device-protection-not-found-workflow'),
    ).toBeTruthy()
    expect(vault.errorMsg).toBe(
      I18N_KEYS.DeviceProtectionPasskeyRecoveryNotAllowed,
    )
  })

  test('leads to passkey creation from the not-found choice', async () => {
    const vault = setupVault()
    lookupEndsWithoutPasskey(vault)
    const gate = renderSetupGate(vault)

    await fireEvent.click(
      gate.getByTestId('device-protection-use-existing-choice'),
    )
    await settle()
    await fireEvent.click(
      gate.getByTestId('device-protection-create-new-choice'),
    )
    await settle()

    expect(gate.getByTestId('device-protection-create-workflow')).toBeTruthy()
    expect(gate.getByTestId('device-protection-setup-btn')).toBeTruthy()
  })
})
