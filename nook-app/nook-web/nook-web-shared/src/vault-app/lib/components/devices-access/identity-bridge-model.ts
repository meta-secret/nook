import type { Node } from "@xyflow/svelte";
import type { VaultAccessView } from "./access-chain";
import { DashboardTextKind } from "../devices-access-dashboard-state";

export enum IdentityBridgePerspective {
  Identities = "identities",
  Vaults = "vaults",
}

export enum IdentityBridgeNodeKind {
  Identity = "identity",
  Stage = "stage",
  Vault = "vault",
  Empty = "empty",
}

export enum IdentityBridgeFlow {
  Horizontal = "horizontal",
  Vertical = "vertical",
}

export enum IdentityBridgeNodeType {
  Bridge = "identity-bridge",
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

export type IdentityBridgeIdentityData = {
  kind: typeof IdentityBridgeNodeKind.Identity;
  flow: IdentityBridgeFlow;
  label: string;
  caption: string;
  description: string;
};

export type IdentityBridgeVaultData = {
  kind: typeof IdentityBridgeNodeKind.Vault;
  flow: IdentityBridgeFlow;
  label: string;
  caption: string;
  description: string;
  statusLabel: string;
  evidenceLabel: string;
  statusMetricLabel: string;
  evidenceMetricLabel: string;
  verifiedLocalAccess: boolean;
};

export type IdentityBridgeStageData = {
  kind: typeof IdentityBridgeNodeKind.Stage;
  flow: IdentityBridgeFlow;
  label: string;
};

export type IdentityBridgeEmptyData = {
  kind: typeof IdentityBridgeNodeKind.Empty;
  flow: IdentityBridgeFlow;
  label: string;
  description: string;
};

export type IdentityBridgeNodeData =
  | IdentityBridgeIdentityData
  | IdentityBridgeVaultData
  | IdentityBridgeStageData
  | IdentityBridgeEmptyData;

export type IdentityBridgeNode = Node<
  IdentityBridgeNodeData,
  IdentityBridgeNodeType.Bridge
>;

export type IdentityBridgeCopy = {
  identityStage: string;
  selectedVaultStage: string;
  currentIdentity: string;
  selectedIdentity: string;
  vaultAccess: string;
  identityDescription: string;
  statusMetricLabel: string;
  evidenceMetricLabel: string;
  verifiedStatus: string;
  unverifiedStatus: string;
  noSelectedVault: string;
  noSelectedVaultDescription: string;
  formatEvidence: (value: string) => string;
  unknown: string;
};

export type IdentityBridgeInput = {
  perspective: IdentityBridgePerspective;
  selectedVault: IdentityBridgeVaultSelection;
  compact: boolean;
  vaults: readonly VaultAccessView[];
  copy: IdentityBridgeCopy;
};

export type IdentityBridgeDefinition = {
  nodes: IdentityBridgeNode[];
  edges: [];
  compactHeight: number;
};

function nodeAriaLabel(data: IdentityBridgeNodeData): string {
  switch (data.kind) {
    case IdentityBridgeNodeKind.Identity:
      return `${data.caption}: ${data.label}. ${data.description}`;
    case IdentityBridgeNodeKind.Vault:
      return `${data.caption}: ${data.label}. ${data.statusLabel}`;
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
    { kind: IdentityBridgeNodeKind.Stage, flow, label },
    x,
    y,
    width,
  );
}

function identityGraph(input: IdentityBridgeInput): IdentityBridgeDefinition {
  const flow = input.compact
    ? IdentityBridgeFlow.Vertical
    : IdentityBridgeFlow.Horizontal;
  const x = input.compact ? 20 : 330;
  const width = input.compact ? 300 : 390;
  return {
    nodes: [
      stageNode("stage-identity", input.copy.identityStage, flow, x, 0, width),
      graphNode(
        "identity-current",
        {
          kind: IdentityBridgeNodeKind.Identity,
          flow,
          label: input.copy.currentIdentity,
          caption: input.copy.selectedIdentity,
          description: input.copy.identityDescription,
        },
        x,
        54,
        width,
      ),
    ],
    edges: [],
    compactHeight: input.compact ? 300 : 0,
  };
}

function vaultGraph(input: IdentityBridgeInput): IdentityBridgeDefinition {
  const selectedVault = input.vaults.find(
    (vault) =>
      input.selectedVault.kind === IdentityBridgeVaultSelectionKind.Selected &&
      vault.storeId === input.selectedVault.storeId,
  );
  const flow = input.compact
    ? IdentityBridgeFlow.Vertical
    : IdentityBridgeFlow.Horizontal;
  const x = input.compact ? 20 : 330;
  const width = input.compact ? 300 : 390;
  const stage = stageNode(
    "stage-vault",
    input.copy.selectedVaultStage,
    flow,
    x,
    0,
    width,
  );
  if (!selectedVault) {
    return {
      nodes: [
        stage,
        graphNode(
          "vault-empty",
          {
            kind: IdentityBridgeNodeKind.Empty,
            flow,
            label: input.copy.noSelectedVault,
            description: input.copy.noSelectedVaultDescription,
          },
          x,
          54,
          width,
        ),
      ],
      edges: [],
      compactHeight: input.compact ? 280 : 0,
    };
  }
  const status = selectedVault.verified
    ? input.copy.verifiedStatus
    : input.copy.unverifiedStatus;
  return {
    nodes: [
      stage,
      graphNode(
        "vault-selected",
        {
          kind: IdentityBridgeNodeKind.Vault,
          flow,
          label: selectedVault.label,
          caption: input.copy.vaultAccess,
          description: status,
          statusLabel: status,
          evidenceLabel:
            selectedVault.verifiedAt.kind === DashboardTextKind.Known
              ? input.copy.formatEvidence(selectedVault.verifiedAt.value)
              : input.copy.unknown,
          statusMetricLabel: input.copy.statusMetricLabel,
          evidenceMetricLabel: input.copy.evidenceMetricLabel,
          verifiedLocalAccess: selectedVault.verified,
        },
        x,
        54,
        width,
      ),
    ],
    edges: [],
    compactHeight: input.compact ? 360 : 0,
  };
}

export function buildIdentityBridge(
  input: IdentityBridgeInput,
): IdentityBridgeDefinition {
  return input.perspective === IdentityBridgePerspective.Identities
    ? identityGraph(input)
    : vaultGraph(input);
}
