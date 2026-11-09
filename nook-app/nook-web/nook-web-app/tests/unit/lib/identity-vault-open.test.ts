import { afterEach, beforeAll, expect, test, vi } from 'vitest'
import initNookWasm, { NookVaultManager, type NookSecretPage } from '$app-wasm'
import { ProviderRowFixture } from '../provider-fixtures'
import { ok } from 'neverthrow'
import { WorkspaceSection } from '$lib/vault/state/ui.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

beforeAll(async () => {
  await initNookWasm()
})

afterEach(() => vi.restoreAllMocks())

test('a granted vault keeps its keyring busy until it has opened', async () => {
  const vault = VaultStateTestFixture.create()
  const manager = new NookVaultManager()
  const row = ProviderRowFixture.github(
    ProviderRowFixture.unscoped('keyring-provider'),
  )
  vi.spyOn(manager, 'identity_vault_provider').mockReturnValue(row)
  let refuse: (failure: Error) => void = () => {}
  const opening = new Promise<NookSecretPage>((_, reject) => {
    refuse = reject
  })
  vi.spyOn(manager, 'connect_identity_vault_by_row').mockReturnValue(opening)
  vault.openManager(manager)
  VaultStateTestFixture.runStorageImmediately(vault)

  const opened = vault.identityControl.openVault('store_latervault1')
  await vi.waitFor(() => {
    expect(manager.connect_identity_vault_by_row).toHaveBeenCalledOnce()
  })
  // The keyring's rows and Open read this: a second press cannot queue
  // another open while this one runs.
  expect(vault.identityControl.busy).toBe(true)

  refuse(new Error('the provider is unreachable'))
  expect((await opened).isErr()).toBe(true)
  expect(vault.identityControl.busy).toBe(false)
})

test('Open vault on the keyrings page lands in the vault once it opens', async () => {
  const vault = VaultStateTestFixture.create()
  const manager = new NookVaultManager()
  const row = ProviderRowFixture.github(
    ProviderRowFixture.unscoped('keyring-provider'),
  )
  vi.spyOn(manager, 'identity_vault_provider').mockReturnValue(row)
  vi.spyOn(manager, 'connect_identity_vault_by_row').mockResolvedValue(
    {} as NookSecretPage,
  )
  vault.openManager(manager)
  VaultStateTestFixture.runStorageImmediately(vault)
  vi.spyOn(vault, 'applyConnectedSecretPage').mockReturnValue()
  vi.spyOn(vault, 'refreshLocalVaultCatalog').mockResolvedValue(
    ok(undefined) as never,
  )
  vi.spyOn(vault, 'syncActiveVaultStoreIdToAuth').mockResolvedValue(
    ok(undefined) as never,
  )
  vi.spyOn(vault, 'hydrateMultiDeviceState').mockResolvedValue(
    ok(undefined) as never,
  )
  vi.spyOn(vault, 'markVaultUnlocked').mockReturnValue(ok(undefined) as never)
  vi.spyOn(vault, 'startIdleSessionTracking').mockReturnValue()
  vi.spyOn(vault, 'startVaultSync').mockReturnValue()
  const openSection = vi.spyOn(vault, 'openSection').mockReturnValue()

  const opened = await vault.identityControl.openVault('store_latervault1')

  expect(opened.isOk()).toBe(true)
  expect(openSection).toHaveBeenCalledExactlyOnceWith(WorkspaceSection.Vault)
})
