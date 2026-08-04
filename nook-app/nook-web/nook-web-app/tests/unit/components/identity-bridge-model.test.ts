import { describe, expect, test } from 'vitest'
import {
  buildIdentityBridge,
  IdentityBridgeNodeKind,
  IdentityBridgePerspective,
  IdentityBridgeVaultSelectionKind,
  type IdentityBridgeCopy,
  type IdentityBridgeInput,
} from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access/identity-bridge-model'
import { DashboardTextKind } from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access-dashboard-state'

const copy: IdentityBridgeCopy = {
  identityStage: 'Local identity',
  selectedVaultStage: 'Selected vault',
  currentIdentity: 'Local identity state',
  selectedIdentity: 'Browser identity state',
  vaultAccess: 'Local vault access',
  identityDescription:
    'State reported for this browser; no virtual identity ID is inferred.',
  statusMetricLabel: 'Status',
  evidenceMetricLabel: 'Last successful use',
  verifiedStatus: 'Verified way in',
  unverifiedStatus: 'Not yet verified',
  noSelectedVault: 'No vault selected',
  noSelectedVaultDescription: 'Select a vault.',
  formatEvidence: (value) => `Local ${value}`,
  unknown: 'Unknown',
}

const vault = (storeId: string, verified: boolean) => ({
  storeId,
  label: storeId === 'home' ? 'Home' : 'Archive',
  verified,
  verifiedAt: verified
    ? { kind: DashboardTextKind.Known as const, value: '2026-08-04T10:00:00Z' }
    : { kind: DashboardTextKind.Unknown as const },
  lastLocalUpdateAt: { kind: DashboardTextKind.Unknown as const },
})

function input(
  perspective: IdentityBridgePerspective,
  selectedStoreId = 'home',
): IdentityBridgeInput {
  return {
    perspective,
    selectedVault: {
      kind: IdentityBridgeVaultSelectionKind.Selected,
      storeId: selectedStoreId,
    },
    compact: false,
    vaults: [vault('home', true), vault('archive', false)],
    copy,
  }
}

describe('identity bridge graph', () => {
  test('shows local identity without passkey, device-key, vault, or edge nodes', () => {
    const graph = buildIdentityBridge(
      input(IdentityBridgePerspective.Identities),
    )

    expect(graph.nodes.map((node) => node.id)).toEqual([
      'stage-identity',
      'identity-current',
    ])
    expect(graph.edges).toEqual([])
    const identity = graph.nodes.find((node) => node.id === 'identity-current')
    expect(identity?.data).toMatchObject({
      kind: IdentityBridgeNodeKind.Identity,
      label: 'Local identity state',
      description:
        'State reported for this browser; no virtual identity ID is inferred.',
    })
  })

  test('shows a selected vault without inventing an identity relationship', () => {
    const graph = buildIdentityBridge(input(IdentityBridgePerspective.Vaults))

    expect(graph.nodes.map((node) => node.id)).toEqual([
      'stage-vault',
      'vault-selected',
    ])
    expect(graph.edges).toEqual([])
    const selectedVault = graph.nodes.find(
      (node) => node.id === 'vault-selected',
    )
    expect(selectedVault?.data).toMatchObject({
      kind: IdentityBridgeNodeKind.Vault,
      label: 'Home',
      verifiedLocalAccess: true,
      evidenceLabel: 'Local 2026-08-04T10:00:00Z',
    })
  })

  test('keeps an unverified vault honest without adding a related entity', () => {
    const graph = buildIdentityBridge(
      input(IdentityBridgePerspective.Vaults, 'archive'),
    )

    expect(graph.nodes.map((node) => node.id)).toEqual([
      'stage-vault',
      'vault-selected',
    ])
    expect(graph.edges).toEqual([])
    expect(
      graph.nodes.find((node) => node.id === 'vault-selected')?.data,
    ).toMatchObject({
      kind: IdentityBridgeNodeKind.Vault,
      verifiedLocalAccess: false,
      statusLabel: 'Not yet verified',
    })
  })

  test('uses a vault-only empty state when no vault is selected', () => {
    const noVaultInput = input(IdentityBridgePerspective.Vaults)
    noVaultInput.selectedVault = {
      kind: IdentityBridgeVaultSelectionKind.Empty,
    }
    noVaultInput.vaults = []
    const graph = buildIdentityBridge(noVaultInput)

    expect(graph.nodes.map((node) => node.id)).toEqual([
      'stage-vault',
      'vault-empty',
    ])
    expect(graph.edges).toEqual([])
  })

  test('keeps compact identity presentation independent too', () => {
    const compact = input(IdentityBridgePerspective.Identities)
    compact.compact = true
    const graph = buildIdentityBridge(compact)

    expect(graph.compactHeight).toBe(300)
    expect(graph.nodes.map((node) => node.id)).toEqual([
      'stage-identity',
      'identity-current',
    ])
    expect(graph.edges).toEqual([])
  })
})
