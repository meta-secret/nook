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

export enum DevicesAccessNudgePreference {
  Visible = "visible",
  Dismissed = "dismissed",
}

export function parseDevicesAccessNudgePreference(
  serialized: string | null,
): DevicesAccessNudgePreference {
  return serialized === DevicesAccessNudgePreference.Dismissed ||
    serialized === "1"
    ? DevicesAccessNudgePreference.Dismissed
    : DevicesAccessNudgePreference.Visible;
}
