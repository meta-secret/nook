import type { AppLogsResponse } from "$lib/app-logs-api";

export enum LogsPageStateKind {
  Loading = "loading",
  Loaded = "loaded",
  Failed = "failed",
}

export type LogsPageState =
  | { kind: LogsPageStateKind.Loading }
  | { kind: LogsPageStateKind.Loaded; payload: AppLogsResponse }
  | { kind: LogsPageStateKind.Failed; message: string };
