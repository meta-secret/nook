import { describe, expect, test, vi } from 'vitest'
import {
  NookSelectedVaultIdentityContextKind,
  type NookIdentitySnapshot,
  type NookVaultManager,
} from '$app-wasm'
import { loadLoginVaultIdentityContext } from '../../../../nook-web-shared/src/vault-app/lib/components/login/login-vault-identity-context'

function linkedIdentity(
  identityId: string,
  label: string,
): NookIdentitySnapshot {
  return {
    identityId,
    label,
    free: vi.fn(),
  } as unknown as NookIdentitySnapshot
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
      throw new Error('current identity is unavailable')
    }
    return linkedIdentity(...currentIdentity)
  })
  const snapshot = {
    selectedVaultContextKind: kind,
    length: identities.length,
    identity: (index: number) => linkedIdentity(...identities[index]),
    current_browser_identity: currentBrowserIdentity,
    free: vi.fn(),
  }
  const request = {
    resolve: vi.fn(async () => snapshot),
    free: vi.fn(),
  }
  const selectedVaultRequest = vi.fn(() => request)
  return {
    manager: {
      selected_vault_identity_context_request: selectedVaultRequest,
    } as unknown as NookVaultManager,
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

    const context = await loadLoginVaultIdentityContext(
      manager,
      'store_selectedvault',
    )

    expect(selectedVaultRequest).toHaveBeenCalledWith('store_selectedvault')
    expect(context).toEqual({
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

    const context = await loadLoginVaultIdentityContext(
      manager,
      'store_selectedvault',
    )

    expect(context).toEqual({
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

    const context = await loadLoginVaultIdentityContext(
      manager,
      'store_selectedvault',
    )

    expect(context).toEqual({
      kind: NookSelectedVaultIdentityContextKind.Empty,
    })
    expect(currentBrowserIdentity).not.toHaveBeenCalled()
  })
})
