import { afterEach, describe, expect, test, vi } from 'vitest'
import { ok } from 'neverthrow'
import { NookVaultManager } from '$app-wasm'
import { IdentityDirectoryLoader } from '$lib/components/identities/identity-directory-loader.svelte'
import { IdentityDirectoryLoadKind } from '$lib/components/devices-access/identity-directory-view'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

afterEach(() => vi.restoreAllMocks())

describe('identity directory loader', () => {
  test('reads the directory through the storage queue', async () => {
    const vault = VaultStateTestFixture.create()
    const reads: string[] = []
    const manager = new NookVaultManager()
    vi.spyOn(manager, 'identity_directory_snapshot_request').mockImplementation(
      () => {
        reads.push('read')
        throw new Error('engine busy')
      },
    )
    vi.spyOn(vault, 'admitManager').mockReturnValue(ok(manager))
    VaultStateTestFixture.runStorageImmediately(vault)
    const queued = vi.spyOn(vault, 'enqueueStorage')
    vi.useFakeTimers()

    const loader = new IdentityDirectoryLoader(vault)
    const reload = loader.reload()
    await vi.runAllTimersAsync()
    await reload
    vi.useRealTimers()

    expect(queued).toHaveBeenCalledTimes(reads.length)
    expect(reads.length).toBeGreaterThan(1)
    expect(loader.state.kind).toBe(IdentityDirectoryLoadKind.Failed)
  })
})
