import { afterEach, describe, expect, test, vi } from 'vitest'
import { ok } from 'neverthrow'
import { NookVaultManager } from '$app-wasm'
import { IdentityDirectoryLoader } from '$lib/components/identities/identity-directory-loader.svelte'
import {
  IdentityDirectoryLoadKind,
  IdentityDirectorySelectionKind,
  type IdentityDirectoryLoadState,
} from '$lib/components/devices-access/identity-directory-view'
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

  test('a hub mounted later keeps the cards already read while it reads again', async () => {
    const vault = VaultStateTestFixture.create()
    const manager = new NookVaultManager()
    vi.spyOn(manager, 'identity_directory_snapshot_request').mockImplementation(
      () => {
        throw new Error('engine busy')
      },
    )
    vi.spyOn(vault, 'admitManager').mockReturnValue(ok(manager))
    VaultStateTestFixture.runStorageImmediately(vault)
    const read: IdentityDirectoryLoadState = {
      kind: IdentityDirectoryLoadKind.Ready,
      view: {
        identities: [],
        selection: { kind: IdentityDirectorySelectionKind.Empty },
      },
    }
    // The login screen's hub read the cards before the vault opened.
    vault.identityDirectory = read

    // Opening a vault swaps in the workspace, whose hub reads again: its
    // cards are on screen at once and stay there while that read is refused.
    const later = new IdentityDirectoryLoader(vault)
    expect(later.state).toEqual(read)
    vi.useFakeTimers()
    const reload = later.reload()
    await vi.runAllTimersAsync()
    await reload
    vi.useRealTimers()
    expect(later.state).toEqual(read)
  })
})
