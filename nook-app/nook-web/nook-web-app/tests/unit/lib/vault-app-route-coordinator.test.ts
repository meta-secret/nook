import { describe, expect, test } from 'vitest'
import { VaultAppRouteCoordinator } from '$lib/app/vault-app-route-coordinator.svelte'
import { WorkspaceSection } from '$lib/vault/state/ui.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

function coordinator() {
  const vault = VaultStateTestFixture.create()
  const request: ConstructorParameters<typeof VaultAppRouteCoordinator>[0] = {
    vault,
    isSimpleApplication: true,
    supportsExtension: true,
    isSentinelParticipantResponsePending: () => false,
    isSentinelParticipantKeyPending: () => false,
    finishPendingCreation: () => {},
  }
  return { vault, routes: new VaultAppRouteCoordinator(request) }
}

describe('leaving the extension connect page', () => {
  test('approving or declining returns to the identities, not into a vault', () => {
    const { vault, routes } = coordinator()

    routes.finishExtensionConnect()

    expect(vault.workspaceSection).toBe(WorkspaceSection.Identities)
    expect(window.location.pathname).toMatch(/\/identities$/)
    expect(routes.extensionConnectRoute).toBe(false)
  })

  test('home still goes into the vault', () => {
    const { vault, routes } = coordinator()

    routes.navigateHome()

    expect(vault.workspaceSection).toBe(WorkspaceSection.Vault)
    expect(window.location.pathname).toMatch(/\/vault$/)
  })
})
