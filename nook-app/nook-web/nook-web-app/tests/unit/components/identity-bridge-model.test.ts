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
import { DeviceAccessIdentityState } from '../../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'

const copy: IdentityBridgeCopy = {
  protectionStage: 'Unlock protection',
  deviceStage: 'Device evidence',
  identityStage: 'Identity context',
  vaultStage: 'Verified device-key access',
  selectedVaultStage: 'Selected vault',
  currentDevice: 'This browser',
  currentIdentity: 'Local identity state',
  selectedIdentity: 'Browser identity state',
  vaultGrant: 'Vault access',
  deviceKey: 'Device key',
  oneDeviceKey: '1 key',
  identityDescription: 'Passkey protected',
  identityState: 'Identity unlocked',
  deviceMetricLabel: 'Device evidence',
  vaultMetricLabel: 'Verified vaults',
  verifiedVaultCount: '1 verified',
  statusMetricLabel: 'Status',
  evidenceMetricLabel: 'Last successful use',
  verifiedStatus: 'Verified way in',
  unverifiedStatus: 'Not yet verified',
  noAuthorizedIdentity: 'No verified relationship',
  noAuthorizedIdentityDescription: 'No verified evidence exists.',
  noVerifiedVaults: 'No verified vault access',
  noVerifiedVaultsDescription: 'This key has not opened a known vault.',
  noSelectedVault: 'No vault selected',
  noSelectedVaultDescription: 'Select a vault.',
  protectionDeviceRelation: 'Unlocks this device key',
  deviceVaultRelation: (vaultLabel) =>
    `Device key opened ${vaultLabel}; identity grant unknown`,
  vaultDeviceRelation: (vaultLabel) =>
    `${vaultLabel} was opened by this exact device key`,
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
    deviceIdentifier: 'device_public_key',
    identityStatus: DeviceAccessIdentityState.Unlocked,
    protectionLabel: 'Passkey protected',
    deviceIconKind: IdentityBridgeDeviceIconKind.Browser,
    vaults: [vault('home', true), vault('archive', false)],
    copy,
  }
}

describe('identity bridge graph', () => {
  test('keeps the passkey handle out of the local identity-state card', () => {
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
      expect(identity.data).not.toHaveProperty('identifier')
      expect(identity.data.deviceMetricValue).toBe('1 key')
    }
  })

  test('draws access only for vaults this exact device key opened', () => {
    const graph = buildIdentityBridge(
      input(IdentityBridgePerspective.Identities),
    )

    expect(graph.nodes.some((node) => node.id === 'vault-home')).toBe(true)
    expect(graph.nodes.some((node) => node.id === 'vault-archive')).toBe(false)
    expect(graph.edges.map((edge) => edge.id)).toEqual([
      'protection-to-device',
      'device-to-home',
    ])
    expect(
      graph.edges.find((edge) => edge.id === 'device-to-home'),
    ).toMatchObject({ source: 'device-current', target: 'vault-home' })
    expect(graph.edges.map((edge) => edge.ariaLabel)).toEqual([
      'Unlocks this device key',
      'Device key opened Home; identity grant unknown',
    ])
  })

  test('shows the protection evidence that unlocks the device key', () => {
    const graph = buildIdentityBridge(
      input(IdentityBridgePerspective.Identities),
    )

    expect(
      graph.nodes.find((node) => node.id === 'protection-current')?.data,
    ).toMatchObject({
      kind: IdentityBridgeNodeKind.Protection,
      label: 'Passkey protected',
    })
    expect(
      graph.edges.find((edge) => edge.id === 'protection-to-device'),
    ).toMatchObject({
      source: 'protection-current',
      target: 'device-current',
    })
    expect(
      graph.nodes.find((node) => node.id === 'device-current')?.ariaLabel,
    ).toContain('Unlocks this device key')
    expect(
      graph.nodes.find((node) => node.id === 'vault-home')?.ariaLabel,
    ).toContain('Device key opened Home')
  })

  test('keeps compact identity-bridge cards within a narrow viewport canvas', () => {
    const compactInput = input(IdentityBridgePerspective.Identities)
    compactInput.compact = true
    const graph = buildIdentityBridge(compactInput)

    for (const node of graph.nodes) {
      expect(node.position.x).toBeGreaterThanOrEqual(20)
      expect(node.position.x + (node.width ?? 0)).toBeLessThanOrEqual(220)
    }
  })

  test('routes vault-first evidence to the exact device key', () => {
    const graph = buildIdentityBridge(input(IdentityBridgePerspective.Vaults))

    expect(graph.nodes.some((node) => node.id === 'vault-selected')).toBe(true)
    expect(graph.nodes.some((node) => node.id === 'device-current')).toBe(true)
    expect(graph.nodes.some((node) => node.id === 'identity-current')).toBe(
      false,
    )
    expect(graph.edges.map((edge) => edge.id)).toEqual(['vault-to-device'])
    expect(graph.edges[0]).toMatchObject({
      source: 'vault-selected',
      target: 'device-current',
    })
  })

  test('shows an honest empty state for an unverified selected vault', () => {
    const graph = buildIdentityBridge(
      input(IdentityBridgePerspective.Vaults, 'archive'),
    )

    expect(graph.nodes.some((node) => node.id === 'device-empty')).toBe(true)
    expect(graph.nodes.some((node) => node.id === 'identity-current')).toBe(
      false,
    )
    expect(graph.edges).toHaveLength(0)
    const selectedVault = graph.nodes.find(
      (node) => node.id === 'vault-selected',
    )
    expect(selectedVault?.data.kind).toBe(IdentityBridgeNodeKind.Vault)
    if (selectedVault?.data.kind === IdentityBridgeNodeKind.Vault) {
      expect(selectedVault.data.incomingRelation).toBe('')
    }
    const emptyDevice = graph.nodes.find((node) => node.id === 'device-empty')
    const deviceStage = graph.nodes.find((node) => node.id === 'stage-device')
    expect(emptyDevice?.data).toMatchObject({
      kind: IdentityBridgeNodeKind.Empty,
      label: 'No verified relationship',
      description: 'No verified evidence exists.',
    })
    expect(emptyDevice?.position.x).toBe(deviceStage?.position.x)
  })

  test('formats timestamp evidence and keeps vault identifiers out of graph cards', () => {
    const graph = buildIdentityBridge(
      input(IdentityBridgePerspective.Identities),
    )
    const vaultNode = graph.nodes.find((node) => node.id === 'vault-home')

    expect(vaultNode?.data.kind).toBe(IdentityBridgeNodeKind.Vault)
    if (vaultNode?.data.kind === IdentityBridgeNodeKind.Vault) {
      expect(vaultNode.data.evidenceLabel).toBe('Local 2026-08-04T10:00:00Z')
      expect(vaultNode.data).not.toHaveProperty('identifier')
      expect(vaultNode.data.incomingRelation).toContain(
        'Device key opened Home',
      )
    }
  })

  test('uses a perspective-specific empty state when no known vault was opened', () => {
    const noAccess = input(IdentityBridgePerspective.Identities)
    noAccess.vaults = [vault('archive', false)]
    const graph = buildIdentityBridge(noAccess)
    const empty = graph.nodes.find((node) => node.id === 'vault-empty')

    expect(empty?.data).toMatchObject({
      kind: IdentityBridgeNodeKind.Empty,
      label: 'No verified vault access',
      description: 'This key has not opened a known vault.',
    })
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
    expect(graph.nodes.some((node) => node.id === 'device-empty')).toBe(false)
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
