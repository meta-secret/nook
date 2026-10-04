import { afterEach, describe, expect, test, vi } from 'vitest'
import { ok, type Result } from 'neverthrow'
import { LoginVaultPresentation } from '$lib/components/login/login-vault-presentation.svelte'
import { SerialOperationQueue } from '$lib/runtime/serial-operation-queue'
import {
  SentinelCeremonyVisibility,
  SentinelUnlockActions,
} from '$lib/vault/sentinel-unlock'
import { VaultType } from '$lib/vault/architecture-model'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

afterEach(() => vi.restoreAllMocks())

describe('login projection during pending device authorization', () => {
  test('navigation queues manager reads until the credential operation settles', async () => {
    const queue = new SerialOperationQueue()
    const credential = Promise.withResolvers<void>()
    const pending = queue.enqueue(() => credential.promise)
    const vault = VaultStateTestFixture.create()
    vault.enqueueStorage = <Value, Failure>(
      operation: () => Result<Value, Failure> | Promise<Result<Value, Failure>>,
    ) => queue.enqueue(operation)
    const visibility = vi
      .spyOn(SentinelUnlockActions.prototype, 'ceremonyVisibility')
      .mockReturnValue(ok(SentinelCeremonyVisibility.Hidden))
    const vaultType = vi
      .spyOn(SentinelUnlockActions.prototype, 'vaultType')
      .mockReturnValue(ok(VaultType.Simple))
    const departed = new LoginVaultPresentation(vault)
    const oldRead = departed.refresh()
    departed.release()
    const remounted = new LoginVaultPresentation(vault)
    const newRead = remounted.refresh()
    await Promise.resolve()
    expect(visibility).not.toHaveBeenCalled()
    expect(vaultType).not.toHaveBeenCalled()
    expect(remounted.hidePasswordUnlock).toBe(true)
    credential.resolve()
    await pending
    await Promise.all([oldRead, newRead])
    expect(remounted.hidePasswordUnlock).toBe(false)
    expect(remounted.showSentinelCeremony).toBe(false)
    expect(departed.hidePasswordUnlock).toBe(true)
  })
})
