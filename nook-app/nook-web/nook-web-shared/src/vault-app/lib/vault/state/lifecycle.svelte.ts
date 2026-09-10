import { ActiveVaultSyncSchedule } from "$lib/vault/sync-schedule";
import { NookBrowserLocale } from "$app-wasm";
import {
  EnrollmentLocationKind,
  enrollmentBrowser,
} from "$lib/enrollment/code";
import {
  VaultIdleSessionStartKind,
  type VaultIdleSessionStart,
  type VaultIdleSessionTracker,
} from "$lib/vault/idle-session-tracker";
import { VaultStateSlices } from "$lib/vault/state/index.svelte";
import { VaultRuntimeState as VaultRuntimeSliceState } from "$lib/vault/state/runtime.svelte";

enum SuccessDismissScheduleKind {
  Stopped = "stopped",
  Scheduled = "scheduled",
}

type SuccessDismissSchedule =
  | { kind: SuccessDismissScheduleKind.Stopped }
  | {
      kind: SuccessDismissScheduleKind.Scheduled;
      timer: ReturnType<typeof setTimeout>;
    };
enum IdleSessionTrackingKind {
  Inactive = "inactive",
  Active = "active",
}

type IdleSessionTracking =
  | { kind: IdleSessionTrackingKind.Inactive }
  | { kind: IdleSessionTrackingKind.Active; tracker: VaultIdleSessionTracker };
enum SyncScheduleKind {
  Stopped = "stopped",
  Scheduled = "scheduled",
}

type SyncSchedule =
  | { kind: SyncScheduleKind.Stopped }
  | { kind: SyncScheduleKind.Scheduled; schedule: ActiveVaultSyncSchedule };
export enum VaultInitializationKind {
  NotStarted = "not-started",
  Initializing = "initializing",
}

export type VaultInitialization =
  | { kind: VaultInitializationKind.NotStarted }
  | { kind: VaultInitializationKind.Initializing; completion: Promise<void> };
export enum EnrollmentLinkKind {
  Absent = "absent",
  Pending = "pending",
}

export type EnrollmentLink =
  | { kind: EnrollmentLinkKind.Absent }
  | { kind: EnrollmentLinkKind.Pending; payload: string };

type LifecycleSyncSchedule = {
  readonly callback: () => void;
  readonly intervalMs: number;
};

function initialBrowserLocale(): NookBrowserLocale {
  return "window" in globalThis
    ? new NookBrowserLocale()
    : NookBrowserLocale.from_tags([]);
}

export class VaultLifecycleState extends VaultStateSlices {
  private initialEnrollmentLink(): EnrollmentLink {
    if (!("window" in globalThis)) return { kind: EnrollmentLinkKind.Absent };
    const enrollment = enrollmentBrowser.consumeEnrollmentFromLocation();
    return enrollment.kind === EnrollmentLocationKind.Consumed
      ? { kind: EnrollmentLinkKind.Pending, payload: enrollment.payload }
      : { kind: EnrollmentLinkKind.Absent };
  }

  constructor() {
    super(new VaultRuntimeSliceState(initialBrowserLocale()));
  }

  private successDismissSchedule: SuccessDismissSchedule = {
    kind: SuccessDismissScheduleKind.Stopped,
  };

  get successDismissScheduled(): boolean {
    return (
      this.successDismissSchedule.kind === SuccessDismissScheduleKind.Scheduled
    );
  }

  scheduleSuccessDismiss(value: ReturnType<typeof setTimeout>): void {
    this.successDismissSchedule = {
      kind: SuccessDismissScheduleKind.Scheduled,
      timer: value,
    };
  }

  clearSuccessDismissTimer(): void {
    this.successDismissSchedule = {
      kind: SuccessDismissScheduleKind.Stopped,
    };
  }

  cancelSuccessDismissTimer(): void {
    if (
      this.successDismissSchedule.kind === SuccessDismissScheduleKind.Scheduled
    ) {
      clearTimeout(this.successDismissSchedule.timer);
    }
    this.clearSuccessDismissTimer();
  }

  private activeIdleSession: VaultIdleSessionStart = {
    kind: VaultIdleSessionStartKind.Unavailable,
  };
  private idleSessionTracking: IdleSessionTracking = {
    kind: IdleSessionTrackingKind.Inactive,
  };

  hasIdleSessionTracker(): boolean {
    return this.idleSessionTracking.kind === IdleSessionTrackingKind.Active;
  }

  setIdleSessionTracker(value: VaultIdleSessionTracker): void {
    this.stopIdleSessionTracker();
    this.idleSessionTracking = {
      kind: IdleSessionTrackingKind.Active,
      tracker: value,
    };
  }

  clearIdleSessionTracker(): void {
    this.stopIdleSessionTracker();
    this.idleSessionTracking = { kind: IdleSessionTrackingKind.Inactive };
  }

  startIdleSessionTracker(): void {
    if (this.idleSessionTracking.kind === IdleSessionTrackingKind.Active) {
      this.stopIdleSessionTracker();
      this.activeIdleSession = this.idleSessionTracking.tracker.start();
    }
  }

  stopIdleSessionTracker(): void {
    const active = this.activeIdleSession;
    this.activeIdleSession = { kind: VaultIdleSessionStartKind.Unavailable };
    if (active.kind === VaultIdleSessionStartKind.Tracking)
      active.session.stop();
  }

  private syncSchedule: SyncSchedule = { kind: SyncScheduleKind.Stopped };

  isSyncScheduled(): boolean {
    return this.syncSchedule.kind === SyncScheduleKind.Scheduled;
  }

  scheduleSync({ callback, intervalMs }: LifecycleSyncSchedule): void {
    this.stopScheduledSync();
    this.syncSchedule = {
      kind: SyncScheduleKind.Scheduled,
      // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      schedule: new ActiveVaultSyncSchedule({ callback, intervalMs }),
    };
  }

  stopScheduledSync(): boolean {
    if (this.syncSchedule.kind === SyncScheduleKind.Stopped) return false;
    this.syncSchedule.schedule.stop();
    this.syncSchedule = { kind: SyncScheduleKind.Stopped };
    return true;
  }

  private initialization: VaultInitialization = {
    kind: VaultInitializationKind.NotStarted,
  };

  get vaultInitialization(): VaultInitialization {
    return this.initialization;
  }

  beginInitialization(value: Promise<void>): void {
    this.initialization = {
      kind: VaultInitializationKind.Initializing,
      completion: value,
    };
  }

  clearInitPromise(): void {
    this.initialization = { kind: VaultInitializationKind.NotStarted };
  }

  private enrollmentLink: EnrollmentLink = this.initialEnrollmentLink();

  get enrollmentLinkState(): EnrollmentLink {
    return this.enrollmentLink;
  }

  set pendingEnrollmentFromUrl(value: string) {
    this.enrollmentLink = { kind: EnrollmentLinkKind.Pending, payload: value };
  }

  clearPendingEnrollmentFromUrl(): void {
    this.enrollmentLink = { kind: EnrollmentLinkKind.Absent };
  }
}
