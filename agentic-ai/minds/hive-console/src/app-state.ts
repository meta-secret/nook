import type { ObservedTask, ObserverSnapshot } from './types';

export enum ObserverFeedKind {
  NotLoaded = 'not-loaded',
  Loaded = 'loaded',
}

export type ObserverFeed =
  | { kind: ObserverFeedKind.NotLoaded }
  | { kind: ObserverFeedKind.Loaded; snapshot: ObserverSnapshot };

export enum TaskSelectionKind {
  None = 'none',
  Selected = 'selected',
}

export type TaskSelection =
  | { kind: TaskSelectionKind.None }
  | { kind: TaskSelectionKind.Selected; taskId: string };

export enum DurableTaskLookupKind {
  NotFound = 'not-found',
  Found = 'found',
}

export type DurableTaskLookup =
  | { kind: DurableTaskLookupKind.NotFound }
  | { kind: DurableTaskLookupKind.Found; task: ObservedTask };

export enum SelectedTaskKind {
  Closed = 'closed',
  Open = 'open',
}

export type SelectedTask =
  | { kind: SelectedTaskKind.Closed }
  | { kind: SelectedTaskKind.Open; task: ObservedTask };

export enum PollScheduleKind {
  Stopped = 'stopped',
  Scheduled = 'scheduled',
}

export type PollSchedule =
  | { kind: PollScheduleKind.Stopped }
  | {
      kind: PollScheduleKind.Scheduled;
      timer: ReturnType<typeof setTimeout>;
    };

export enum SnapshotLoadRequestKind {
  ScheduledRefresh = 'scheduled-refresh',
  ManualRetry = 'manual-retry',
}

export type SnapshotLoadRequest =
  | { kind: SnapshotLoadRequestKind.ScheduledRefresh; signal: AbortSignal }
  | { kind: SnapshotLoadRequestKind.ManualRetry };
