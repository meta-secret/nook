type ProviderSaveFocusRequest = {
  readonly unlockSelected: boolean;
  readonly control: DashboardElement;
};

type DevicesAccessNudgeVisibility = {
  readonly hasActiveLocalVault: boolean;
  readonly localVaultCount: number;
  readonly preference: DevicesAccessNudgePreference;
};

type DevicesAccessNudgeStorageRead = {
  readonly storage: Storage;
  readonly storageKey: string;
};

export enum DashboardLoadKind {
  Loading = "loading",
  Ready = "ready",
  Failed = "failed",
}

export type DashboardLoadState<ReadyView> =
  | { kind: typeof DashboardLoadKind.Loading }
  | { kind: typeof DashboardLoadKind.Ready; view: ReadyView }
  | { kind: typeof DashboardLoadKind.Failed };

export enum DashboardTextKind {
  Unknown = "unknown",
  Known = "known",
}

export type DashboardText =
  | { kind: typeof DashboardTextKind.Unknown }
  | { kind: typeof DashboardTextKind.Known; value: string };

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
  userHandleId: DashboardText;
  passkeyName: DashboardText;
  providerLabel: DashboardText;
  createdAt: DashboardTimestamp;
  lastUsedAt: DashboardTimestamp;
  attachment: NookPasskeyAttachmentState;
  transports: PasskeyTransport[];
  backupState: NookPasskeyBackupState;
  aaguid: DashboardText;
  keeper: PasskeyKeeperKind;
  observedBrowser: PasskeyObservedBrowser;
  observedPlatform: PasskeyObservedPlatform;
  vaults: VaultAccessView[];
};

export enum DevicesAccessLayoutKind {
  Graph = "graph",
  List = "list",
}

export enum ProviderSaveKind {
  Idle = "idle",
  Saving = "saving",
  Failed = "failed",
}

export enum DashboardFocusTargetKind {
  None = "none",
  ChainSelection = "chain-selection",
  RetryResult = "retry-result",
}

export enum DashboardElementKind {
  Mounted = "mounted",
  Missing = "missing",
}

/** A dashboard control can be gone by the time an awaited reload settles. */
export type DashboardElement =
  | { kind: typeof DashboardElementKind.Mounted; element: HTMLElement }
  | { kind: typeof DashboardElementKind.Missing };

export function dashboardElement(testId: string): DashboardElement {
  const element = document.querySelector<HTMLElement>(
    `[data-testid="${testId}"]`,
  );
  return element
    ? { kind: DashboardElementKind.Mounted, element }
    : { kind: DashboardElementKind.Missing };
}

export enum ProviderSaveFocusKind {
  Control = "control",
  SelectedChainLink = "selected-chain-link",
}

export type ProviderSaveFocus =
  | { kind: typeof ProviderSaveFocusKind.Control; element: HTMLElement }
  | { kind: typeof ProviderSaveFocusKind.SelectedChainLink };

/**
 * A provider save can outlive the panel that started it: selecting another link
 * unmounts the input the save would return focus to. Focus then belongs to the
 * link the person is actually looking at, never to the document body.
 */
export function providerSaveFocus({
  unlockSelected,
  control,
}: ProviderSaveFocusRequest): ProviderSaveFocus {
  return unlockSelected && control.kind === DashboardElementKind.Mounted
    ? { kind: ProviderSaveFocusKind.Control, element: control.element }
    : { kind: ProviderSaveFocusKind.SelectedChainLink };
}

export enum DevicesAccessNudgePreference {
  Visible = "visible",
  Dismissed = "dismissed",
}

export function shouldShowDevicesAccessNudge({
  hasActiveLocalVault,
  localVaultCount,
  preference,
}: DevicesAccessNudgeVisibility): boolean {
  return (
    !hasActiveLocalVault &&
    localVaultCount === 0 &&
    preference === DevicesAccessNudgePreference.Visible
  );
}

export enum DevicesAccessTriggerKind {
  Header = "header",
  Nudge = "nudge",
}

export enum DevicesAccessHostMountKind {
  Unmounted = "unmounted",
  Mounted = "mounted",
}

export type DevicesAccessHostMount =
  | { kind: typeof DevicesAccessHostMountKind.Unmounted }
  | {
      kind: typeof DevicesAccessHostMountKind.Mounted;
      element: HTMLDivElement;
    };

export enum DevicesAccessNudgeStorageKind {
  Missing = "missing",
  Stored = "stored",
}

export type DevicesAccessNudgeStorageState =
  | { kind: typeof DevicesAccessNudgeStorageKind.Missing }
  | {
      kind: typeof DevicesAccessNudgeStorageKind.Stored;
      serialized: string;
    };

export function readDevicesAccessNudgeStorage({
  storage,
  storageKey,
}: DevicesAccessNudgeStorageRead): DevicesAccessNudgeStorageState {
  const serialized = storage.getItem(storageKey);
  return typeof serialized === "string"
    ? { kind: DevicesAccessNudgeStorageKind.Stored, serialized }
    : { kind: DevicesAccessNudgeStorageKind.Missing };
}

export function parseDevicesAccessNudgePreference(
  storageState: DevicesAccessNudgeStorageState,
): DevicesAccessNudgePreference {
  return storageState.kind === DevicesAccessNudgeStorageKind.Stored &&
    (storageState.serialized === DevicesAccessNudgePreference.Dismissed ||
      storageState.serialized === "1")
    ? DevicesAccessNudgePreference.Dismissed
    : DevicesAccessNudgePreference.Visible;
}
import type {
  DeviceAccessIdentityState,
  DeviceAccessProtectionKind,
  NookPasskeyAttachmentState,
  NookPasskeyBackupState,
  PasskeyKeeperKind,
  PasskeyObservedBrowser,
  PasskeyObservedPlatform,
  PasskeyTransport,
} from "$app-wasm";
import type { VaultAccessView } from "./devices-access/access-chain";
