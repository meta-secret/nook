export enum DashboardLoadKind {
  Loading = "loading",
  Ready = "ready",
  Failed = "failed",
}

export type DashboardLoadState<ReadyView> =
  | { kind: typeof DashboardLoadKind.Loading }
  | { kind: typeof DashboardLoadKind.Ready; view: ReadyView }
  | { kind: typeof DashboardLoadKind.Failed };
