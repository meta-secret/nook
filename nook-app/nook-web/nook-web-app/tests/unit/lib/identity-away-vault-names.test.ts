import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import initNookWasm, {
  NookVaultManager,
  type GrantedVaultNameRead,
  type IdentityControlSnapshot,
  type ProviderVaultName,
} from '$app-wasm'
import { IdentityControlViewKind } from '$lib/vault/identity-control.svelte'
import type { VaultState } from '$lib/vault.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

beforeAll(async () => {
  await initNookWasm()
})

afterEach(() => vi.restoreAllMocks())

function vaultView(storeId: string, granted: boolean) {
  return {
    storeId,
    grantedToCurrentInstallation: granted,
    membersMissingDek: [],
  }
}

/** A session whose identity lists `vaults`, with a manager that names them. */
function session(identityId: string, vaults: ReturnType<typeof vaultView>[]) {
  const vault: VaultState = VaultStateTestFixture.create()
  const manager = new NookVaultManager()
  vault.openManager(manager)
  VaultStateTestFixture.runStorageImmediately(vault)
  vault.identityControl.view = {
    kind: IdentityControlViewKind.Ready,
    snapshot: { identityId, vaults } as unknown as IdentityControlSnapshot,
  }
  return { vault, manager }
}

const named = (name: string): ProviderVaultName => ({ state: 'named', name })
const readName = (name: string): GrantedVaultNameRead => ({
  state: 'read',
  name: named(name),
})

describe("names of a keyring's vaults this browser does not hold", () => {
  test('reads each granted vault it does not hold, once', async () => {
    const { vault, manager } = session('idn_a', [
      vaultView('store_held', true),
      vaultView('store_away', true),
      vaultView('store_withheld', false),
    ])
    const read = vi
      .spyOn(manager, 'identity_vault_name')
      .mockResolvedValue(readName('Travel'))

    await vault.identityControl.readAwayVaultNames(new Set(['store_held']))
    await vault.identityControl.readAwayVaultNames(new Set(['store_held']))

    expect(read).toHaveBeenCalledOnce()
    expect(read.mock.calls[0]?.[1]).toBe('store_away')
    expect(vault.identityControl.awayVaultNames.get('store_away')).toEqual(
      named('Travel'),
    )
  })

  test('a read that fails is not kept, so the next read tries again', async () => {
    const { vault, manager } = session('idn_a', [vaultView('store_away', true)])
    const read = vi
      .spyOn(manager, 'identity_vault_name')
      .mockRejectedValueOnce(new Error('not at the provider yet'))
      .mockResolvedValueOnce(readName('Travel'))

    await vault.identityControl.readAwayVaultNames(new Set())
    expect(vault.identityControl.awayVaultNames.has('store_away')).toBe(false)

    await vault.identityControl.readAwayVaultNames(new Set())
    expect(read).toHaveBeenCalledTimes(2)
    expect(vault.identityControl.awayVaultNames.get('store_away')).toEqual(
      named('Travel'),
    )
  })

  test('a vault no saved provider replicates yet is read again later, with no warning', async () => {
    const { vault, manager } = session('idn_a', [vaultView('store_away', true)])
    const reads = vi
      .spyOn(manager, 'identity_vault_name')
      .mockResolvedValueOnce({ state: 'notReplicatedHereYet' })
      .mockResolvedValueOnce(readName('Travel'))

    await vault.identityControl.readAwayVaultNames(new Set())
    expect(vault.identityControl.awayVaultNames.has('store_away')).toBe(false)
    await vault.identityControl.readAwayVaultNames(new Set())

    expect(reads).toHaveBeenCalledTimes(2)
    expect(vault.identityControl.awayVaultNames.get('store_away')).toEqual(
      named('Travel'),
    )
  })

  test('names read for a keyring left meanwhile are dropped', async () => {
    const { vault, manager } = session('idn_a', [vaultView('store_away', true)])
    vi.spyOn(manager, 'identity_vault_name').mockImplementation(async () => {
      vault.identityControl.forgetIdentity()
      return readName('Travel')
    })

    await vault.identityControl.readAwayVaultNames(new Set())

    expect(vault.identityControl.awayVaultNames.size).toBe(0)
  })
})
