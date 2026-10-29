import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { err, ok } from 'neverthrow'
import initNookWasm, { DeviceProtectionStatus } from '$app-wasm'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import { IdentityActionOutcome } from '$lib/vault/identity-control.svelte'
import { IdentityPages } from '$lib/vault/identity-pages'
import { ProviderSaveOutcome } from '$lib/vault/providers.svelte'
import { WorkspaceSection } from '$lib/vault/state/ui.svelte'
import type { VaultState } from '$lib/vault.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

beforeAll(async () => {
  await initNookWasm()
})

afterEach(() => vi.restoreAllMocks())

/** An identity unlocked on this browser with none of its vaults open. */
function unlocked(): VaultState {
  const vault = VaultStateTestFixture.create()
  vault.deviceProtectionStatus = DeviceProtectionStatus.Unlocked
  return vault
}

describe('IdentityPages', () => {
  test('a page opens in place of the hub only for the unlocked identity without an open vault', () => {
    const vault = unlocked()
    const pages = new IdentityPages(vault)
    expect(pages.pageShown).toBe(false)
    expect(vault.identityInUse).toBe(false)

    pages.show(WorkspaceSection.Overview)
    expect(pages.pageShown).toBe(false)
    expect(vault.identityInUse).toBe(true)

    pages.show(WorkspaceSection.Devices)
    expect(pages.pageShown).toBe(true)

    // Locked again: its passkey has to open it.
    vault.deviceProtectionStatus = DeviceProtectionStatus.Passkey
    expect(pages.pageShown).toBe(false)
    expect(vault.identityInUse).toBe(false)

    vault.deviceProtectionStatus = DeviceProtectionStatus.Unlocked
    vault.isAuthenticated = true
    expect(pages.pageShown).toBe(false)
    expect(vault.identityInUse).toBe(true)
  })

  test('Vaults and Passwords have no page without a vault', () => {
    const vault = unlocked()
    const pages = new IdentityPages(vault)
    for (const section of [
      WorkspaceSection.Vaults,
      WorkspaceSection.Passwords,
      WorkspaceSection.Import,
    ]) {
      pages.show(section)
      expect(pages.pageShown).toBe(false)
    }
  })

  test('Sync chosen from the card opens with a provider being added', () => {
    const vault = unlocked()
    const begin = vi.spyOn(vault, 'beginAddProvider')
    const pages = new IdentityPages(vault)

    pages.manage(WorkspaceSection.Sync)
    expect(begin).toHaveBeenCalledOnce()
    expect(vault.identityPage).toBe(WorkspaceSection.Sync)

    pages.manage(WorkspaceSection.AddDevice)
    expect(begin).toHaveBeenCalledOnce()
    expect(vault.identityPage).toBe(WorkspaceSection.AddDevice)
  })

  test('Back returns to the overview and drops a provider being added', () => {
    const vault = unlocked()
    const cancelSetup = vi.spyOn(vault, 'cancelProviderSetup')
    const cancelAdd = vi.spyOn(vault, 'cancelAddProvider')
    const pages = new IdentityPages(vault)

    pages.show(WorkspaceSection.Keys)
    pages.back()
    expect(vault.identityPage).toBe(WorkspaceSection.Overview)
    expect(cancelSetup).not.toHaveBeenCalled()

    vault.activateLoginSetup('oauth-file')
    pages.show(WorkspaceSection.Sync)
    pages.back()
    expect(vault.identityPage).toBe(WorkspaceSection.Overview)
    expect(cancelSetup).toHaveBeenCalledOnce()
    expect(cancelAdd).toHaveBeenCalledOnce()
  })

  test('connecting saves the provider being set up, then copies the identity log', async () => {
    const vault = unlocked()
    const order: string[] = []
    vi.spyOn(vault, 'ensureProviderSaved').mockImplementation(() => {
      order.push('save')
      return Promise.resolve(ok(ProviderSaveOutcome.Saved))
    })
    vi.spyOn(vault.identityControl, 'syncWithMounts').mockImplementation(() => {
      order.push('sync')
      return Promise.resolve(ok(IdentityActionOutcome.Completed))
    })
    vault.activateLoginSetup('oauth-file')

    await new IdentityPages(vault).connectProvider()

    expect(order).toEqual(['save', 'sync'])
    expect(vault.errorMsg).toBe('')
  })

  test('with nothing being set up, connecting only copies the identity log', async () => {
    const vault = unlocked()
    const save = vi.spyOn(vault, 'ensureProviderSaved')
    const sync = vi
      .spyOn(vault.identityControl, 'syncWithMounts')
      .mockResolvedValue(ok(IdentityActionOutcome.Completed))

    await new IdentityPages(vault).connectProvider()

    expect(save).not.toHaveBeenCalled()
    expect(sync).toHaveBeenCalledOnce()
  })

  test('a provider that cannot be saved stops before any copy and says why', async () => {
    const vault = unlocked()
    const failure = new VaultStorageFailure(
      VaultStorageFailureKind.DuplicateProvider,
    )
    vi.spyOn(vault, 'ensureProviderSaved').mockResolvedValue(err(failure))
    const sync = vi.spyOn(vault.identityControl, 'syncWithMounts')
    vault.activateLoginSetup('oauth-file')

    await new IdentityPages(vault).connectProvider()

    expect(sync).not.toHaveBeenCalled()
    expect(vault.errorMsg).toBe(vault.t(failure.translationKey))
  })

  test('a failed copy of the identity log says why', async () => {
    const vault = unlocked()
    const failure = new VaultStorageFailure(
      VaultStorageFailureKind.OperationFailed,
    )
    vi.spyOn(vault.identityControl, 'syncWithMounts').mockResolvedValue(
      err(failure),
    )

    await new IdentityPages(vault).syncLog()

    expect(vault.errorMsg).toBe(vault.t(failure.translationKey))
  })
})
