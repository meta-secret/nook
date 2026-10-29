import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { err, ok } from 'neverthrow'
import initNookWasm from '$app-wasm'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import { IdentityActionOutcome } from '$lib/vault/identity-control.svelte'
import { ProviderConnectionActions } from '$lib/vault/providers.svelte'
import type { VaultState } from '$lib/vault.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

beforeAll(async () => {
  await initNookWasm()
})

afterEach(() => vi.restoreAllMocks())

/** A vault open on this browser whose staged provider connects cleanly. */
function connectedVault(): VaultState {
  const vault = VaultStateTestFixture.create()
  vault.isAuthenticated = true
  vi.spyOn(
    ProviderConnectionActions.prototype,
    'connectAndSyncStagedProvider',
  ).mockResolvedValue()
  return vault
}

describe('a provider added from vault settings', () => {
  test('creates the identity log before the provider receives it', async () => {
    const vault = connectedVault()
    const order: string[] = []
    vi.spyOn(vault.identityControl, 'refresh').mockImplementation(async () => {
      order.push('log created')
      return ok(IdentityActionOutcome.Completed)
    })
    vi.spyOn(vault.identityControl, 'syncWithMounts').mockImplementation(
      async () => {
        order.push('log sent to mounts')
        return ok(IdentityActionOutcome.Completed)
      },
    )

    await vault.connectAndSyncStagedProvider()

    expect(order).toEqual(['log created', 'log sent to mounts'])
    expect(vault.errorMsg).toBe('')
  })

  test('reports a log that could not be created and sends nothing', async () => {
    const vault = connectedVault()
    vi.spyOn(vault.identityControl, 'refresh').mockResolvedValue(
      err(new VaultStorageFailure(VaultStorageFailureKind.OperationFailed)),
    )
    const sync = vi.spyOn(vault.identityControl, 'syncWithMounts')

    await vault.connectAndSyncStagedProvider()

    expect(sync).not.toHaveBeenCalled()
    expect(vault.errorMsg).not.toBe('')
  })
})
