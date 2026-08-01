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

export enum ProviderSaveKind {
  Idle = "idle",
  Saving = "saving",
  Failed = "failed",
}

export enum DashboardFocusTargetKind {
  None = "none",
  DeviceIdentityDetails = "device-identity-details",
  RetryResult = "retry-result",
}

export enum DevicesAccessNudgePreference {
  Visible = "visible",
  Dismissed = "dismissed",
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

export function readDevicesAccessNudgeStorage(
  storage: Storage,
  storageKey: string,
): DevicesAccessNudgeStorageState {
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
