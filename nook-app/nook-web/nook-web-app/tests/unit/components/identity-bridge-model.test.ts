import { describe, expect, test } from 'vitest'
import {
  buildIdentityBridge,
  IdentityBridgeDeviceIconKind,
  IdentityBridgeNodeKind,
  IdentityBridgePerspective,
  IdentityBridgeVaultSelectionKind,
  type IdentityBridgeCopy,
  type IdentityBridgeInput,
} from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access/identity-bridge-model'
import { DashboardTextKind } from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access-dashboard-state'

const copy: IdentityBridgeCopy = {
  deviceStage: 'Device evidence',
  identityStage: 'Identity context',
  vaultStage: 'Verified device-key access',
  selectedVaultStage: 'Selected vault',
  authorizedIdentitiesStage: 'Identity context',
  currentDevice: 'This browser',
  currentIdentity: 'This identity',
  selectedIdentity: 'Selected identity',
  vaultGrant: 'Vault access',
  deviceKey: 'Device key',
  oneDeviceKey: '1 key',
  identityDescription: 'Passkey protected',
  identityState: 'Identity unlocked',
  identityIdentifier: 'Identity reference',
  deviceMetricLabel: 'Device evidence',
  oneDevice: '1 device',
  vaultMetricLabel: 'Verified vaults',
  verifiedVaultCount: '1 verified',
  statusMetricLabel: 'Status',
  evidenceMetricLabel: 'Last successful use',
  vaultIdentifierLabel: 'Vault identifier',
  verifiedStatus: 'Verified way in',
  unverifiedStatus: 'Not yet verified',
  noAuthorizedIdentity: 'No verified relationship',
  noAuthorizedIdentityDescription: 'No verified evidence exists.',
  noSelectedVault: 'No vault selected',
  noSelectedVaultDescription: 'Select a vault.',
  deviceIdentityRelation: 'Device key belongs to this identity context',
  deviceVaultRelation: (vaultLabel) =>
    `Device key opened ${vaultLabel}; identity grant unknown`,
  vaultIdentityRelation: (vaultLabel) =>
    `Identity context for the key that opened ${vaultLabel}`,
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
    deviceIdentifier: 'device_public_key',
    identityIdentifier: 'passkey_user_handle',
    protectionLabel: 'Passkey protected',
    deviceIconKind: IdentityBridgeDeviceIconKind.Browser,
    vaults: [vault('home', true), vault('archive', false)],
    copy,
  }
}

describe('identity bridge graph', () => {
  test('keeps device-key evidence distinct from the distributed identity', () => {
    const graph = buildIdentityBridge(
      input(IdentityBridgePerspective.Identities),
    )
    const device = graph.nodes.find((node) => node.id === 'device-current')
    const identity = graph.nodes.find((node) => node.id === 'identity-current')

    expect(device?.data.kind).toBe(IdentityBridgeNodeKind.Device)
    if (device?.data.kind === IdentityBridgeNodeKind.Device) {
      expect(device.data.installations[0]?.id).toBe('device_public_key')
    }
    expect(identity?.data.kind).toBe(IdentityBridgeNodeKind.Identity)
    if (identity?.data.kind === IdentityBridgeNodeKind.Identity) {
      expect(identity.data.identifier).toBe('passkey_user_handle')
    }
  })

  test('draws access only for vaults this exact device key opened', () => {
    const graph = buildIdentityBridge(
      input(IdentityBridgePerspective.Identities),
    )

    expect(graph.nodes.some((node) => node.id === 'vault-home')).toBe(true)
    expect(graph.nodes.some((node) => node.id === 'vault-archive')).toBe(false)
    expect(graph.edges.map((edge) => edge.id)).toEqual([
      'device-to-identity',
      'identity-to-home',
    ])
    expect(graph.edges.map((edge) => edge.ariaLabel)).toEqual([
      'Device key belongs to this identity context',
      'Device key opened Home; identity grant unknown',
    ])
  })

  test('reverses the verified relationship in vault-first view', () => {
    const graph = buildIdentityBridge(input(IdentityBridgePerspective.Vaults))

    expect(graph.nodes.some((node) => node.id === 'vault-selected')).toBe(true)
    expect(graph.nodes.some((node) => node.id === 'identity-current')).toBe(
      true,
    )
    expect(graph.edges.map((edge) => edge.id)).toEqual(['vault-to-identity'])
  })

  test('shows an honest empty state for an unverified selected vault', () => {
    const graph = buildIdentityBridge(
      input(IdentityBridgePerspective.Vaults, 'archive'),
    )

    expect(graph.nodes.some((node) => node.id === 'identity-empty')).toBe(true)
    expect(graph.nodes.some((node) => node.id === 'identity-current')).toBe(
      false,
    )
    expect(graph.edges).toHaveLength(0)
  })

  test('keeps vault-first empty state in vault-first hierarchy', () => {
    const noVaultInput = input(IdentityBridgePerspective.Vaults)
    noVaultInput.selectedVault = {
      kind: IdentityBridgeVaultSelectionKind.Empty,
    }
    noVaultInput.vaults = []
    const graph = buildIdentityBridge(noVaultInput)

    expect(graph.nodes.some((node) => node.id === 'device-current')).toBe(false)
    expect(graph.nodes.some((node) => node.id === 'vault-empty')).toBe(true)
    expect(graph.nodes.some((node) => node.id === 'identity-empty')).toBe(true)
    expect(graph.edges).toHaveLength(0)
  })

  test('carries paired-device semantics into the device node', () => {
    const paired = input(IdentityBridgePerspective.Identities)
    paired.deviceIconKind = IdentityBridgeDeviceIconKind.PairedDevice
    paired.copy.currentDevice = 'Paired device identity'
    const graph = buildIdentityBridge(paired)
    const device = graph.nodes.find((node) => node.id === 'device-current')

    expect(device?.data.kind).toBe(IdentityBridgeNodeKind.Device)
    if (device?.data.kind === IdentityBridgeNodeKind.Device) {
      expect(device.data.iconKind).toBe(
        IdentityBridgeDeviceIconKind.PairedDevice,
      )
      expect(device.data.label).toBe('Paired device identity')
    }
  })
})
