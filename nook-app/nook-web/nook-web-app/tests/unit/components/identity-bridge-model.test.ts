import { describe, expect, test } from 'vitest'
import {
  IdentityBridgePresentation,
  IdentityBridgeDeviceIconKind,
  IdentityBridgeNodeKind,
  IdentityBridgePerspective,
  IdentityBridgeVaultSelectionKind,
  type IdentityBridgeCopy,
  type IdentityBridgeInput,
} from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access/identity-bridge-model'
import {
  KnownDashboardText,
  UnknownDashboardText,
} from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access-dashboard-state'
import { DeviceAccessIdentityState } from '$app-wasm'
import {
  PasskeyCardFactKind,
  PasskeyCardSummaryKind,
} from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access/passkey-card'

const copy: IdentityBridgeCopy = {
  protectionStage: 'Passkey',
  deviceStage: 'App',
  identityStage: 'Identity',
  vaultStage: 'Vaults',
  selectedVaultStage: 'Selected vault',
  currentDevice: 'App',
  currentIdentity: 'Identity',
  selectedIdentity: 'Identity',
  vaultGrant: 'Vault access',
  deviceKey: 'App',
  oneDeviceKey: '1 app',
  identityDescription: 'Passkey protected',
  identityState: 'Identity unlocked',
  deviceMetricLabel: 'App',
  vaultMetricLabel: 'Verified vaults',
  verifiedVaultCount: '1 verified',
  statusMetricLabel: 'Status',
  evidenceMetricLabel: 'Last successful use',
  verifiedStatus: 'Verified way in',
  unverifiedStatus: 'Not yet verified',
  noAuthorizedIdentity: 'No verified relationship',
  noAuthorizedIdentityDescription: 'No verified evidence exists.',
  noVerifiedVaults: 'No verified vault access',
  noVerifiedVaultsDescription: 'This identity has not opened a known vault.',
  noSelectedVault: 'No vault selected',
  noSelectedVaultDescription: 'Select a vault.',
  protectionDeviceRelation: 'Protects this app',
  appKeyIdentityRelation: 'App is linked to this identity',
  identityVaultRelation: (vaultLabel) =>
    `This identity holds the DEK for ${vaultLabel}`,
  deviceVaultRelation: (vaultLabel) => `App opened ${vaultLabel}`,
  vaultDeviceRelation: (vaultLabel) => `${vaultLabel} was opened by this app`,
  formatEvidence: (value) => `Local ${value}`,
  unknown: 'Unknown',
}

const vault = (storeId: string, verified: boolean) => ({
  storeId,
  label: storeId === 'home' ? 'Home' : 'Archive',
  verified,
  verifiedAt: verified
    ? new KnownDashboardText('2026-08-04T10:00:00Z')
    : new UnknownDashboardText(),
  lastLocalUpdateAt: new UnknownDashboardText(),
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
    deviceIdentifier: 'app_public_key',
    identityStatus: DeviceAccessIdentityState.Unlocked,
    protectionLabel: 'Passkey protected',
    protectionSummary: {
      kind: PasskeyCardSummaryKind.Present,
      summary: {
        title: 'Work laptop',
        typeLabel: 'Passkey',
        modeLabel: 'Passkey protected',
        facts: [
          {
            kind: PasskeyCardFactKind.Fingerprint,
            label: 'Passkey ID',
            value: 'passkey_1234',
          },
          {
            kind: PasskeyCardFactKind.Keeper,
            label: 'Stored with',
            value: 'Proton Pass',
          },
          {
            kind: PasskeyCardFactKind.Created,
            label: 'First recorded by Nook',
            value: 'Mar 1, 2026',
          },
          {
            kind: PasskeyCardFactKind.LastUsed,
            label: 'Last used',
            value: 'Mar 1, 2026',
          },
        ],
      },
    },
    deviceIconKind: IdentityBridgeDeviceIconKind.Browser,
    vaults: [vault('home', true), vault('archive', false)],
    copy,
  }
}

describe('identity bridge graph', () => {
  test('centers identity between app and vaults', () => {
    const graph = new IdentityBridgePresentation(
      input(IdentityBridgePerspective.Identities),
    ).graph
    const device = graph.nodes.find((node) => node.id === 'device-current')
    const identity = graph.nodes.find((node) => node.id === 'identity-current')

    expect(device?.data.kind).toBe(IdentityBridgeNodeKind.Device)
    if (device?.data.kind === IdentityBridgeNodeKind.Device) {
      expect(device.data.installations[0]?.id).toBe('app_public_key')
    }
    expect(identity?.data.kind).toBe(IdentityBridgeNodeKind.Identity)
    if (identity?.data.kind === IdentityBridgeNodeKind.Identity) {
      expect(identity.data).not.toHaveProperty('identifier')
      expect(identity.data.deviceMetricValue).toBe('1 app')
    }
  })

  test('draws passkey → app → identity → verified vaults', () => {
    const graph = new IdentityBridgePresentation(
      input(IdentityBridgePerspective.Identities),
    ).graph

    expect(graph.nodes.some((node) => node.id === 'vault-home')).toBe(true)
    expect(graph.nodes.some((node) => node.id === 'vault-archive')).toBe(false)
    expect(graph.edges.map((edge) => edge.id)).toEqual([
      'protection-to-device',
      'device-to-identity',
      'identity-to-home',
    ])
    expect(
      graph.edges.find((edge) => edge.id === 'identity-to-home'),
    ).toMatchObject({ source: 'identity-current', target: 'vault-home' })
    expect(graph.edges.map((edge) => edge.ariaLabel)).toEqual([
      'Protects this app',
      'App is linked to this identity',
      'This identity holds the DEK for Home',
    ])
  })

  test('compact identity vault edges use lateral vault-access handles', () => {
    const graph = new IdentityBridgePresentation({
      ...input(IdentityBridgePerspective.Identities),
      compact: true,
    }).graph
    const identity = graph.nodes.find((node) => node.id === 'identity-current')
    expect(identity?.data.kind).toBe(IdentityBridgeNodeKind.Identity)
    if (identity?.data.kind === IdentityBridgeNodeKind.Identity) {
      expect(identity.data.lateralAccessPort).toBe(true)
    }
    expect(
      graph.edges.find((edge) => edge.id === 'identity-to-home'),
    ).toMatchObject({
      sourceHandle: 'vault-access',
      targetHandle: 'vault-access',
    })
  })

  test('shows the passkey that protects the app', () => {
    const graph = new IdentityBridgePresentation(
      input(IdentityBridgePerspective.Identities),
    ).graph

    const protection = graph.nodes.find(
      (node) => node.id === 'protection-current',
    )
    if (!protection) expect.fail('protection node is required')
    expect(protection.data.kind).toBe(IdentityBridgeNodeKind.Protection)
    if (protection.data.kind === IdentityBridgeNodeKind.Protection) {
      expect(protection.data.label).toBe('Work laptop')
      expect(protection.data.description).toBe('Passkey protected')
      expect(protection.data.summary.kind).toBe(PasskeyCardSummaryKind.Present)
      if (protection.data.summary.kind === PasskeyCardSummaryKind.Present) {
        expect(
          protection.data.summary.summary.facts.map((fact) => fact.value),
        ).toEqual(expect.arrayContaining(['passkey_1234', 'Proton Pass']))
      }
    }
    expect(
      graph.edges.find((edge) => edge.id === 'protection-to-device'),
    ).toMatchObject({
      source: 'protection-current',
      target: 'device-current',
    })
    expect(
      graph.nodes.find((node) => node.id === 'device-current')?.ariaLabel,
    ).toContain('Protects this app')
    expect(
      graph.nodes.find((node) => node.id === 'vault-home')?.ariaLabel,
    ).toContain('This identity holds the DEK for Home')
  })

  test('routes vault-first evidence to the exact app', () => {
    const graph = new IdentityBridgePresentation(
      input(IdentityBridgePerspective.Vaults),
    ).graph

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
    expect(
      graph.nodes.find((node) => node.id === 'device-current')?.ariaLabel,
    ).toBe('App: App. Home was opened by this app')
  })

  test('shows an honest empty state for an unverified selected vault', () => {
    const graph = new IdentityBridgePresentation(
      input(IdentityBridgePerspective.Vaults, 'archive'),
    ).graph

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
    const graph = new IdentityBridgePresentation(
      input(IdentityBridgePerspective.Identities),
    ).graph
    const vaultNode = graph.nodes.find((node) => node.id === 'vault-home')

    expect(vaultNode?.data.kind).toBe(IdentityBridgeNodeKind.Vault)
    if (vaultNode?.data.kind === IdentityBridgeNodeKind.Vault) {
      expect(vaultNode.data.evidenceLabel).toBe('Local 2026-08-04T10:00:00Z')
      expect(vaultNode.data).not.toHaveProperty('identifier')
      expect(vaultNode.data.incomingRelation).toContain(
        'This identity holds the DEK for Home',
      )
    }
  })

  test('uses a perspective-specific empty state when no known vault was opened', () => {
    const noAccess = input(IdentityBridgePerspective.Identities)
    noAccess.vaults = [vault('archive', false)]
    const graph = new IdentityBridgePresentation(noAccess).graph
    const empty = graph.nodes.find((node) => node.id === 'vault-empty')

    expect(empty?.data).toMatchObject({
      kind: IdentityBridgeNodeKind.Empty,
      label: 'No verified vault access',
      description: 'This identity has not opened a known vault.',
    })
  })

  test('keeps vault-first empty state in vault-first hierarchy', () => {
    const noVaultInput = input(IdentityBridgePerspective.Vaults)
    noVaultInput.selectedVault = {
      kind: IdentityBridgeVaultSelectionKind.Empty,
    }
    noVaultInput.vaults = []
    const graph = new IdentityBridgePresentation(noVaultInput).graph

    expect(graph.nodes.some((node) => node.id === 'device-current')).toBe(false)
    expect(graph.nodes.some((node) => node.id === 'vault-empty')).toBe(true)
    expect(graph.nodes.some((node) => node.id === 'device-empty')).toBe(false)
    expect(graph.edges).toHaveLength(0)
  })

  test('carries paired-device semantics into the device node', () => {
    const paired = input(IdentityBridgePerspective.Identities)
    paired.deviceIconKind = IdentityBridgeDeviceIconKind.PairedDevice
    paired.copy.currentDevice = 'Paired device identity'
    const graph = new IdentityBridgePresentation(paired).graph
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
