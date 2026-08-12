import { MarkerType, type Edge, type Node } from '@xyflow/svelte'
import {
  grantsForIdentity,
  grantsForVault,
  identityById,
  vaultById,
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
  devices: GraphDevice[]
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

function graphDevice(
  device: ReturnType<typeof identityById>['devices'][number],
): GraphDevice {
  return {
    id: device.id,
    label: device.label,
    installations: device.installations.map((installation) => ({
      ...installation,
    })),
  }
}

type GraphNodeArgs = {
  id: string
  data: BridgeGraphData
  x: number
  y: number
  width: number
}

function graphNode({ id, data, x, y, width }: GraphNodeArgs): BridgeGraphNode {
  return {
    id,
    type: BridgeGraphNodeType.Graph,
    position: { x, y },
    data,
    draggable: false,
    selectable: false,
    focusable: true,
    style: `width: ${width}px`,
  }
}

type StageNodeArgs = {
  id: string
  label: string
  flow: BridgeGraphFlow
  x: number
  y: number
  width: number
}

function stageNode({
  id,
  label,
  flow,
  x,
  y,
  width,
}: StageNodeArgs): BridgeGraphNode {
  return {
    id,
    type: BridgeGraphNodeType.Graph,
    position: { x, y },
    data: {
      kind: BridgeGraphDataKind.Stage,
      portMode: BridgeGraphPortMode.None,
      flow,
      label,
    },
    draggable: false,
    selectable: false,
    focusable: false,
    style: `width: ${width}px`,
  }
}

type GraphEdgeArgs = {
  id: string
  source: string
  target: string
  authorized: boolean
}

function graphEdge({
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

type CompactGrantEdgeArgs = {
  id: string
  source: string
  target: string
  sourceIndex: number
}

function compactGrantEdge({
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

function buildIdentityGraph(identityId: string): BridgeGraphDefinition {
  const identity = identityById(identityId)
  const grants = grantsForIdentity(identityId)
  let keyCount = 0
  for (const device of identity.devices) keyCount += device.installations.length
  const deviceGap = 195
  const vaultGap = 205
  const deviceSpan = Math.max(0, (identity.devices.length - 1) * deviceGap)
  const vaultSpan = Math.max(0, (grants.length - 1) * vaultGap)
  const identityY = Math.max(70, deviceSpan / 2)
  const vaultStartY = Math.max(0, identityY - vaultSpan / 2)
  const identityNodeId = `identity-${identity.id}`

  const deviceNodes = [...identity.devices.entries()].map(([index, device]) => {
    const nookNamedArgument2: Parameters<typeof graphNode>[0] = {
      id: `device-${device.id}`,
      data: {
        kind: BridgeGraphDataKind.Device,
        portMode: BridgeGraphPortMode.Source,
        flow: BridgeGraphFlow.Horizontal,
        label: device.label,
        installations: device.installations.map((installation) => ({
          ...installation,
        })),
      },
      x: 0,
      y: index * deviceGap,
      width: 280,
    }
    return graphNode(nookNamedArgument2)
  })

  const nookNamedArgs0_0: Parameters<typeof graphNode>[0] = {
    id: identityNodeId,
    data: {
      kind: BridgeGraphDataKind.Identity,
      portMode: BridgeGraphPortMode.Both,
      flow: BridgeGraphFlow.Horizontal,
      presentation: BridgeIdentityPresentation.Hub,
      id: identity.id,
      label: identity.label,
      description: identity.description,
      grantRole: 'Selected identity',
      grantCount: grants.length,
      devices: identity.devices.map(graphDevice),
      keyCount,
    },
    x: 350,
    y: identityY,
    width: 220,
  }
  const identityNode = graphNode(nookNamedArgs0_0)

  const vaultNodes = [...grants.entries()].map(([index, grant]) => {
    const vault = vaultById(grant.vaultId)
    const nookNamedArgs0_1: Parameters<typeof graphNode>[0] = {
      id: `vault-${vault.id}`,
      data: {
        kind: BridgeGraphDataKind.Vault,
        portMode: BridgeGraphPortMode.Target,
        flow: BridgeGraphFlow.Horizontal,
        id: vault.id,
        label: vault.label,
        description: vault.description,
        grantRole: grant.role,
        itemCount: vault.itemCount,
      },
      x: 650,
      y: vaultStartY + index * vaultGap,
      width: 330,
    }
    return graphNode(nookNamedArgs0_1)
  })

  const evidenceEdges = identity.devices.map((device) => {
    const nookNamedArgument3: Parameters<typeof graphEdge>[0] = {
      id: `edge-${device.id}-${identity.id}`,
      source: `device-${device.id}`,
      target: identityNodeId,
      authorized: false,
    }
    return graphEdge(nookNamedArgument3)
  })
  const grantEdges = grants.map((grant) => {
    const nookNamedArgument4: Parameters<typeof graphEdge>[0] = {
      id: `edge-${identity.id}-${grant.vaultId}`,
      source: identityNodeId,
      target: `vault-${grant.vaultId}`,
      authorized: true,
    }
    return graphEdge(nookNamedArgument4)
  })

  const nookNamedArgs0_2: Parameters<typeof stageNode>[0] = {
    id: 'stage-devices',
    label: 'Device evidence',
    flow: BridgeGraphFlow.Horizontal,
    x: 0,
    y: -58,
    width: 280,
  }
  const nookNamedArgs0_3: Parameters<typeof stageNode>[0] = {
    id: 'stage-identity',
    label: 'Distributed identity',
    flow: BridgeGraphFlow.Horizontal,
    x: 350,
    y: -58,
    width: 220,
  }
  const nookNamedArgs0_4: Parameters<typeof stageNode>[0] = {
    id: 'stage-vaults',
    label: 'Vault grants',
    flow: BridgeGraphFlow.Horizontal,
    x: 650,
    y: -58,
    width: 330,
  }
  const stageNodes = [
    stageNode(nookNamedArgs0_2),
    stageNode(nookNamedArgs0_3),
    stageNode(nookNamedArgs0_4),
  ]

  return {
    nodes: [...stageNodes, ...deviceNodes, identityNode, ...vaultNodes],
    edges: [...evidenceEdges, ...grantEdges],
    compactHeight: 0,
  }
}

function buildCompactIdentityGraph(identityId: string): BridgeGraphDefinition {
  const identity = identityById(identityId)
  const grants = grantsForIdentity(identityId)
  let keyCount = 0
  for (const device of identity.devices) keyCount += device.installations.length
  const identityNodeId = `identity-${identity.id}`
  let deviceY = 50
  const deviceNodes = identity.devices.map((device) => {
    const nookNamedArgs0_5: Parameters<typeof graphNode>[0] = {
      id: `device-${device.id}`,
      data: {
        kind: BridgeGraphDataKind.Device,
        portMode: BridgeGraphPortMode.Source,
        flow: BridgeGraphFlow.EvidenceTree,
        label: device.label,
        installations: device.installations.map((installation) => ({
          ...installation,
        })),
      },
      x: 30,
      y: deviceY,
      width: 270,
    }
    const node = graphNode(nookNamedArgs0_5)
    deviceY += 89 + device.installations.length * 58
    return node
  })
  const identityStageY = deviceY + 18
  const identityY = identityStageY + 50
  const vaultStageY = identityY + 200
  const vaultStartY = vaultStageY + 50
  const nookNamedArgs0_6: Parameters<typeof graphNode>[0] = {
    id: identityNodeId,
    data: {
      kind: BridgeGraphDataKind.Identity,
      portMode: BridgeGraphPortMode.Both,
      flow: BridgeGraphFlow.Vertical,
      presentation: BridgeIdentityPresentation.Hub,
      id: identity.id,
      label: identity.label,
      description: identity.description,
      grantRole: 'Selected identity',
      grantCount: grants.length,
      devices: identity.devices.map(graphDevice),
      keyCount,
    },
    x: 40,
    y: identityY,
    width: 220,
  }
  const identityNode = graphNode(nookNamedArgs0_6)
  const vaultNodes = [...grants.entries()].map(([index, grant]) => {
    const vault = vaultById(grant.vaultId)
    const nookNamedArgs0_7: Parameters<typeof graphNode>[0] = {
      id: `vault-${vault.id}`,
      data: {
        kind: BridgeGraphDataKind.Vault,
        portMode: BridgeGraphPortMode.Target,
        flow: BridgeGraphFlow.Tree,
        id: vault.id,
        label: vault.label,
        description: vault.description,
        grantRole: grant.role,
        itemCount: vault.itemCount,
      },
      x: 30,
      y: vaultStartY + index * 190,
      width: 270,
    }
    return graphNode(nookNamedArgs0_7)
  })
  const evidenceEdges = identity.devices.map((device) => {
    const nookNamedArgument5: Parameters<typeof graphEdge>[0] = {
      id: `edge-${device.id}-${identity.id}`,
      source: `device-${device.id}`,
      target: identityNodeId,
      authorized: false,
    }
    return graphEdge(nookNamedArgument5)
  })
  const grantEdges = [...grants.entries()].map(([index, grant]) => {
    const nookNamedArgument6: Parameters<typeof compactGrantEdge>[0] = {
      id: `edge-${identity.id}-${grant.vaultId}`,
      source: identityNodeId,
      target: `vault-${grant.vaultId}`,
      sourceIndex: index,
    }
    return compactGrantEdge(nookNamedArgument6)
  })

  const nookNamedArgs0_8: Parameters<typeof stageNode>[0] = {
    id: 'stage-devices',
    label: 'Device evidence',
    flow: BridgeGraphFlow.Vertical,
    x: 30,
    y: 0,
    width: 270,
  }
  const nookNamedArgs0_9: Parameters<typeof stageNode>[0] = {
    id: 'stage-identity',
    label: 'Distributed identity',
    flow: BridgeGraphFlow.Vertical,
    x: 30,
    y: identityStageY,
    width: 270,
  }
  const nookNamedArgs0_10: Parameters<typeof stageNode>[0] = {
    id: 'stage-vaults',
    label: 'Vault grants',
    flow: BridgeGraphFlow.Vertical,
    x: 30,
    y: vaultStageY,
    width: 270,
  }
  const stageNodes = [
    stageNode(nookNamedArgs0_8),
    stageNode(nookNamedArgs0_9),
    stageNode(nookNamedArgs0_10),
  ]

  return {
    nodes: [...stageNodes, ...deviceNodes, identityNode, ...vaultNodes],
    edges: [...evidenceEdges, ...grantEdges],
    compactHeight: vaultStartY + grants.length * 190 + 32,
  }
}

function buildVaultGraph(vaultId: string): BridgeGraphDefinition {
  const vault = vaultById(vaultId)
  const grants = grantsForVault(vaultId)
  const identityGap = 420
  const identitySpan = Math.max(0, (grants.length - 1) * identityGap)
  const identityGroupWidth = identitySpan + 360
  const graphWidth = Math.max(780, identityGroupWidth)
  const vaultNodeId = `vault-${vault.id}`

  const nookNamedArgs0_11: Parameters<typeof graphNode>[0] = {
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
    x: (graphWidth - 340) / 2,
    y: 0,
    width: 340,
  }
  const vaultNode = graphNode(nookNamedArgs0_11)

  const identityNodes = [...grants.entries()].map(([index, grant]) => {
    const identity = identityById(grant.identityId)
    let keyCount = 0
    for (const device of identity.devices)
      keyCount += device.installations.length
    const nookNamedArgs0_12: Parameters<typeof graphNode>[0] = {
      id: `identity-${identity.id}`,
      data: {
        kind: BridgeGraphDataKind.Identity,
        portMode: BridgeGraphPortMode.Target,
        flow: BridgeGraphFlow.Vertical,
        presentation: BridgeIdentityPresentation.Evidence,
        id: identity.id,
        label: identity.label,
        description: identity.description,
        grantRole: grant.role,
        grantCount: 0,
        devices: identity.devices.map(graphDevice),
        keyCount,
      },
      x: (graphWidth - identitySpan - 360) / 2 + index * identityGap,
      y: 260,
      width: 360,
    }
    return graphNode(nookNamedArgs0_12)
  })

  const grantEdges = grants.map((grant) => {
    const nookNamedArgument7: Parameters<typeof graphEdge>[0] = {
      id: `edge-${vault.id}-${grant.identityId}`,
      source: vaultNodeId,
      target: `identity-${grant.identityId}`,
      authorized: true,
    }
    return graphEdge(nookNamedArgument7)
  })

  const nookNamedArgs0_13: Parameters<typeof stageNode>[0] = {
    id: 'stage-selected-vault',
    label: 'Selected vault',
    flow: BridgeGraphFlow.Vertical,
    x: (graphWidth - 340) / 2,
    y: -58,
    width: 340,
  }
  const nookNamedArgs0_14: Parameters<typeof stageNode>[0] = {
    id: 'stage-authorized-identities',
    label: 'Authorized identities',
    flow: BridgeGraphFlow.Vertical,
    x: (graphWidth - identityGroupWidth) / 2,
    y: 194,
    width: identityGroupWidth,
  }
  const stageNodes = [
    stageNode(nookNamedArgs0_13),
    stageNode(nookNamedArgs0_14),
  ]

  return {
    nodes: [...stageNodes, vaultNode, ...identityNodes],
    edges: grantEdges,
    compactHeight: 0,
  }
}

function buildCompactVaultGraph(vaultId: string): BridgeGraphDefinition {
  const vault = vaultById(vaultId)
  const grants = grantsForVault(vaultId)
  const vaultNodeId = `vault-${vault.id}`
  const nookNamedArgs0_15: Parameters<typeof graphNode>[0] = {
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
    x: 50,
    y: 50,
    width: 300,
  }
  const vaultNode = graphNode(nookNamedArgs0_15)
  let identityY = 370
  const identityNodes = grants.map((grant) => {
    const identity = identityById(grant.identityId)
    let keyCount = 0
    for (const device of identity.devices)
      keyCount += device.installations.length
    const nookNamedArgs0_16: Parameters<typeof graphNode>[0] = {
      id: `identity-${identity.id}`,
      data: {
        kind: BridgeGraphDataKind.Identity,
        portMode: BridgeGraphPortMode.Target,
        flow: BridgeGraphFlow.Tree,
        presentation: BridgeIdentityPresentation.Evidence,
        id: identity.id,
        label: identity.label,
        description: identity.description,
        grantRole: grant.role,
        grantCount: 0,
        devices: identity.devices.map(graphDevice),
        keyCount,
      },
      x: 30,
      y: identityY,
      width: 270,
    }
    const node = graphNode(nookNamedArgs0_16)
    identityY += 235 + identity.devices.length * 58
    return node
  })
  const grantEdges = grants.map((grant) => {
    const nookNamedArgument8: Parameters<typeof graphEdge>[0] = {
      id: `edge-${vault.id}-${grant.identityId}`,
      source: vaultNodeId,
      target: `identity-${grant.identityId}`,
      authorized: true,
    }
    return graphEdge(nookNamedArgument8)
  })

  const nookNamedArgs0_17: Parameters<typeof stageNode>[0] = {
    id: 'stage-selected-vault',
    label: 'Selected vault',
    flow: BridgeGraphFlow.Vertical,
    x: 0,
    y: 0,
    width: 300,
  }
  const nookNamedArgs0_18: Parameters<typeof stageNode>[0] = {
    id: 'stage-authorized-identities',
    label: 'Authorized identities',
    flow: BridgeGraphFlow.Vertical,
    x: 30,
    y: 320,
    width: 270,
  }
  const stageNodes = [
    stageNode(nookNamedArgs0_17),
    stageNode(nookNamedArgs0_18),
  ]

  return {
    nodes: [...stageNodes, vaultNode, ...identityNodes],
    edges: grantEdges,
    compactHeight: identityY + 24,
  }
}

type BuildBridgeGraphArgs = {
  perspective: BridgePerspective
  identityId: string
  vaultId: string
  compact: boolean
}

export function buildBridgeGraph({
  perspective,
  identityId,
  vaultId,
  compact,
}: BuildBridgeGraphArgs): BridgeGraphDefinition {
  if (compact && perspective === BridgePerspective.Identities) {
    return buildCompactIdentityGraph(identityId)
  }
  if (compact) return buildCompactVaultGraph(vaultId)
  if (perspective === BridgePerspective.Identities)
    return buildIdentityGraph(identityId)
  return buildVaultGraph(vaultId)
}
