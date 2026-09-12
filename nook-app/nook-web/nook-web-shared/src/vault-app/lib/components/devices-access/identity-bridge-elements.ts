type IdentityBridgeGraphNode = {
  readonly id: string;
  readonly data: IdentityBridgeNodeData;
  readonly x: number;
  readonly y: number;
  readonly width: number;
};

type IdentityBridgeStageNode = {
  readonly id: string;
  readonly label: string;
  readonly flow: IdentityBridgeFlow;
  readonly x: number;
  readonly y: number;
  readonly width: number;
};

type IdentityBridgeGraphEdge = {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly relation: IdentityBridgeRelationKind;
  readonly ariaLabel: string;
  readonly lateralAccessPort: boolean;
};

type IdentityBridgeIdentityDataRequest = {
  readonly input: IdentityBridgeInput;
  readonly flow: IdentityBridgeFlow;
  readonly portMode: IdentityBridgePortMode;
  readonly lateralAccessPort: boolean;
};

type IdentityBridgeProtectionDataRequest = {
  readonly input: IdentityBridgeInput;
  readonly flow: IdentityBridgeFlow;
};

type IdentityBridgeVaultDataRequest = {
  readonly vault: VaultAccessView;
  readonly input: IdentityBridgeInput;
  readonly flow: IdentityBridgeFlow;
  readonly portMode: IdentityBridgePortMode;
  readonly lateralAccessPort: boolean;
};

type IdentityBridgeDeviceDataRequest = {
  readonly input: IdentityBridgeInput;
  readonly flow: IdentityBridgeFlow;
  readonly portMode: IdentityBridgePortMode;
  readonly incomingRelation: string;
};

import { MarkerType, type Edge, type Node } from "@xyflow/svelte";
import type { DeviceAccessIdentityState } from "$app-wasm";
import type { VaultAccessView } from "./access-chain";
import {
  PasskeyCardSummaryKind,
  type PasskeyCardSummaryState,
} from "./passkey-card";
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
  summary: PasskeyCardSummaryState;
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
  protectionSummary: PasskeyCardSummaryState;
  deviceIconKind: IdentityBridgeDeviceIconKind;
  vaults: readonly VaultAccessView[];
  copy: IdentityBridgeCopy;
};

export type IdentityBridgeDefinition = {
  nodes: IdentityBridgeNode[];
  edges: IdentityBridgeEdge[];
  compactHeight: number;
};

export class IdentityBridgeGraphNodePresentation {
  constructor(private readonly request: IdentityBridgeGraphNode) {}
  get node(): IdentityBridgeNode {
    const { id, data, x, y, width } = this.request;
    return {
      id,
      type: IdentityBridgeNodeType.Bridge,
      position: { x, y },
      data,
      draggable: false,
      selectable: false,
      focusable: data.kind !== IdentityBridgeNodeKind.Stage,
      ariaLabel: this.ariaLabel,
      style: `width: ${width}px`,
    };
  }
  private get ariaLabel(): string {
    const data = this.request.data;
    switch (data.kind) {
      case IdentityBridgeNodeKind.Protection:
        return `${data.caption}: ${data.label}. ${data.description}${data.summary.kind === PasskeyCardSummaryKind.Present ? `. ${data.summary.summary.facts.map((fact) => `${fact.label}: ${fact.value}`).join(". ")}` : ""}`;
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
}
export class IdentityBridgeStagePresentation {
  constructor(private readonly request: IdentityBridgeStageNode) {}
  get node(): IdentityBridgeNode {
    const { id, label, flow, x, y, width } = this.request;
    const graphNodeArgs: ConstructorParameters<
      typeof IdentityBridgeGraphNodePresentation
    >[0] = {
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
    return new IdentityBridgeGraphNodePresentation(graphNodeArgs).node;
  }
}
export class IdentityBridgeEdgePresentation {
  constructor(private readonly request: IdentityBridgeGraphEdge) {}
  get edge(): IdentityBridgeEdge {
    const { id, source, target, relation, ariaLabel, lateralAccessPort } =
      this.request;
    const verified =
      relation === IdentityBridgeRelationKind.VerifiedDeviceAccess;
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
}
export class IdentityBridgeIdentityPresentation {
  constructor(private readonly request: IdentityBridgeIdentityDataRequest) {}
  get data(): IdentityBridgeIdentityData {
    const { input, flow, portMode, lateralAccessPort } = this.request;
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
}
export class IdentityBridgeProtectionPresentation {
  constructor(private readonly request: IdentityBridgeProtectionDataRequest) {}
  get data(): IdentityBridgeProtectionData {
    const { input, flow } = this.request;
    const passkeySummary =
      input.protectionSummary.kind === PasskeyCardSummaryKind.Present
        ? input.protectionSummary.summary
        : false;
    return {
      kind: IdentityBridgeNodeKind.Protection,
      flow,
      portMode: IdentityBridgePortMode.Source,
      label: passkeySummary ? passkeySummary.title : input.protectionLabel,
      caption: input.copy.protectionStage,
      description: passkeySummary
        ? passkeySummary.modeLabel
        : input.copy.protectionDeviceRelation,
      summary: input.protectionSummary,
      incomingRelation: "",
    };
  }
}
export class IdentityBridgeVaultPresentation {
  constructor(private readonly request: IdentityBridgeVaultDataRequest) {}
  get data(): IdentityBridgeVaultData {
    const { vault, input, flow, portMode, lateralAccessPort } = this.request;
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
}
export class IdentityBridgeDevicePresentation {
  constructor(private readonly request: IdentityBridgeDeviceDataRequest) {}
  get data(): IdentityBridgeDeviceData {
    const { input, flow, portMode, incomingRelation } = this.request;
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
}
