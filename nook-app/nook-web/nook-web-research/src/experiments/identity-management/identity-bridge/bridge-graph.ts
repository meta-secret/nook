import { MarkerType, type Edge, type Node } from '@xyflow/svelte'

import {
  identityVaultFixtures,
  type Identity,
} from '../_shared/identity-vault-fixtures'

import { BridgePerspective } from './bridge-perspective'

export enum BridgeGraphNodeType {
  Graph = 'bridge',
}

export enum BridgeGraphEdgeType {
  GrantLanes = 'grant-lanes',
  SmoothStep = 'smoothstep',
}

export enum BridgeGraphDataKind {
  Device = 'device',
  Identity = 'identity',
  Stage = 'stage',
  Vault = 'vault',
}

export enum BridgeGraphPortMode {
  None = 'none',
  Source = 'source',
  Target = 'target',
  Both = 'both',
}

export enum BridgeGraphFlow {
  EvidenceTree = 'evidence-tree',
  Horizontal = 'horizontal',
  Tree = 'tree',
  Vertical = 'vertical',
}

export enum BridgeHandleType {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Source = 'source',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Target = 'target',
}

export enum BridgeIdentityPresentation {
  Hub = 'hub',
  Evidence = 'evidence',
}

export enum BridgeControlPosition {
  /** @public Passed through a Svelte component property; Knip cannot trace it. */
  TopRight = 'top-right',
}

type GraphInstallation = {
  id: string
  label: string
  publicKey: string
  added: string
}

type GraphDevice = {
  id: string
  label: string
  installations: GraphInstallation[]
}

type GraphDevices = GraphDevice[]

export type DeviceGraphData = {
  kind: BridgeGraphDataKind.Device
  portMode: BridgeGraphPortMode
  flow: BridgeGraphFlow
  label: string
  installations: GraphInstallation[]
}

export type IdentityGraphData = {
  kind: BridgeGraphDataKind.Identity
  portMode: BridgeGraphPortMode
  flow: BridgeGraphFlow
  presentation: BridgeIdentityPresentation
  id: string
  label: string
  description: string
  grantRole: string
  grantCount: number
  devices: GraphDevices
  keyCount: number
}

export type VaultGraphData = {
  kind: BridgeGraphDataKind.Vault
  portMode: BridgeGraphPortMode
  flow: BridgeGraphFlow
  id: string
  label: string
  description: string
  grantRole: string
  itemCount: number
}

export type StageGraphData = {
  kind: BridgeGraphDataKind.Stage
  portMode: BridgeGraphPortMode.None
  flow: BridgeGraphFlow
  label: string
}

export type BridgeGraphData =
  DeviceGraphData | IdentityGraphData | StageGraphData | VaultGraphData

export type BridgeGraphNode = Node<BridgeGraphData, BridgeGraphNodeType.Graph>

export type BridgeGraphEdgeData = { lane: number }

export type BridgeGraphEdge = Edge<BridgeGraphEdgeData, BridgeGraphEdgeType>

export type BridgeGraphDefinition = {
  nodes: BridgeGraphNode[]
  edges: BridgeGraphEdge[]
  compactHeight: number
}

type GraphNodeArgs = {
  id: string
  data: BridgeGraphData
  x: number
  y: number
  width: number
}

type StageNodeArgs = {
  id: string
  label: string
  flow: BridgeGraphFlow
  x: number
  y: number
  width: number
}

type GraphEdgeArgs = {
  id: string
  source: string
  target: string
  authorized: boolean
}

type CompactGrantEdgeArgs = {
  id: string
  source: string
  target: string
  sourceIndex: number
}

type BuildBridgeGraphArgs = {
  perspective: BridgePerspective
  identityId: string
  vaultId: string
  compact: boolean
}

/** Builds the identity and vault views of the same research fixture catalog. */
class ResearchIdentityBridge {
  private graphDevice(device: Identity['devices'][number]): GraphDevice {
    return {
      id: device.id,
      label: device.label,
      installations: device.installations.map((installation) => ({
        ...installation,
      })),
    }
  }

  private keyCount(devices: GraphDevices): number {
    let count = 0
    for (const device of devices) count += device.installations.length
    return count
  }

  private graphNode({ id, data, x, y, width }: GraphNodeArgs): BridgeGraphNode {
    return {
      id,
      type: BridgeGraphNodeType.Graph,
      position: { x, y },
      data,
      draggable: false,
      selectable: false,
      focusable: data.kind !== BridgeGraphDataKind.Stage,
      style: `width: ${width}px`,
    }
  }

  private stageNode({
    id,
    label,
    flow,
    x,
    y,
    width,
  }: StageNodeArgs): BridgeGraphNode {
    const stage: GraphNodeArgs = {
      id,
      x,
      y,
      width,
      data: {
        kind: BridgeGraphDataKind.Stage,
        portMode: BridgeGraphPortMode.None,
        flow,
        label,
      },
    }
    return this.graphNode(stage)
  }

  private graphEdge({
    id,
    source,
    target,
    authorized,
  }: GraphEdgeArgs): BridgeGraphEdge {
    const color = authorized ? '#ff6b3d' : '#777774'
    return {
      id,
      source,
      target,
      type: BridgeGraphEdgeType.SmoothStep,
      selectable: false,
      focusable: false,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 8, height: 8 },
      style: authorized
        ? `stroke: ${color}; stroke-width: 1.5px;`
        : `stroke: ${color}; stroke-width: 1.25px;`,
    }
  }

  private compactGrantEdge({
    id,
    source,
    target,
    sourceIndex,
  }: CompactGrantEdgeArgs): BridgeGraphEdge {
    const color = '#ff6b3d'
    return {
      id,
      source,
      target,
      type: BridgeGraphEdgeType.GrantLanes,
      data: { lane: sourceIndex },
      selectable: false,
      focusable: false,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 8, height: 8 },
      style: `stroke: ${color}; stroke-width: 1.5px;`,
    }
  }

  private buildIdentityGraph({
    identityId,
    compact,
  }: BuildBridgeGraphArgs): BridgeGraphDefinition {
    const identity = identityVaultFixtures.identityById(identityId)
    const grants = identityVaultFixtures.grantsForIdentity(identityId)
    const identityNodeId = `identity-${identity.id}`
    const flow = compact ? BridgeGraphFlow.Vertical : BridgeGraphFlow.Horizontal
    const deviceGap = 195
    const vaultGap = compact ? 190 : 205
    let nextDeviceY = 50
    const deviceNodes = [...identity.devices.entries()].map(
      ([index, device]) => {
        const args: GraphNodeArgs = {
          id: `device-${device.id}`,
          data: {
            kind: BridgeGraphDataKind.Device,
            portMode: BridgeGraphPortMode.Source,
            flow: compact
              ? BridgeGraphFlow.EvidenceTree
              : BridgeGraphFlow.Horizontal,
            label: device.label,
            installations: device.installations.map((installation) => ({
              ...installation,
            })),
          },
          x: compact ? 30 : 0,
          y: compact ? nextDeviceY : index * deviceGap,
          width: compact ? 270 : 280,
        }
        nextDeviceY += 89 + device.installations.length * 58
        return this.graphNode(args)
      },
    )

    const identityStageY = compact ? nextDeviceY + 18 : -58
    const identityY = compact
      ? identityStageY + 50
      : Math.max(70, ((deviceNodes.length - 1) * deviceGap) / 2)
    const vaultStageY = compact ? identityY + 200 : -58
    const vaultSpan = Math.max(0, (grants.length - 1) * vaultGap)
    const vaultStartY = compact
      ? vaultStageY + 50
      : Math.max(0, identityY - vaultSpan / 2)
    const devices = identity.devices.map(this.graphDevice)
    const hub: GraphNodeArgs = {
      id: identityNodeId,
      data: {
        kind: BridgeGraphDataKind.Identity,
        portMode: BridgeGraphPortMode.Both,
        flow,
        presentation: BridgeIdentityPresentation.Hub,
        id: identity.id,
        label: identity.label,
        description: identity.description,
        grantRole: 'Selected identity',
        grantCount: grants.length,
        devices,
        keyCount: this.keyCount(devices),
      },
      x: compact ? 40 : 350,
      y: identityY,
      width: 220,
    }

    const vaultNodes = [...grants.entries()].map(([index, grant]) => {
      const vault = identityVaultFixtures.vaultById(grant.vaultId)
      const args: GraphNodeArgs = {
        id: `vault-${vault.id}`,
        data: {
          kind: BridgeGraphDataKind.Vault,
          portMode: BridgeGraphPortMode.Target,
          flow: compact ? BridgeGraphFlow.Tree : BridgeGraphFlow.Horizontal,
          id: vault.id,
          label: vault.label,
          description: vault.description,
          grantRole: grant.role,
          itemCount: vault.itemCount,
        },
        x: compact ? 30 : 650,
        y: vaultStartY + index * vaultGap,
        width: compact ? 270 : 330,
      }
      return this.graphNode(args)
    })
    const evidenceEdges = identity.devices.map((device) => {
      const edge: GraphEdgeArgs = {
        id: `edge-${device.id}-${identity.id}`,
        source: `device-${device.id}`,
        target: identityNodeId,
        authorized: false,
      }
      return this.graphEdge(edge)
    })
    const grantEdges = [...grants.entries()].map(([index, grant]) => {
      const endpoints = {
        id: `edge-${identity.id}-${grant.vaultId}`,
        source: identityNodeId,
        target: `vault-${grant.vaultId}`,
      }
      if (compact) {
        const edge: CompactGrantEdgeArgs = { ...endpoints, sourceIndex: index }
        return this.compactGrantEdge(edge)
      }
      const edge: GraphEdgeArgs = { ...endpoints, authorized: true }
      return this.graphEdge(edge)
    })
    const stages: StageNodeArgs[] = [
      {
        id: 'stage-devices',
        label: 'Device evidence',
        flow,
        x: compact ? 30 : 0,
        y: compact ? 0 : -58,
        width: compact ? 270 : 280,
      },
      {
        id: 'stage-identity',
        label: 'Distributed identity',
        flow,
        x: compact ? 30 : 350,
        y: identityStageY,
        width: compact ? 270 : 220,
      },
      {
        id: 'stage-vaults',
        label: 'Vault grants',
        flow,
        x: compact ? 30 : 650,
        y: vaultStageY,
        width: compact ? 270 : 330,
      },
    ]
    return {
      nodes: [
        ...stages.map(this.stageNode.bind(this)),
        ...deviceNodes,
        this.graphNode(hub),
        ...vaultNodes,
      ],
      edges: [...evidenceEdges, ...grantEdges],
      compactHeight: compact ? vaultStartY + grants.length * vaultGap + 32 : 0,
    }
  }

  private buildVaultGraph({
    vaultId,
    compact,
  }: BuildBridgeGraphArgs): BridgeGraphDefinition {
    const vault = identityVaultFixtures.vaultById(vaultId)
    const grants = identityVaultFixtures.grantsForVault(vaultId)
    const identityGap = 420
    const identitySpan = Math.max(0, (grants.length - 1) * identityGap)
    const identityGroupWidth = identitySpan + 360
    const graphWidth = Math.max(780, identityGroupWidth)
    const vaultNodeId = `vault-${vault.id}`
    const vaultNode: GraphNodeArgs = {
      id: vaultNodeId,
      data: {
        kind: BridgeGraphDataKind.Vault,
        portMode: BridgeGraphPortMode.Source,
        flow: BridgeGraphFlow.Vertical,
        id: vault.id,
        label: vault.label,
        description: vault.description,
        grantRole: `${grants.length} ${grants.length === 1 ? 'grant' : 'grants'}`,
        itemCount: vault.itemCount,
      },
      x: compact ? 50 : (graphWidth - 340) / 2,
      y: compact ? 50 : 0,
      width: compact ? 300 : 340,
    }

    let nextIdentityY = 370
    const identityNodes = [...grants.entries()].map(([index, grant]) => {
      const identity = identityVaultFixtures.identityById(grant.identityId)
      const devices = identity.devices.map(this.graphDevice)
      const args: GraphNodeArgs = {
        id: `identity-${identity.id}`,
        data: {
          kind: BridgeGraphDataKind.Identity,
          portMode: BridgeGraphPortMode.Target,
          flow: compact ? BridgeGraphFlow.Tree : BridgeGraphFlow.Vertical,
          presentation: BridgeIdentityPresentation.Evidence,
          id: identity.id,
          label: identity.label,
          description: identity.description,
          grantRole: grant.role,
          grantCount: 0,
          devices,
          keyCount: this.keyCount(devices),
        },
        x: compact
          ? 30
          : (graphWidth - identityGroupWidth) / 2 + index * identityGap,
        y: compact ? nextIdentityY : 260,
        width: compact ? 270 : 360,
      }
      nextIdentityY += 235 + identity.devices.length * 58
      return this.graphNode(args)
    })

    const grantEdges = grants.map((grant) => {
      const edge: GraphEdgeArgs = {
        id: `edge-${vault.id}-${grant.identityId}`,
        source: vaultNodeId,
        target: `identity-${grant.identityId}`,
        authorized: true,
      }
      return this.graphEdge(edge)
    })
    const stages: StageNodeArgs[] = [
      {
        id: 'stage-selected-vault',
        label: 'Selected vault',
        flow: BridgeGraphFlow.Vertical,
        x: compact ? 0 : vaultNode.x,
        y: compact ? 0 : -58,
        width: vaultNode.width,
      },
      {
        id: 'stage-authorized-identities',
        label: 'Authorized identities',
        flow: BridgeGraphFlow.Vertical,
        x: compact ? 30 : (graphWidth - identityGroupWidth) / 2,
        y: compact ? 320 : 194,
        width: compact ? 270 : identityGroupWidth,
      },
    ]
    return {
      nodes: [
        ...stages.map(this.stageNode.bind(this)),
        this.graphNode(vaultNode),
        ...identityNodes,
      ],
      edges: grantEdges,
      compactHeight: compact ? nextIdentityY + 24 : 0,
    }
  }

  buildBridgeGraph(request: BuildBridgeGraphArgs): BridgeGraphDefinition {
    if (request.perspective === BridgePerspective.Identities)
      return this.buildIdentityGraph(request)
    return this.buildVaultGraph(request)
  }
}

export const researchIdentityBridge = new ResearchIdentityBridge()
