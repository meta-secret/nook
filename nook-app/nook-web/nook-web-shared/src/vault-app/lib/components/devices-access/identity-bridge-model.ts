import { MarkerType, type Edge, type Node } from "@xyflow/svelte";
import type { DeviceAccessIdentityState } from "$app-wasm";
import type { VaultAccessView } from "./access-chain";
import { DashboardTextKind } from "../devices-access-dashboard-state";

export enum IdentityBridgePerspective {
  Identities = "identities",
  Vaults = "vaults",
}

export enum IdentityBridgeNodeKind {
  Protection = "protection",
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
  ProtectionUnlocksDeviceKey = "protection-unlocks-device-key",
  AppKeyBelongsToIdentity = "app-key-belongs-to-identity",
  VerifiedDeviceAccess = "verified-device-access",
}

export enum IdentityBridgeDeviceIconKind {
  Browser = "browser",
  PairedDevice = "paired-device",
  RecoverableKey = "recoverable-key",
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

export type IdentityBridgeProtectionData = {
  kind: typeof IdentityBridgeNodeKind.Protection;
  flow: IdentityBridgeFlow;
  portMode: IdentityBridgePortMode;
  label: string;
  caption: string;
  description: string;
  incomingRelation: string;
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
  incomingRelation: string;
};

export type IdentityBridgeIdentityData = {
  kind: typeof IdentityBridgeNodeKind.Identity;
  flow: IdentityBridgeFlow;
  portMode: IdentityBridgePortMode;
  label: string;
  caption: string;
  description: string;
  stateLabel: string;
  identityStatus: DeviceAccessIdentityState;
  deviceMetricLabel: string;
  deviceMetricValue: string;
  vaultMetricLabel: string;
  vaultMetricValue: string;
  lateralAccessPort: boolean;
  incomingRelation: string;
};

export type IdentityBridgeVaultData = {
  kind: typeof IdentityBridgeNodeKind.Vault;
  flow: IdentityBridgeFlow;
  portMode: IdentityBridgePortMode;
  label: string;
  caption: string;
  description: string;
  statusLabel: string;
  evidenceLabel: string;
  statusMetricLabel: string;
  evidenceMetricLabel: string;
  verifiedDeviceAccess: boolean;
  lateralAccessPort: boolean;
  incomingRelation: string;
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
  | IdentityBridgeProtectionData
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
  protectionStage: string;
  deviceStage: string;
  identityStage: string;
  vaultStage: string;
  selectedVaultStage: string;
  currentDevice: string;
  currentIdentity: string;
  selectedIdentity: string;
  vaultGrant: string;
  deviceKey: string;
  oneDeviceKey: string;
  identityDescription: string;
  identityState: string;
  deviceMetricLabel: string;
  vaultMetricLabel: string;
  verifiedVaultCount: string;
  statusMetricLabel: string;
  evidenceMetricLabel: string;
  verifiedStatus: string;
  unverifiedStatus: string;
  noAuthorizedIdentity: string;
  noAuthorizedIdentityDescription: string;
  noVerifiedVaults: string;
  noVerifiedVaultsDescription: string;
  noSelectedVault: string;
  noSelectedVaultDescription: string;
  protectionDeviceRelation: string;
  appKeyIdentityRelation: string;
  identityVaultRelation: (vaultLabel: string) => string;
  deviceVaultRelation: (vaultLabel: string) => string;
  vaultDeviceRelation: (vaultLabel: string) => string;
  formatEvidence: (value: string) => string;
  unknown: string;
};

export type IdentityBridgeInput = {
  perspective: IdentityBridgePerspective;
  selectedVault: IdentityBridgeVaultSelection;
  compact: boolean;
  deviceIdentifier: string;
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

function nodeAriaLabel(data: IdentityBridgeNodeData): string {
  switch (data.kind) {
    case IdentityBridgeNodeKind.Protection:
      return `${data.caption}: ${data.label}. ${data.description}`;
    case IdentityBridgeNodeKind.Device:
      return `${data.caption}: ${data.label}${data.incomingRelation ? `. ${data.incomingRelation}` : ""}`;
    case IdentityBridgeNodeKind.Identity:
      return `${data.caption}: ${data.label}. ${data.stateLabel}${data.incomingRelation ? `. ${data.incomingRelation}` : ""}`;
    case IdentityBridgeNodeKind.Vault:
      return `${data.caption}: ${data.label}. ${data.statusLabel}${data.incomingRelation ? `. ${data.incomingRelation}` : ""}`;
    case IdentityBridgeNodeKind.Empty:
      return `${data.label}. ${data.description}`;
    case IdentityBridgeNodeKind.Stage:
      return data.label;
  }
}

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
    ariaLabel: nodeAriaLabel(data),
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
  lateralAccessPort = false,
): IdentityBridgeIdentityData {
  return {
    kind: IdentityBridgeNodeKind.Identity,
    flow,
    portMode,
    label: input.copy.currentIdentity,
    caption: input.copy.selectedIdentity,
    description: input.copy.identityDescription,
    stateLabel: input.copy.identityState,
    identityStatus: input.identityStatus,
    deviceMetricLabel: input.copy.deviceMetricLabel,
    deviceMetricValue: input.copy.oneDeviceKey,
    vaultMetricLabel: input.copy.vaultMetricLabel,
    vaultMetricValue: input.copy.verifiedVaultCount,
    lateralAccessPort,
    incomingRelation: "",
  };
}

function protectionData(
  input: IdentityBridgeInput,
  flow: IdentityBridgeFlow,
): IdentityBridgeProtectionData {
  return {
    kind: IdentityBridgeNodeKind.Protection,
    flow,
    portMode: IdentityBridgePortMode.Source,
    label: input.protectionLabel,
    caption: input.copy.protectionStage,
    description: input.copy.protectionDeviceRelation,
    incomingRelation: "",
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
    statusLabel: vault.verified
      ? input.copy.verifiedStatus
      : input.copy.unverifiedStatus,
    evidenceLabel:
      vault.verifiedAt.kind === DashboardTextKind.Known
        ? input.copy.formatEvidence(vault.verifiedAt.value)
        : input.copy.unknown,
    statusMetricLabel: input.copy.statusMetricLabel,
    evidenceMetricLabel: input.copy.evidenceMetricLabel,
    verifiedDeviceAccess: vault.verified,
    lateralAccessPort,
    incomingRelation: vault.verified
      ? input.copy.identityVaultRelation(vault.label)
      : "",
  };
}

function deviceData(
  input: IdentityBridgeInput,
  flow: IdentityBridgeFlow,
  portMode: IdentityBridgePortMode,
  incomingRelation: string,
): IdentityBridgeDeviceData {
  return {
    kind: IdentityBridgeNodeKind.Device,
    flow,
    portMode,
    label: input.copy.currentDevice,
    caption: input.copy.deviceStage,
    countLabel: input.copy.oneDeviceKey,
    iconKind: input.deviceIconKind,
    lateralAccessPort: flow === IdentityBridgeFlow.Vertical,
    incomingRelation,
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
    const identityY = 500;
    const vaultStartY = 790;
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
          "stage-protection",
          input.copy.protectionStage,
          IdentityBridgeFlow.Vertical,
          20,
          0,
          300,
        ),
        graphNode(
          "protection-current",
          protectionData(input, IdentityBridgeFlow.Vertical),
          20,
          44,
          300,
        ),
        stageNode(
          "stage-device",
          input.copy.deviceStage,
          IdentityBridgeFlow.Vertical,
          20,
          200,
          300,
        ),
        graphNode(
          "device-current",
          deviceData(
            input,
            IdentityBridgeFlow.Vertical,
            IdentityBridgePortMode.Both,
            input.copy.protectionDeviceRelation,
          ),
          20,
          244,
          300,
        ),
        stageNode(
          "stage-identity",
          input.copy.identityStage,
          IdentityBridgeFlow.Vertical,
          20,
          450,
          300,
        ),
        graphNode(
          "identity-current",
          identityData(
            input,
            IdentityBridgeFlow.Vertical,
            IdentityBridgePortMode.Both,
            true,
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
          740,
          300,
        ),
        ...vaultNodes,
      ],
      edges: [
        graphEdge(
          "protection-to-device",
          "protection-current",
          "device-current",
          IdentityBridgeRelationKind.ProtectionUnlocksDeviceKey,
          input.copy.protectionDeviceRelation,
        ),
        graphEdge(
          "device-to-identity",
          "device-current",
          "identity-current",
          IdentityBridgeRelationKind.AppKeyBelongsToIdentity,
          input.copy.appKeyIdentityRelation,
        ),
        ...verifiedVaults.map((vault) =>
          graphEdge(
            `identity-to-${vault.storeId}`,
            "identity-current",
            `vault-${vault.storeId}`,
            IdentityBridgeRelationKind.VerifiedDeviceAccess,
            input.copy.identityVaultRelation(vault.label),
            true,
          ),
        ),
      ],
      compactHeight:
        vaultStartY + Math.max(1, verifiedVaults.length) * 190 + 24,
    };
  }

  const gap = 220;
  const identityY = Math.max(
    115,
    150 - ((verifiedVaults.length - 1) * gap) / 2,
  );
  const vaultStartY = Math.max(
    0,
    identityY - ((verifiedVaults.length - 1) * gap) / 2,
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
        identityY,
        350,
      ),
    );
  }
  return {
    nodes: [
      stageNode(
        "stage-protection",
        input.copy.protectionStage,
        IdentityBridgeFlow.Horizontal,
        0,
        -54,
        250,
      ),
      stageNode(
        "stage-device",
        input.copy.deviceStage,
        IdentityBridgeFlow.Horizontal,
        280,
        -54,
        280,
      ),
      stageNode(
        "stage-identity",
        input.copy.identityStage,
        IdentityBridgeFlow.Horizontal,
        480,
        -54,
        180,
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
        "protection-current",
        protectionData(input, IdentityBridgeFlow.Horizontal),
        0,
        identityY,
        250,
      ),
      graphNode(
        "device-current",
        deviceData(
          input,
          IdentityBridgeFlow.Horizontal,
          IdentityBridgePortMode.Both,
          input.copy.protectionDeviceRelation,
        ),
        280,
        identityY,
        180,
      ),
      graphNode(
        "identity-current",
        identityData(
          input,
          IdentityBridgeFlow.Horizontal,
          IdentityBridgePortMode.Both,
        ),
        490,
        identityY,
        180,
      ),
      ...vaultNodes,
    ],
    edges: [
      graphEdge(
        "protection-to-device",
        "protection-current",
        "device-current",
        IdentityBridgeRelationKind.ProtectionUnlocksDeviceKey,
        input.copy.protectionDeviceRelation,
      ),
      graphEdge(
        "device-to-identity",
        "device-current",
        "identity-current",
        IdentityBridgeRelationKind.AppKeyBelongsToIdentity,
        input.copy.appKeyIdentityRelation,
      ),
      ...verifiedVaults.map((vault) =>
        graphEdge(
          `identity-to-${vault.storeId}`,
          "identity-current",
          `vault-${vault.storeId}`,
          IdentityBridgeRelationKind.VerifiedDeviceAccess,
          input.copy.identityVaultRelation(vault.label),
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
      ],
      edges: [],
      compactHeight: compact ? 280 : 0,
    };
  }
  const verifiedDeviceAccess = selectedVault.verified;
  const compact = input.compact;
  const flow = compact
    ? IdentityBridgeFlow.Vertical
    : IdentityBridgeFlow.Horizontal;
  const vaultX = compact ? 20 : 0;
  const vaultY = compact ? 44 : 115;
  const deviceX = compact ? 20 : 590;
  const deviceY = compact ? 360 : 115;
  const vaultWidth = compact ? 300 : 350;
  const deviceWidth = compact ? 300 : 310;
  const nodes: IdentityBridgeNode[] = [
    stageNode(
      "stage-vault",
      input.copy.selectedVaultStage,
      flow,
      compact ? 20 : 0,
      compact ? 0 : 0,
      vaultWidth,
    ),
    graphNode(
      "vault-selected",
      vaultData(
        selectedVault,
        input,
        flow,
        verifiedDeviceAccess
          ? IdentityBridgePortMode.Source
          : IdentityBridgePortMode.None,
      ),
      vaultX,
      vaultY,
      vaultWidth,
    ),
    stageNode(
      "stage-device",
      input.copy.deviceStage,
      flow,
      compact ? 20 : 590,
      compact ? 310 : 0,
      compact ? 300 : 310,
    ),
  ];
  if (verifiedDeviceAccess) {
    nodes.push(
      graphNode(
        "device-current",
        deviceData(
          input,
          flow,
          IdentityBridgePortMode.Target,
          input.copy.vaultDeviceRelation(selectedVault.label),
        ),
        deviceX,
        deviceY,
        deviceWidth,
      ),
    );
  } else {
    nodes.push(
      graphNode(
        "device-empty",
        {
          kind: IdentityBridgeNodeKind.Empty,
          flow,
          portMode: IdentityBridgePortMode.None,
          label: input.copy.noAuthorizedIdentity,
          description: input.copy.noAuthorizedIdentityDescription,
        },
        deviceX,
        deviceY,
        deviceWidth,
      ),
    );
  }
  return {
    nodes,
    edges: verifiedDeviceAccess
      ? [
          graphEdge(
            "vault-to-device",
            "vault-selected",
            "device-current",
            IdentityBridgeRelationKind.VerifiedDeviceAccess,
            input.copy.vaultDeviceRelation(selectedVault.label),
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
