import { afterEach, beforeAll, expect, test, vi } from 'vitest'
import initNookWasm, { NookVaultManager, type NookSecretPage } from '$app-wasm'
import { ProviderRowFixture } from '../provider-fixtures'
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
  vi.spyOn(vault, 'providerWasmArgs').mockReturnValue({ mode: 'local' })
  let refuse: (failure: Error) => void = () => {}
  const opening = new Promise<NookSecretPage>((_, reject) => {
    refuse = reject
  })
  vi.spyOn(manager, 'connect_identity_vault').mockReturnValue(opening)
  vault.openManager(manager)
  VaultStateTestFixture.runStorageImmediately(vault)

  const opened = vault.identityControl.openVault('store_latervault1')
  await vi.waitFor(() => {
    expect(manager.connect_identity_vault).toHaveBeenCalledOnce()
  })
  // The keyring's rows and Open read this: a second press cannot queue
  // another open while this one runs.
  expect(vault.identityControl.busy).toBe(true)

  refuse(new Error('the provider is unreachable'))
  expect((await opened).isErr()).toBe(true)
  expect(vault.identityControl.busy).toBe(false)
})
