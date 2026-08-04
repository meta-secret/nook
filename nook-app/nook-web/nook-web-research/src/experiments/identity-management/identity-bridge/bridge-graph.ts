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
  | DeviceGraphData
  | IdentityGraphData
  | StageGraphData
  | VaultGraphData
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

function graphNode(
  id: string,
  data: BridgeGraphData,
  x: number,
  y: number,
  width: number,
): BridgeGraphNode {
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

function stageNode(
  id: string,
  label: string,
  flow: BridgeGraphFlow,
  x: number,
  y: number,
  width: number,
): BridgeGraphNode {
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

function graphEdge(
  id: string,
  source: string,
  target: string,
  authorized: boolean,
): BridgeGraphEdge {
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

function compactGrantEdge(
  id: string,
  source: string,
  target: string,
  sourceIndex: number,
): BridgeGraphEdge {
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
  const keyCount = identity.devices.reduce(
    (total, device) => total + device.installations.length,
    0,
  )
  const deviceGap = 195
  const vaultGap = 205
  const deviceSpan = Math.max(0, (identity.devices.length - 1) * deviceGap)
  const vaultSpan = Math.max(0, (grants.length - 1) * vaultGap)
  const identityY = Math.max(70, deviceSpan / 2)
  const vaultStartY = Math.max(0, identityY - vaultSpan / 2)
  const identityNodeId = `identity-${identity.id}`

  const deviceNodes = identity.devices.map((device, index) =>
    graphNode(
      `device-${device.id}`,
      {
        kind: BridgeGraphDataKind.Device,
        portMode: BridgeGraphPortMode.Source,
        flow: BridgeGraphFlow.Horizontal,
        label: device.label,
        installations: device.installations.map((installation) => ({
          ...installation,
        })),
      },
      0,
      index * deviceGap,
      280,
    ),
  )

  const identityNode = graphNode(
    identityNodeId,
    {
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
    350,
    identityY,
    220,
  )

  const vaultNodes = grants.map((grant, index) => {
    const vault = vaultById(grant.vaultId)
    return graphNode(
      `vault-${vault.id}`,
      {
        kind: BridgeGraphDataKind.Vault,
        portMode: BridgeGraphPortMode.Target,
        flow: BridgeGraphFlow.Horizontal,
        id: vault.id,
        label: vault.label,
        description: vault.description,
        grantRole: grant.role,
        itemCount: vault.itemCount,
      },
      650,
      vaultStartY + index * vaultGap,
      330,
    )
  })

  const evidenceEdges = identity.devices.map((device) =>
    graphEdge(
      `edge-${device.id}-${identity.id}`,
      `device-${device.id}`,
      identityNodeId,
      false,
    ),
  )
  const grantEdges = grants.map((grant) =>
    graphEdge(
      `edge-${identity.id}-${grant.vaultId}`,
      identityNodeId,
      `vault-${grant.vaultId}`,
      true,
    ),
  )

  const stageNodes = [
    stageNode(
      'stage-devices',
      'Device evidence',
      BridgeGraphFlow.Horizontal,
      0,
      -58,
      280,
    ),
    stageNode(
      'stage-identity',
      'Distributed identity',
      BridgeGraphFlow.Horizontal,
      350,
      -58,
      220,
    ),
    stageNode(
      'stage-vaults',
      'Vault grants',
      BridgeGraphFlow.Horizontal,
      650,
      -58,
      330,
    ),
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
  const keyCount = identity.devices.reduce(
    (total, device) => total + device.installations.length,
    0,
  )
  const identityNodeId = `identity-${identity.id}`
  let deviceY = 50
  const deviceNodes = identity.devices.map((device) => {
    const node = graphNode(
      `device-${device.id}`,
      {
        kind: BridgeGraphDataKind.Device,
        portMode: BridgeGraphPortMode.Source,
        flow: BridgeGraphFlow.EvidenceTree,
        label: device.label,
        installations: device.installations.map((installation) => ({
          ...installation,
        })),
      },
      30,
      deviceY,
      270,
    )
    deviceY += 89 + device.installations.length * 58
    return node
  })
  const identityStageY = deviceY + 18
  const identityY = identityStageY + 50
  const vaultStageY = identityY + 200
  const vaultStartY = vaultStageY + 50
  const identityNode = graphNode(
    identityNodeId,
    {
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
    40,
    identityY,
    220,
  )
  const vaultNodes = grants.map((grant, index) => {
    const vault = vaultById(grant.vaultId)
    return graphNode(
      `vault-${vault.id}`,
      {
        kind: BridgeGraphDataKind.Vault,
        portMode: BridgeGraphPortMode.Target,
        flow: BridgeGraphFlow.Tree,
        id: vault.id,
        label: vault.label,
        description: vault.description,
        grantRole: grant.role,
        itemCount: vault.itemCount,
      },
      30,
      vaultStartY + index * 190,
      270,
    )
  })
  const evidenceEdges = identity.devices.map((device) =>
    graphEdge(
      `edge-${device.id}-${identity.id}`,
      `device-${device.id}`,
      identityNodeId,
      false,
    ),
  )
  const grantEdges = grants.map((grant, index) =>
    compactGrantEdge(
      `edge-${identity.id}-${grant.vaultId}`,
      identityNodeId,
      `vault-${grant.vaultId}`,
      index,
    ),
  )

  const stageNodes = [
    stageNode(
      'stage-devices',
      'Device evidence',
      BridgeGraphFlow.Vertical,
      30,
      0,
      270,
    ),
    stageNode(
      'stage-identity',
      'Distributed identity',
      BridgeGraphFlow.Vertical,
      30,
      identityStageY,
      270,
    ),
    stageNode(
      'stage-vaults',
      'Vault grants',
      BridgeGraphFlow.Vertical,
      30,
      vaultStageY,
      270,
    ),
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

  const vaultNode = graphNode(
    vaultNodeId,
    {
      kind: BridgeGraphDataKind.Vault,
      portMode: BridgeGraphPortMode.Source,
      flow: BridgeGraphFlow.Vertical,
      id: vault.id,
      label: vault.label,
      description: vault.description,
      grantRole: `${grants.length} ${grants.length === 1 ? 'grant' : 'grants'}`,
      itemCount: vault.itemCount,
    },
    (graphWidth - 340) / 2,
    0,
    340,
  )

  const identityNodes = grants.map((grant, index) => {
    const identity = identityById(grant.identityId)
    const keyCount = identity.devices.reduce(
      (total, device) => total + device.installations.length,
      0,
    )
    return graphNode(
      `identity-${identity.id}`,
      {
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
      (graphWidth - identitySpan - 360) / 2 + index * identityGap,
      260,
      360,
    )
  })

  const grantEdges = grants.map((grant) =>
    graphEdge(
      `edge-${vault.id}-${grant.identityId}`,
      vaultNodeId,
      `identity-${grant.identityId}`,
      true,
    ),
  )

  const stageNodes = [
    stageNode(
      'stage-selected-vault',
      'Selected vault',
      BridgeGraphFlow.Vertical,
      (graphWidth - 340) / 2,
      -58,
      340,
    ),
    stageNode(
      'stage-authorized-identities',
      'Authorized identities',
      BridgeGraphFlow.Vertical,
      (graphWidth - identityGroupWidth) / 2,
      194,
      identityGroupWidth,
    ),
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
  const vaultNode = graphNode(
    vaultNodeId,
    {
      kind: BridgeGraphDataKind.Vault,
      portMode: BridgeGraphPortMode.Source,
      flow: BridgeGraphFlow.Vertical,
      id: vault.id,
      label: vault.label,
      description: vault.description,
      grantRole: `${grants.length} ${grants.length === 1 ? 'grant' : 'grants'}`,
      itemCount: vault.itemCount,
    },
    50,
    0,
    300,
  )
  let identityY = 320
  const identityNodes = grants.map((grant) => {
    const identity = identityById(grant.identityId)
    const keyCount = identity.devices.reduce(
      (total, device) => total + device.installations.length,
      0,
    )
    const node = graphNode(
      `identity-${identity.id}`,
      {
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
      30,
      identityY,
      270,
    )
    identityY += 235 + identity.devices.length * 58
    return node
  })
  const grantEdges = grants.map((grant) =>
    graphEdge(
      `edge-${vault.id}-${grant.identityId}`,
      vaultNodeId,
      `identity-${grant.identityId}`,
      true,
    ),
  )

  const stageNodes = [
    stageNode(
      'stage-selected-vault',
      'Selected vault',
      BridgeGraphFlow.Vertical,
      0,
      0,
      300,
    ),
    stageNode(
      'stage-authorized-identities',
      'Authorized identities',
      BridgeGraphFlow.Vertical,
      30,
      270,
      270,
    ),
  ]

  return {
    nodes: [...stageNodes, vaultNode, ...identityNodes],
    edges: grantEdges,
    compactHeight: identityY + 24,
  }
}

export function buildBridgeGraph(
  perspective: BridgePerspective,
  identityId: string,
  vaultId: string,
  compact: boolean,
): BridgeGraphDefinition {
  if (compact && perspective === BridgePerspective.Identities) {
    return buildCompactIdentityGraph(identityId)
  }
  if (compact) return buildCompactVaultGraph(vaultId)
  if (perspective === BridgePerspective.Identities)
    return buildIdentityGraph(identityId)
  return buildVaultGraph(vaultId)
}
