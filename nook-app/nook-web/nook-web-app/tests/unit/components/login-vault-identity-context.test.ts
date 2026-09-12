import { describe, expect, test, vi } from 'vitest'
import {
  NookIdentityDirectorySelectionKind,
  NookIdentityLocalAccessKind,
  NookSelectedVaultIdentityContextKind,
  NookVaultManager,
} from '$app-wasm'
import { LoginVaultIdentityReader } from '../../../../nook-web-shared/src/vault-app/lib/components/login/login-vault-identity-context'

function linkedIdentity(identityId: string, label: string) {
  return {
    appId: 'app-test',
    appKeyCount: 1,
    controlEpoch: 1n,
    fingerprint: 'fingerprint-test',
    identityId,
    label,
    localAccess: NookIdentityLocalAccessKind.CurrentBrowser,
    members: vi.fn(() => []),
    vaultCount: 1,
    vault_store_ids: vi.fn(() => ['store_selectedvault']),
    vaults: vi.fn(() => []),
    free: vi.fn(),
    [Symbol.dispose]: vi.fn(),
  }
}

function managerWithContext({
  kind,
  identities,
  currentIdentity,
}: {
  kind: NookSelectedVaultIdentityContextKind
  identities: readonly [string, string][]
  currentIdentity?: readonly [string, string]
}): {
  manager: NookVaultManager
  selectedVaultRequest: ReturnType<typeof vi.fn>
  currentBrowserIdentity: ReturnType<typeof vi.fn>
} {
  const currentBrowserIdentity = vi.fn(() => {
    if (!currentIdentity) {
      expect.fail(
        'the Rust-selected context must not request an unavailable identity',
      )
    }
    return linkedIdentity(...currentIdentity)
  })
  const snapshot = {
    selectedVaultContextKind: kind,
    length: identities.length,
    identity: (index: number) => {
      const identity = identities[index]
      if (!identity) expect.fail(`missing linked identity at index ${index}`)
      return linkedIdentity(...identity)
    },
    current_browser_identity: currentBrowserIdentity,
    device_access: vi.fn(),
    free: vi.fn(),
    [Symbol.dispose]: vi.fn(),
    selectedIdentityId: currentIdentity?.[0] ?? '',
    selectionKind: identities.length
      ? NookIdentityDirectorySelectionKind.Selected
      : NookIdentityDirectorySelectionKind.Empty,
  }
  const request = {
    resolve: vi.fn(async () => snapshot),
    free: vi.fn(),
    [Symbol.dispose]: vi.fn(),
  }
  const manager = new NookVaultManager()
  const selectedVaultRequest = vi
    .spyOn(manager, 'selected_vault_identity_context_request')
    .mockReturnValue(request)
  return {
    manager,
    selectedVaultRequest,
    currentBrowserIdentity,
  }
}

describe('login vault identity context', () => {
  test('loads the Rust-selected identities for the requested vault', async () => {
    const { manager, selectedVaultRequest } = managerWithContext({
      kind: NookSelectedVaultIdentityContextKind.LinkedWithCurrent,
      identities: [
        ['identity-personal', 'Personal'],
        ['identity-work', 'Work'],
      ],
      currentIdentity: ['identity-personal', 'Personal'],
    })

    const context = await new LoginVaultIdentityReader({
      manager,
      storeId: 'store_selectedvault',
    }).execute()

    expect(selectedVaultRequest).toHaveBeenCalledWith('store_selectedvault')
    expect(context.isOk()).toBe(true)
    if (context.isOk())
      expect(context.value).toEqual({
        kind: NookSelectedVaultIdentityContextKind.LinkedWithCurrent,
        identities: [
          { identityId: 'identity-personal', label: 'Personal' },
          { identityId: 'identity-work', label: 'Work' },
        ],
        currentIdentity: {
          identityId: 'identity-personal',
          label: 'Personal',
        },
      })
  })

  test('uses the Rust mismatch classification without resolving a current identity', async () => {
    const { manager, currentBrowserIdentity } = managerWithContext({
      kind: NookSelectedVaultIdentityContextKind.LinkedWithoutCurrent,
      identities: [['identity-work', 'Work']],
    })

    const context = await new LoginVaultIdentityReader({
      manager,
      storeId: 'store_selectedvault',
    }).execute()

    expect(context.isOk()).toBe(true)
    if (context.isOk())
      expect(context.value).toEqual({
        kind: NookSelectedVaultIdentityContextKind.LinkedWithoutCurrent,
        identities: [{ identityId: 'identity-work', label: 'Work' }],
      })
    expect(currentBrowserIdentity).not.toHaveBeenCalled()
  })

  test('uses the Rust empty classification without reading identities', async () => {
    const { manager, currentBrowserIdentity } = managerWithContext({
      kind: NookSelectedVaultIdentityContextKind.Empty,
      identities: [],
    })

    const context = await new LoginVaultIdentityReader({
      manager,
      storeId: 'store_selectedvault',
    }).execute()

    expect(context.isOk()).toBe(true)
    if (context.isOk())
      expect(context.value).toEqual({
        kind: NookSelectedVaultIdentityContextKind.Empty,
      })
    expect(currentBrowserIdentity).not.toHaveBeenCalled()
  })
})
