import { NookVaultManager } from '$app-wasm'
import { describe, expect, test } from 'vitest'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

class VaultStateDelegationScenario {
  verifiesOwnedSessionMutation(): void {
    const state = VaultStateTestFixture.create()
    const manager = new NookVaultManager()

    state.openManager(manager)

    expect(state.hasManager).toBe(true)
    const admitted = state.admitManager()
    expect(admitted.isOk()).toBe(true)
    if (admitted.isOk()) expect(admitted.value).toBe(manager)

    state.clearManager()
    expect(state.hasManager).toBe(false)
  }
}

describe('vault state slice delegation', () => {
  test('methods and readers share the owning session slice', () => {
    new VaultStateDelegationScenario().verifiesOwnedSessionMutation()
  })
})
