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

function graphNode({
  id,
  data,
  x,
  y,
  width,
}: {
  readonly id: string;
  readonly data: IdentityBridgeNodeData;
  readonly x: number;
  readonly y: number;
  readonly width: number;
}): IdentityBridgeNode {
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

function stageNode({
  id,
  label,
  flow,
  x,
  y,
  width,
}: {
  readonly id: string;
  readonly label: string;
  readonly flow: IdentityBridgeFlow;
  readonly x: number;
  readonly y: number;
  readonly width: number;
}): IdentityBridgeNode {
  const graphNodeArgs: Parameters<typeof graphNode>[0] = {
    id,
    data: {
      kind: IdentityBridgeNodeKind.Stage,
      flow,
      portMode: IdentityBridgePortMode.None,
      label,
    },
    x,
    y,
    width,
  };
  return graphNode(graphNodeArgs);
}

function graphEdge({
  id,
  source,
  target,
  relation,
  ariaLabel,
  lateralAccessPort,
}: {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly relation: IdentityBridgeRelationKind;
  readonly ariaLabel: string;
  readonly lateralAccessPort: boolean;
}): IdentityBridgeEdge {
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

function identityData({
  input,
  flow,
  portMode,
  lateralAccessPort,
}: {
  readonly input: IdentityBridgeInput;
  readonly flow: IdentityBridgeFlow;
  readonly portMode: IdentityBridgePortMode;
  readonly lateralAccessPort: boolean;
}): IdentityBridgeIdentityData {
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

function protectionData({
  input,
  flow,
}: {
  readonly input: IdentityBridgeInput;
  readonly flow: IdentityBridgeFlow;
}): IdentityBridgeProtectionData {
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

function vaultData({
  vault,
  input,
  flow,
  portMode,
  lateralAccessPort,
}: {
  readonly vault: VaultAccessView;
  readonly input: IdentityBridgeInput;
  readonly flow: IdentityBridgeFlow;
  readonly portMode: IdentityBridgePortMode;
  readonly lateralAccessPort: boolean;
}): IdentityBridgeVaultData {
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

function deviceData({
  input,
  flow,
  portMode,
  incomingRelation,
}: {
  readonly input: IdentityBridgeInput;
  readonly flow: IdentityBridgeFlow;
  readonly portMode: IdentityBridgePortMode;
  readonly incomingRelation: string;
}): IdentityBridgeDeviceData {
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
    const vaultNodes = verifiedVaults.map(
      // eslint-disable-next-line max-params -- Host API owns this positional callback signature.
      (vault, index) =>
        (() => {
          const vaultDataArgs: Parameters<typeof vaultData>[0] = {
            vault,
            input,
            flow: IdentityBridgeFlow.Vertical,
            portMode: IdentityBridgePortMode.Target,
            lateralAccessPort: true,
          };
          const graphNodeArgs2: Parameters<typeof graphNode>[0] = {
            id: `vault-${vault.storeId}`,
            data: vaultData(vaultDataArgs),
            x: 20,
            y: vaultStartY + index * 190,
            width: 300,
          };
          return graphNode(graphNodeArgs2);
        })(),
    );
    if (verifiedVaults.length === 0) {
      const graphNodeArgs3: Parameters<typeof graphNode>[0] = {
        id: "vault-empty",
        data: {
          kind: IdentityBridgeNodeKind.Empty,
          flow: IdentityBridgeFlow.Vertical,
          portMode: IdentityBridgePortMode.None,
          label: input.copy.noVerifiedVaults,
          description: input.copy.noVerifiedVaultsDescription,
        },
        x: 20,
        y: vaultStartY,
        width: 300,
      };
      vaultNodes.push(graphNode(graphNodeArgs3));
    }
    return {
      nodes: [
        (() => {
          const stageNodeArgs: Parameters<typeof stageNode>[0] = {
            id: "stage-protection",
            label: input.copy.protectionStage,
            flow: IdentityBridgeFlow.Vertical,
            x: 20,
            y: 0,
            width: 300,
          };
          return stageNode(stageNodeArgs);
        })(),
        (() => {
          const data = (() => {
            const protectionDataArgs: Parameters<typeof protectionData>[0] = {
              input,
              flow: IdentityBridgeFlow.Vertical,
            };
            return protectionData(protectionDataArgs);
          })();
          const nodeRequest: Parameters<typeof graphNode>[0] = {
            id: "protection-current",
            data,
            x: 20,
            y: 44,
            width: 300,
          };
          return graphNode(nodeRequest);
        })(),
        (() => {
          const stageNodeArgs2: Parameters<typeof stageNode>[0] = {
            id: "stage-device",
            label: input.copy.deviceStage,
            flow: IdentityBridgeFlow.Vertical,
            x: 20,
            y: 200,
            width: 300,
          };
          return stageNode(stageNodeArgs2);
        })(),
        (() => {
          const data = (() => {
            const deviceDataArgs: Parameters<typeof deviceData>[0] = {
              input,
              flow: IdentityBridgeFlow.Vertical,
              portMode: IdentityBridgePortMode.Both,
              incomingRelation: input.copy.protectionDeviceRelation,
            };
            return deviceData(deviceDataArgs);
          })();
          const nodeRequest: Parameters<typeof graphNode>[0] = {
            id: "device-current",
            data,
            x: 20,
            y: 244,
            width: 300,
          };
          return graphNode(nodeRequest);
        })(),
        (() => {
          const stageNodeArgs3: Parameters<typeof stageNode>[0] = {
            id: "stage-identity",
            label: input.copy.identityStage,
            flow: IdentityBridgeFlow.Vertical,
            x: 20,
            y: 450,
            width: 300,
          };
          return stageNode(stageNodeArgs3);
        })(),
        (() => {
          const identityDataArgs: Parameters<typeof identityData>[0] = {
            input,
            flow: IdentityBridgeFlow.Vertical,
            portMode: IdentityBridgePortMode.Both,
            lateralAccessPort: true,
          };
          const graphNodeArgs6: Parameters<typeof graphNode>[0] = {
            id: "identity-current",
            data: identityData(identityDataArgs),
            x: 40,
            y: identityY,
            width: 260,
          };
          return graphNode(graphNodeArgs6);
        })(),
        (() => {
          const stageNodeArgs4: Parameters<typeof stageNode>[0] = {
            id: "stage-vault",
            label: input.copy.vaultStage,
            flow: IdentityBridgeFlow.Vertical,
            x: 20,
            y: 740,
            width: 300,
          };
          return stageNode(stageNodeArgs4);
        })(),
        ...vaultNodes,
      ],
      edges: [
        (() => {
          const graphEdgeArgs: Parameters<typeof graphEdge>[0] = {
            id: "protection-to-device",
            source: "protection-current",
            target: "device-current",
            relation: IdentityBridgeRelationKind.ProtectionUnlocksDeviceKey,
            ariaLabel: input.copy.protectionDeviceRelation,
            lateralAccessPort: false,
          };
          return graphEdge(graphEdgeArgs);
        })(),
        (() => {
          const graphEdgeArgs2: Parameters<typeof graphEdge>[0] = {
            id: "device-to-identity",
            source: "device-current",
            target: "identity-current",
            relation: IdentityBridgeRelationKind.AppKeyBelongsToIdentity,
            ariaLabel: input.copy.appKeyIdentityRelation,
            lateralAccessPort: false,
          };
          return graphEdge(graphEdgeArgs2);
        })(),
        ...verifiedVaults.map((vault) =>
          (() => {
            const graphEdgeArgs3: Parameters<typeof graphEdge>[0] = {
              id: `identity-to-${vault.storeId}`,
              source: "identity-current",
              target: `vault-${vault.storeId}`,
              relation: IdentityBridgeRelationKind.VerifiedDeviceAccess,
              ariaLabel: input.copy.identityVaultRelation(vault.label),
              lateralAccessPort: true,
            };
            return graphEdge(graphEdgeArgs3);
          })(),
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
  const vaultNodes = verifiedVaults.map(
    // eslint-disable-next-line max-params -- Host API owns this positional callback signature.
    (vault, index) =>
      (() => {
        const vaultDataArgs2: Parameters<typeof vaultData>[0] = {
          vault,
          input,
          flow: IdentityBridgeFlow.Horizontal,
          portMode: IdentityBridgePortMode.Target,
          lateralAccessPort: false,
        };
        const graphNodeArgs7: Parameters<typeof graphNode>[0] = {
          id: `vault-${vault.storeId}`,
          data: vaultData(vaultDataArgs2),
          x: 700,
          y: vaultStartY + index * gap,
          width: 350,
        };
        return graphNode(graphNodeArgs7);
      })(),
  );
  if (verifiedVaults.length === 0) {
    const graphNodeArgs8: Parameters<typeof graphNode>[0] = {
      id: "vault-empty",
      data: {
        kind: IdentityBridgeNodeKind.Empty,
        flow: IdentityBridgeFlow.Horizontal,
        portMode: IdentityBridgePortMode.None,
        label: input.copy.noVerifiedVaults,
        description: input.copy.noVerifiedVaultsDescription,
      },
      x: 700,
      y: identityY,
      width: 350,
    };
    vaultNodes.push(graphNode(graphNodeArgs8));
  }
  return {
    nodes: [
      (() => {
        const stageNodeArgs5: Parameters<typeof stageNode>[0] = {
          id: "stage-protection",
          label: input.copy.protectionStage,
          flow: IdentityBridgeFlow.Horizontal,
          x: 0,
          y: -54,
          width: 250,
        };
        return stageNode(stageNodeArgs5);
      })(),
      (() => {
        const stageNodeArgs6: Parameters<typeof stageNode>[0] = {
          id: "stage-device",
          label: input.copy.deviceStage,
          flow: IdentityBridgeFlow.Horizontal,
          x: 280,
          y: -54,
          width: 280,
        };
        return stageNode(stageNodeArgs6);
      })(),
      (() => {
        const stageNodeArgs7: Parameters<typeof stageNode>[0] = {
          id: "stage-identity",
          label: input.copy.identityStage,
          flow: IdentityBridgeFlow.Horizontal,
          x: 480,
          y: -54,
          width: 180,
        };
        return stageNode(stageNodeArgs7);
      })(),
      (() => {
        const stageNodeArgs8: Parameters<typeof stageNode>[0] = {
          id: "stage-vault",
          label: input.copy.vaultStage,
          flow: IdentityBridgeFlow.Horizontal,
          x: 700,
          y: -54,
          width: 350,
        };
        return stageNode(stageNodeArgs8);
      })(),
      (() => {
        const data = (() => {
          const protectionDataArgs2: Parameters<typeof protectionData>[0] = {
            input,
            flow: IdentityBridgeFlow.Horizontal,
          };
          return protectionData(protectionDataArgs2);
        })();
        const nodeRequest: Parameters<typeof graphNode>[0] = {
          id: "protection-current",
          data,
          x: 0,
          y: identityY,
          width: 250,
        };
        return graphNode(nodeRequest);
      })(),
      (() => {
        const data = (() => {
          const deviceDataArgs2: Parameters<typeof deviceData>[0] = {
            input,
            flow: IdentityBridgeFlow.Horizontal,
            portMode: IdentityBridgePortMode.Both,
            incomingRelation: input.copy.protectionDeviceRelation,
          };
          return deviceData(deviceDataArgs2);
        })();
        const nodeRequest: Parameters<typeof graphNode>[0] = {
          id: "device-current",
          data,
          x: 280,
          y: identityY,
          width: 180,
        };
        return graphNode(nodeRequest);
      })(),
      (() => {
        const identityDataArgs2: Parameters<typeof identityData>[0] = {
          input,
          flow: IdentityBridgeFlow.Horizontal,
          portMode: IdentityBridgePortMode.Both,
          lateralAccessPort: false,
        };
        const graphNodeArgs11: Parameters<typeof graphNode>[0] = {
          id: "identity-current",
          data: identityData(identityDataArgs2),
          x: 490,
          y: identityY,
          width: 180,
        };
        return graphNode(graphNodeArgs11);
      })(),
      ...vaultNodes,
    ],
    edges: [
      (() => {
        const graphEdgeArgs4: Parameters<typeof graphEdge>[0] = {
          id: "protection-to-device",
          source: "protection-current",
          target: "device-current",
          relation: IdentityBridgeRelationKind.ProtectionUnlocksDeviceKey,
          ariaLabel: input.copy.protectionDeviceRelation,
          lateralAccessPort: false,
        };
        return graphEdge(graphEdgeArgs4);
      })(),
      (() => {
        const graphEdgeArgs5: Parameters<typeof graphEdge>[0] = {
          id: "device-to-identity",
          source: "device-current",
          target: "identity-current",
          relation: IdentityBridgeRelationKind.AppKeyBelongsToIdentity,
          ariaLabel: input.copy.appKeyIdentityRelation,
          lateralAccessPort: false,
        };
        return graphEdge(graphEdgeArgs5);
      })(),
      ...verifiedVaults.map((vault) =>
        (() => {
          const graphEdgeArgs6: Parameters<typeof graphEdge>[0] = {
            id: `identity-to-${vault.storeId}`,
            source: "identity-current",
            target: `vault-${vault.storeId}`,
            relation: IdentityBridgeRelationKind.VerifiedDeviceAccess,
            ariaLabel: input.copy.identityVaultRelation(vault.label),
            lateralAccessPort: false,
          };
          return graphEdge(graphEdgeArgs6);
        })(),
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
        (() => {
          const stageNodeArgs9: Parameters<typeof stageNode>[0] = {
            id: "stage-vault",
            label: input.copy.selectedVaultStage,
            flow: IdentityBridgeFlow.Vertical,
            x: compact ? 20 : 350,
            y: compact ? 0 : -54,
            width,
          };
          return stageNode(stageNodeArgs9);
        })(),
        (() => {
          const graphNodeArgs12: Parameters<typeof graphNode>[0] = {
            id: "vault-empty",
            data: {
              kind: IdentityBridgeNodeKind.Empty,
              flow: IdentityBridgeFlow.Vertical,
              portMode: IdentityBridgePortMode.None,
              label: input.copy.noSelectedVault,
              description: input.copy.noSelectedVaultDescription,
            },
            x: compact ? 20 : 350,
            y: compact ? 44 : 0,
            width,
          };
          return graphNode(graphNodeArgs12);
        })(),
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
    (() => {
      const stageNodeArgs10: Parameters<typeof stageNode>[0] = {
        id: "stage-vault",
        label: input.copy.selectedVaultStage,
        flow,
        x: compact ? 20 : 0,
        y: compact ? 0 : 0,
        width: vaultWidth,
      };
      return stageNode(stageNodeArgs10);
    })(),
    (() => {
      const vaultDataArgs3: Parameters<typeof vaultData>[0] = {
        vault: selectedVault,
        input,
        flow,
        portMode: verifiedDeviceAccess
          ? IdentityBridgePortMode.Source
          : IdentityBridgePortMode.None,
        lateralAccessPort: false,
      };
      const graphNodeArgs13: Parameters<typeof graphNode>[0] = {
        id: "vault-selected",
        data: vaultData(vaultDataArgs3),
        x: vaultX,
        y: vaultY,
        width: vaultWidth,
      };
      return graphNode(graphNodeArgs13);
    })(),
    (() => {
      const stageNodeArgs11: Parameters<typeof stageNode>[0] = {
        id: "stage-device",
        label: input.copy.deviceStage,
        flow,
        x: compact ? 20 : 590,
        y: compact ? 310 : 0,
        width: compact ? 300 : 310,
      };
      return stageNode(stageNodeArgs11);
    })(),
  ];
  if (verifiedDeviceAccess) {
    nodes.push(
      (() => {
        const data = (() => {
          const deviceDataArgs3: Parameters<typeof deviceData>[0] = {
            input,
            flow,
            portMode: IdentityBridgePortMode.Target,
            incomingRelation: input.copy.vaultDeviceRelation(
              selectedVault.label,
            ),
          };
          return deviceData(deviceDataArgs3);
        })();
        const nodeRequest: Parameters<typeof graphNode>[0] = {
          id: "device-current",
          data,
          x: deviceX,
          y: deviceY,
          width: deviceWidth,
        };
        return graphNode(nodeRequest);
      })(),
    );
  } else {
    const graphNodeArgs14: Parameters<typeof graphNode>[0] = {
      id: "device-empty",
      data: {
        kind: IdentityBridgeNodeKind.Empty,
        flow,
        portMode: IdentityBridgePortMode.None,
        label: input.copy.noAuthorizedIdentity,
        description: input.copy.noAuthorizedIdentityDescription,
      },
      x: deviceX,
      y: deviceY,
      width: deviceWidth,
    };
    nodes.push(graphNode(graphNodeArgs14));
  }
  return {
    nodes,
    edges: verifiedDeviceAccess
      ? [
          (() => {
            const graphEdgeArgs7: Parameters<typeof graphEdge>[0] = {
              id: "vault-to-device",
              source: "vault-selected",
              target: "device-current",
              relation: IdentityBridgeRelationKind.VerifiedDeviceAccess,
              ariaLabel: input.copy.vaultDeviceRelation(selectedVault.label),
              lateralAccessPort: false,
            };
            return graphEdge(graphEdgeArgs7);
          })(),
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
