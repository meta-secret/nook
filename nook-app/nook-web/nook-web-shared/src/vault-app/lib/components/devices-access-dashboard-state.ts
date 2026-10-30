export enum IdentityLifecycleMutationOutcome {
  CreationPrepared = "creation-prepared",
  Activated = "activated",
}

export enum DashboardTextKind {
  Unknown = "unknown",
  Known = "known",
}

export enum AccessNodeDetailKind {
  Absent = "absent",
  Identifier = "identifier",
  Summary = "summary",
}

/**
 * The single supporting line under a node title: one short public identifier
 * rendered as data, a plain-language summary, or nothing yet.
 */
export type AccessNodeDetail =
  | { kind: typeof AccessNodeDetailKind.Absent }
  | { kind: typeof AccessNodeDetailKind.Identifier; value: string }
  | { kind: typeof AccessNodeDetailKind.Summary; value: string };

export class KnownDashboardText {
  readonly kind = DashboardTextKind.Known;
  constructor(readonly value: string) {}

  displayText(): string {
    return this.value;
  }

  identifierDetail(): AccessNodeDetail {
    return { kind: AccessNodeDetailKind.Identifier, value: this.value };
  }
}

export class UnknownDashboardText {
  readonly kind = DashboardTextKind.Unknown;

  displayText(unavailable: () => string): string {
    return unavailable();
  }

  identifierDetail(): AccessNodeDetail {
    return { kind: AccessNodeDetailKind.Absent };
  }
}

export type DashboardText = KnownDashboardText | UnknownDashboardText;

export enum DashboardTimestampKind {
  Unavailable = "unavailable",
  NotYetObserved = "not-yet-observed",
  Known = "known",
}

export type DashboardTimestamp =
  | { kind: typeof DashboardTimestampKind.Unavailable }
  | { kind: typeof DashboardTimestampKind.NotYetObserved }
  | { kind: typeof DashboardTimestampKind.Known; value: string };

export type DashboardView = {
  protection: DeviceAccessProtectionKind;
  identityState: DeviceAccessIdentityState;
  deviceId: DashboardText;
  credentialId: DashboardText;
  passkeyName: DashboardText;
  providerLabel: DashboardText;
  createdAt: DashboardTimestamp;
  lastUsedAt: DashboardTimestamp;
  keeper: PasskeyKeeperKind;
  vaults: VaultAccessView[];
};
import type {
  DeviceAccessIdentityState,
  DeviceAccessProtectionKind,
  PasskeyKeeperKind,
} from "$app-wasm";
import type { VaultAccessView } from "./devices-access/access-chain";
