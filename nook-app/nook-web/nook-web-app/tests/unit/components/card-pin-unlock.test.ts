import { render } from '@testing-library/svelte'
import { flushSync, type ComponentProps } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { DeviceProtectionStatus } from '$app-wasm'
import { DeviceRecoveryKind } from '$lib/components/device-recovery'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import CardPinUnlock from '../../../../nook-web-shared/src/vault-app/lib/components/identities/CardPinUnlock.svelte'

class CardPinUnlockScenario {
  static render(isVerifying = false) {
    const vault = VaultStateTestFixture.create()
    vi.spyOn(vault, 't').mockImplementation((request) =>
      typeof request === 'string' ? request : request.key,
    )
    vault.deviceProtectionStatus = DeviceProtectionStatus.Pin
    const props: ComponentProps<typeof CardPinUnlock> = {
      vault,
      isVerifying,
      onUnlock: vi.fn(),
      onCancel: vi.fn(),
    }
    return { vault, view: render(CardPinUnlock, { props }) }
  }
}

describe('PIN unlock on an identity card', () => {
  test('a wrong PIN shows why and offers PIN recovery in the prompt', () => {
    const { vault, view } = CardPinUnlockScenario.render()
    expect(view.queryAllByTestId('card-pin-error')).toHaveLength(0)
    expect(view.queryAllByTestId('device-recovery')).toHaveLength(0)

    vault.errorMsg = 'The PIN did not unlock this browser.'
    flushSync()

    expect(view.getByTestId('card-pin-error').textContent).toContain(
      'The PIN did not unlock this browser.',
    )
    expect(view.getByTestId('device-recovery').dataset.kind).toBe(
      DeviceRecoveryKind.Pin,
    )
  })

  test('an unlock in progress hides the last failure', () => {
    const { vault, view } = CardPinUnlockScenario.render(true)
    vault.errorMsg = 'The PIN did not unlock this browser.'
    flushSync()

    expect(view.queryAllByTestId('card-pin-error')).toHaveLength(0)
    expect(view.queryAllByTestId('device-recovery')).toHaveLength(0)
  })
})
