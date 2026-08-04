import { MarkerType, type Edge, type Node } from "@xyflow/svelte";
import type { DeviceAccessIdentityState } from "$app-wasm";
import type { VaultAccessView } from "./access-chain";
import { DashboardTextKind } from "../devices-access-dashboard-state";

export enum IdentityBridgePerspective {
  Identities = "identities",
  Vaults = "vaults",
}

export enum IdentityBridgeNodeKind {
  Device = "device",
  Identity = "identity",
  Stage = "stage",
  Vault = "vault",
  Empty = "empty",
}

export enum IdentityBridgeFlow {
  Horizontal = "horizontal",
  Vertical = "vertical",
}

export enum IdentityBridgePortMode {
  None = "none",
  Source = "source",
  Target = "target",
  Both = "both",
}

export enum IdentityBridgeNodeType {
  Bridge = "identity-bridge",
}

export enum IdentityBridgeEdgeType {
  SmoothStep = "smoothstep",
}

export enum IdentityBridgeRelationKind {
  Evidence = "evidence",
  VerifiedDeviceAccess = "verified-device-access",
}

export enum IdentityBridgeDeviceIconKind {
  Browser = "browser",
  PairedDevice = "paired-device",
}

export enum IdentityBridgeHandleType {
  Source = "source",
  Target = "target",
}

export enum IdentityBridgeHandleId {
  VaultAccess = "vault-access",
}

export enum IdentityBridgeControlPosition {
  TopRight = "top-right",
}

export enum IdentityBridgeVaultSelectionKind {
  Empty = "empty",
  Selected = "selected",
}

export type IdentityBridgeVaultSelection =
  | { kind: typeof IdentityBridgeVaultSelectionKind.Empty }
  | {
      kind: typeof IdentityBridgeVaultSelectionKind.Selected;
      storeId: string;
    };

export type IdentityBridgeInstallation = {
  id: string;
  label: string;
  detail: string;
};

export type IdentityBridgeDeviceData = {
  kind: typeof IdentityBridgeNodeKind.Device;
  flow: IdentityBridgeFlow;
  portMode: IdentityBridgePortMode;
  label: string;
  caption: string;
  countLabel: string;
  installations: IdentityBridgeInstallation[];
  iconKind: IdentityBridgeDeviceIconKind;
  lateralAccessPort: boolean;
};

export type IdentityBridgeIdentityData = {
  kind: typeof IdentityBridgeNodeKind.Identity;
  flow: IdentityBridgeFlow;
  portMode: IdentityBridgePortMode;
  label: string;
  caption: string;
  description: string;
  identifier: string;
  stateLabel: string;
  identityStatus: DeviceAccessIdentityState;
  deviceMetricLabel: string;
  deviceMetricValue: string;
  vaultMetricLabel: string;
  vaultMetricValue: string;
  identifierLabel: string;
};

export type IdentityBridgeVaultData = {
  kind: typeof IdentityBridgeNodeKind.Vault;
  flow: IdentityBridgeFlow;
  portMode: IdentityBridgePortMode;
  label: string;
  caption: string;
  description: string;
  identifier: string;
  statusLabel: string;
  evidenceLabel: string;
  statusMetricLabel: string;
  evidenceMetricLabel: string;
  identifierLabel: string;
  verifiedDeviceAccess: boolean;
  lateralAccessPort: boolean;
};

export type IdentityBridgeStageData = {
  kind: typeof IdentityBridgeNodeKind.Stage;
  flow: IdentityBridgeFlow;
  portMode: typeof IdentityBridgePortMode.None;
  label: string;
};

export type IdentityBridgeEmptyData = {
  kind: typeof IdentityBridgeNodeKind.Empty;
  flow: IdentityBridgeFlow;
  portMode: typeof IdentityBridgePortMode.None;
  label: string;
  description: string;
};

export type IdentityBridgeNodeData =
  | IdentityBridgeDeviceData
  | IdentityBridgeIdentityData
  | IdentityBridgeVaultData
  | IdentityBridgeStageData
  | IdentityBridgeEmptyData;

export type IdentityBridgeNode = Node<
  IdentityBridgeNodeData,
  IdentityBridgeNodeType.Bridge
>;
export type IdentityBridgeEdge = Edge<Record<string, never>>;

export type IdentityBridgeCopy = {
  deviceStage: string;
  identityStage: string;
  vaultStage: string;
  selectedVaultStage: string;
  authorizedIdentitiesStage: string;
  currentDevice: string;
  currentIdentity: string;
  selectedIdentity: string;
  vaultGrant: string;
  deviceKey: string;
  oneDeviceKey: string;
  identityDescription: string;
  identityState: string;
  identityIdentifier: string;
  deviceMetricLabel: string;
  oneDevice: string;
  vaultMetricLabel: string;
  verifiedVaultCount: string;
  statusMetricLabel: string;
  evidenceMetricLabel: string;
  vaultIdentifierLabel: string;
  verifiedStatus: string;
  unverifiedStatus: string;
  noAuthorizedIdentity: string;
  noAuthorizedIdentityDescription: string;
  noVerifiedVaults: string;
  noVerifiedVaultsDescription: string;
  noSelectedVault: string;
  noSelectedVaultDescription: string;
  deviceIdentityRelation: string;
  deviceVaultRelation: (vaultLabel: string) => string;
  vaultIdentityRelation: (vaultLabel: string) => string;
  unknown: string;
};

export type IdentityBridgeInput = {
  perspective: IdentityBridgePerspective;
  selectedVault: IdentityBridgeVaultSelection;
  compact: boolean;
  deviceIdentifier: string;
  identityIdentifier: string;
  identityStatus: DeviceAccessIdentityState;
  protectionLabel: string;
  deviceIconKind: IdentityBridgeDeviceIconKind;
  vaults: readonly VaultAccessView[];
  copy: IdentityBridgeCopy;
};

export type IdentityBridgeDefinition = {
  nodes: IdentityBridgeNode[];
  edges: IdentityBridgeEdge[];
  compactHeight: number;
};

function graphNode(
  id: string,
  data: IdentityBridgeNodeData,
  x: number,
  y: number,
  width: number,
): IdentityBridgeNode {
  return {
    id,
    type: IdentityBridgeNodeType.Bridge,
    position: { x, y },
    data,
    draggable: false,
    selectable: false,
    focusable: data.kind !== IdentityBridgeNodeKind.Stage,
    style: `width: ${width}px`,
  };
}

function stageNode(
  id: string,
  label: string,
  flow: IdentityBridgeFlow,
  x: number,
  y: number,
  width: number,
): IdentityBridgeNode {
  return graphNode(
    id,
    {
      kind: IdentityBridgeNodeKind.Stage,
      flow,
      portMode: IdentityBridgePortMode.None,
      label,
    },
    x,
    y,
    width,
  );
}

function graphEdge(
  id: string,
  source: string,
  target: string,
  relation: IdentityBridgeRelationKind,
  ariaLabel: string,
  lateralAccessPort = false,
): IdentityBridgeEdge {
  const verified = relation === IdentityBridgeRelationKind.VerifiedDeviceAccess;
  const color = verified
    ? "var(--primary)"
    : "color-mix(in oklab, var(--foreground) 44%, transparent)";
  return {
    id,
    source,
    target,
    ...(lateralAccessPort
      ? {
          sourceHandle: IdentityBridgeHandleId.VaultAccess,
          targetHandle: IdentityBridgeHandleId.VaultAccess,
        }
      : {}),
    type: IdentityBridgeEdgeType.SmoothStep,
    selectable: false,
    focusable: false,
    ariaLabel,
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 8, height: 8 },
    style: `stroke: ${color}; stroke-width: ${verified ? 1.6 : 1.2}px;`,
  };
}

function identityData(
  input: IdentityBridgeInput,
  flow: IdentityBridgeFlow,
  portMode: IdentityBridgePortMode,
): IdentityBridgeIdentityData {
  return {
    kind: IdentityBridgeNodeKind.Identity,
    flow,
    portMode,
    label: input.copy.currentIdentity,
    caption: input.copy.selectedIdentity,
    description: input.copy.identityDescription,
    identifier: input.identityIdentifier,
    stateLabel: input.copy.identityState,
    identityStatus: input.identityStatus,
    deviceMetricLabel: input.copy.deviceMetricLabel,
    deviceMetricValue: input.copy.oneDevice,
    vaultMetricLabel: input.copy.vaultMetricLabel,
    vaultMetricValue: input.copy.verifiedVaultCount,
    identifierLabel: input.copy.identityIdentifier,
  };
}

function vaultData(
  vault: VaultAccessView,
  input: IdentityBridgeInput,
  flow: IdentityBridgeFlow,
  portMode: IdentityBridgePortMode,
  lateralAccessPort = false,
): IdentityBridgeVaultData {
  return {
    kind: IdentityBridgeNodeKind.Vault,
    flow,
    portMode,
    label: vault.label,
    caption: input.copy.vaultGrant,
    description: vault.verified
      ? input.copy.verifiedStatus
      : input.copy.unverifiedStatus,
    identifier: vault.storeId,
    statusLabel: vault.verified
      ? input.copy.verifiedStatus
      : input.copy.unverifiedStatus,
    evidenceLabel:
      vault.verifiedAt.kind === DashboardTextKind.Known
        ? vault.verifiedAt.value
        : input.copy.unknown,
    statusMetricLabel: input.copy.statusMetricLabel,
    evidenceMetricLabel: input.copy.evidenceMetricLabel,
    identifierLabel: input.copy.vaultIdentifierLabel,
    verifiedDeviceAccess: vault.verified,
    lateralAccessPort,
  };
}

function deviceData(
  input: IdentityBridgeInput,
  flow: IdentityBridgeFlow,
): IdentityBridgeDeviceData {
  return {
    kind: IdentityBridgeNodeKind.Device,
    flow,
    portMode: IdentityBridgePortMode.Source,
    label: input.copy.currentDevice,
    caption: input.copy.deviceStage,
    countLabel: input.copy.oneDeviceKey,
    iconKind: input.deviceIconKind,
    lateralAccessPort: flow === IdentityBridgeFlow.Vertical,
    installations: [
      {
        id: input.deviceIdentifier,
        label: input.copy.deviceKey,
        detail: input.protectionLabel,
      },
    ],
  };
}

function identityGraph(input: IdentityBridgeInput): IdentityBridgeDefinition {
  const verifiedVaults = input.vaults.filter((vault) => vault.verified);
  if (input.compact) {
    const identityY = 300;
    const vaultStartY = 590;
    const vaultNodes = verifiedVaults.map((vault, index) =>
      graphNode(
        `vault-${vault.storeId}`,
        vaultData(
          vault,
          input,
          IdentityBridgeFlow.Vertical,
          IdentityBridgePortMode.Target,
          true,
        ),
        20,
        vaultStartY + index * 190,
        300,
      ),
    );
    if (verifiedVaults.length === 0) {
      vaultNodes.push(
        graphNode(
          "vault-empty",
          {
            kind: IdentityBridgeNodeKind.Empty,
            flow: IdentityBridgeFlow.Vertical,
            portMode: IdentityBridgePortMode.None,
            label: input.copy.noVerifiedVaults,
            description: input.copy.noVerifiedVaultsDescription,
          },
          20,
          vaultStartY,
          300,
        ),
      );
    }
    return {
      nodes: [
        stageNode(
          "stage-device",
          input.copy.deviceStage,
          IdentityBridgeFlow.Vertical,
          20,
          0,
          300,
        ),
        graphNode(
          "device-current",
          deviceData(input, IdentityBridgeFlow.Vertical),
          20,
          44,
          300,
        ),
        stageNode(
          "stage-identity",
          input.copy.identityStage,
          IdentityBridgeFlow.Vertical,
          20,
          250,
          300,
        ),
        graphNode(
          "identity-current",
          identityData(
            input,
            IdentityBridgeFlow.Vertical,
            IdentityBridgePortMode.Target,
          ),
          40,
          identityY,
          260,
        ),
        stageNode(
          "stage-vault",
          input.copy.vaultStage,
          IdentityBridgeFlow.Vertical,
          20,
          540,
          300,
        ),
        ...vaultNodes,
      ],
      edges: [
        graphEdge(
          "device-to-identity",
          "device-current",
          "identity-current",
          IdentityBridgeRelationKind.Evidence,
          input.copy.deviceIdentityRelation,
        ),
        ...verifiedVaults.map((vault) =>
          graphEdge(
            `device-to-${vault.storeId}`,
            "device-current",
            `vault-${vault.storeId}`,
            IdentityBridgeRelationKind.VerifiedDeviceAccess,
            input.copy.deviceVaultRelation(vault.label),
            true,
          ),
        ),
      ],
      compactHeight:
        vaultStartY + Math.max(1, verifiedVaults.length) * 190 + 24,
    };
  }

  const gap = 220;
  const vaultStartY = Math.max(
    0,
    150 - ((verifiedVaults.length - 1) * gap) / 2,
  );
  const vaultNodes = verifiedVaults.map((vault, index) =>
    graphNode(
      `vault-${vault.storeId}`,
      vaultData(
        vault,
        input,
        IdentityBridgeFlow.Horizontal,
        IdentityBridgePortMode.Target,
      ),
      700,
      vaultStartY + index * gap,
      350,
    ),
  );
  if (verifiedVaults.length === 0) {
    vaultNodes.push(
      graphNode(
        "vault-empty",
        {
          kind: IdentityBridgeNodeKind.Empty,
          flow: IdentityBridgeFlow.Horizontal,
          portMode: IdentityBridgePortMode.None,
          label: input.copy.noVerifiedVaults,
          description: input.copy.noVerifiedVaultsDescription,
        },
        700,
        150,
        350,
      ),
    );
  }
  return {
    nodes: [
      stageNode(
        "stage-device",
        input.copy.deviceStage,
        IdentityBridgeFlow.Horizontal,
        0,
        -54,
        310,
      ),
      stageNode(
        "stage-identity",
        input.copy.identityStage,
        IdentityBridgeFlow.Horizontal,
        385,
        -54,
        230,
      ),
      stageNode(
        "stage-vault",
        input.copy.vaultStage,
        IdentityBridgeFlow.Horizontal,
        700,
        -54,
        350,
      ),
      graphNode(
        "device-current",
        deviceData(input, IdentityBridgeFlow.Horizontal),
        0,
        115,
        310,
      ),
      graphNode(
        "identity-current",
        identityData(
          input,
          IdentityBridgeFlow.Horizontal,
          IdentityBridgePortMode.Target,
        ),
        385,
        125,
        230,
      ),
      ...vaultNodes,
    ],
    edges: [
      graphEdge(
        "device-to-identity",
        "device-current",
        "identity-current",
        IdentityBridgeRelationKind.Evidence,
        input.copy.deviceIdentityRelation,
      ),
      ...verifiedVaults.map((vault) =>
        graphEdge(
          `device-to-${vault.storeId}`,
          "device-current",
          `vault-${vault.storeId}`,
          IdentityBridgeRelationKind.VerifiedDeviceAccess,
          input.copy.deviceVaultRelation(vault.label),
        ),
      ),
    ],
    compactHeight: 0,
  };
}

function vaultGraph(input: IdentityBridgeInput): IdentityBridgeDefinition {
  const selectedVault = input.vaults.find(
    (vault) =>
      input.selectedVault.kind === IdentityBridgeVaultSelectionKind.Selected &&
      vault.storeId === input.selectedVault.storeId,
  );
  if (!selectedVault) {
    const compact = input.compact;
    const width = compact ? 300 : 370;
    return {
      nodes: [
        stageNode(
          "stage-vault",
          input.copy.selectedVaultStage,
          IdentityBridgeFlow.Vertical,
          compact ? 20 : 350,
          compact ? 0 : -54,
          width,
        ),
        graphNode(
          "vault-empty",
          {
            kind: IdentityBridgeNodeKind.Empty,
            flow: IdentityBridgeFlow.Vertical,
            portMode: IdentityBridgePortMode.None,
            label: input.copy.noSelectedVault,
            description: input.copy.noSelectedVaultDescription,
          },
          compact ? 20 : 350,
          compact ? 44 : 0,
          width,
        ),
        stageNode(
          "stage-identities",
          input.copy.authorizedIdentitiesStage,
          IdentityBridgeFlow.Vertical,
          compact ? 20 : 250,
          compact ? 250 : 225,
          compact ? 300 : 570,
        ),
        graphNode(
          "identity-empty",
          {
            kind: IdentityBridgeNodeKind.Empty,
            flow: IdentityBridgeFlow.Vertical,
            portMode: IdentityBridgePortMode.None,
            label: input.copy.noAuthorizedIdentity,
            description: input.copy.noAuthorizedIdentityDescription,
          },
          compact ? 20 : 350,
          compact ? 294 : 280,
          width,
        ),
      ],
      edges: [],
      compactHeight: compact ? 510 : 0,
    };
  }
  const verifiedDeviceAccess = selectedVault.verified;
  const compact = input.compact;
  const vaultX = compact ? 20 : 360;
  const vaultY = compact ? 44 : 0;
  const identityX = compact ? 40 : 350;
  const identityY = compact ? 360 : 280;
  const vaultWidth = compact ? 300 : 350;
  const identityWidth = compact ? 260 : 370;
  const nodes: IdentityBridgeNode[] = [
    stageNode(
      "stage-vault",
      input.copy.selectedVaultStage,
      IdentityBridgeFlow.Vertical,
      compact ? 20 : 360,
      compact ? 0 : -54,
      vaultWidth,
    ),
    graphNode(
      "vault-selected",
      vaultData(
        selectedVault,
        input,
        IdentityBridgeFlow.Vertical,
        verifiedDeviceAccess
          ? IdentityBridgePortMode.Source
          : IdentityBridgePortMode.None,
      ),
      vaultX,
      vaultY,
      vaultWidth,
    ),
    stageNode(
      "stage-identities",
      input.copy.authorizedIdentitiesStage,
      IdentityBridgeFlow.Vertical,
      compact ? 20 : 250,
      compact ? 310 : 225,
      compact ? 300 : 570,
    ),
  ];
  if (verifiedDeviceAccess) {
    nodes.push(
      graphNode(
        "identity-current",
        identityData(
          input,
          IdentityBridgeFlow.Vertical,
          IdentityBridgePortMode.Target,
        ),
        identityX,
        identityY,
        identityWidth,
      ),
    );
  } else {
    nodes.push(
      graphNode(
        "identity-empty",
        {
          kind: IdentityBridgeNodeKind.Empty,
          flow: IdentityBridgeFlow.Vertical,
          portMode: IdentityBridgePortMode.None,
          label: input.copy.noAuthorizedIdentity,
          description: input.copy.noAuthorizedIdentityDescription,
        },
        compact ? 20 : 350,
        identityY,
        compact ? 300 : 370,
      ),
    );
  }
  return {
    nodes,
    edges: verifiedDeviceAccess
      ? [
          graphEdge(
            "vault-to-identity",
            "vault-selected",
            "identity-current",
            IdentityBridgeRelationKind.VerifiedDeviceAccess,
            input.copy.vaultIdentityRelation(selectedVault.label),
          ),
        ]
      : [],
    compactHeight: compact ? 650 : 0,
  };
}

export function buildIdentityBridge(
  input: IdentityBridgeInput,
): IdentityBridgeDefinition {
  return input.perspective === IdentityBridgePerspective.Identities
    ? identityGraph(input)
    : vaultGraph(input);
}
