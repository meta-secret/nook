import { describe, expect, test } from 'vitest'
import { NookVaultManager } from '$app-wasm'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

describe('passkey details and history wasm boundary', () => {
  test('the generated binding rejects a passkey id without an unlocked vault', () => {
    const manager = new NookVaultManager()
    try {
      expect(() => manager.passkey_details_js('secret_missing')).toThrow()
    } finally {
      manager.free()
    }
  })

  test('the history binding rejects an uninitialized vault', async () => {
    const manager = new NookVaultManager()
    try {
      await expect(
        manager.secret_history_js('secret_missing'),
      ).rejects.toThrow()
    } finally {
      manager.free()
    }
  })

  test('the vault adapter reports the native failure instead of details', async () => {
    const vault = VaultStateTestFixture.create()
    vault.openManager(new NookVaultManager())

    const details = await vault.passkeyDetails('secret_missing')

    expect(details.isErr()).toBe(true)

    const history = await vault.secretHistory('secret_missing')

    expect(history.isErr()).toBe(true)
  })
})
