import { consumeEnrollmentFromLocation } from "$lib/enrollment-code";
import type { VaultIdleSessionTracker } from "$lib/vault-idle-session";
import { VaultStateSlices } from "$lib/vault/state/index.svelte";

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
  | { kind: SyncScheduleKind.Scheduled; timer: ReturnType<typeof setInterval> };
enum VaultInitializationKind {
  NotStarted = "not-started",
  Initializing = "initializing",
}

type VaultInitialization =
  | { kind: VaultInitializationKind.NotStarted }
  | { kind: VaultInitializationKind.Initializing; completion: Promise<void> };
enum EnrollmentLinkKind {
  Absent = "absent",
  Pending = "pending",
}

type EnrollmentLink =
  | { kind: EnrollmentLinkKind.Absent }
  | { kind: EnrollmentLinkKind.Pending; payload: string };

function initialEnrollmentLink(): EnrollmentLink {
  if (!("window" in globalThis)) return { kind: EnrollmentLinkKind.Absent };
  const payload = consumeEnrollmentFromLocation();
  return payload
    ? { kind: EnrollmentLinkKind.Pending, payload }
    : { kind: EnrollmentLinkKind.Absent };
}

export class VaultLifecycleState extends VaultStateSlices {
  private successDismissSchedule: SuccessDismissSchedule = {
    kind: SuccessDismissScheduleKind.Stopped,
  };

  get successDismissTimer(): ReturnType<typeof setTimeout> | void {
    if (
      this.successDismissSchedule.kind === SuccessDismissScheduleKind.Scheduled
    )
      return this.successDismissSchedule.timer;
    return;
  }
  get successDismissScheduled(): boolean {
    return (
      this.successDismissSchedule.kind === SuccessDismissScheduleKind.Scheduled
    );
  }

  set successDismissTimer(value: ReturnType<typeof setTimeout>) {
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

  private idleSessionTracking: IdleSessionTracking = {
    kind: IdleSessionTrackingKind.Inactive,
  };

  get idleSessionTracker(): VaultIdleSessionTracker | void {
    if (this.idleSessionTracking.kind === IdleSessionTrackingKind.Active)
      return this.idleSessionTracking.tracker;
    return;
  }

  set idleSessionTracker(value: VaultIdleSessionTracker) {
    this.idleSessionTracking = {
      kind: IdleSessionTrackingKind.Active,
      tracker: value,
    };
  }

  clearIdleSessionTracker(): void {
    this.idleSessionTracking = { kind: IdleSessionTrackingKind.Inactive };
  }

  private syncSchedule: SyncSchedule = { kind: SyncScheduleKind.Stopped };

  isSyncScheduled(): boolean {
    return this.syncSchedule.kind === SyncScheduleKind.Scheduled;
  }

  scheduleSync(callback: () => void, intervalMs: number): void {
    this.stopScheduledSync();
    this.syncSchedule = {
      kind: SyncScheduleKind.Scheduled,
      timer: setInterval(callback, intervalMs),
    };
  }

  stopScheduledSync(): boolean {
    if (this.syncSchedule.kind === SyncScheduleKind.Stopped) return false;
    clearInterval(this.syncSchedule.timer);
    this.syncSchedule = { kind: SyncScheduleKind.Stopped };
    return true;
  }

  private initialization: VaultInitialization = {
    kind: VaultInitializationKind.NotStarted,
  };

  get initPromise(): Promise<void> | void {
    if (this.initialization.kind === VaultInitializationKind.Initializing)
      return this.initialization.completion;
    return;
  }

  set initPromise(value: Promise<void>) {
    this.initialization = {
      kind: VaultInitializationKind.Initializing,
      completion: value,
    };
  }

  clearInitPromise(): void {
    this.initialization = { kind: VaultInitializationKind.NotStarted };
  }

  private enrollmentLink: EnrollmentLink = initialEnrollmentLink();

  get pendingEnrollmentFromUrl(): string | void {
    if (this.enrollmentLink.kind === EnrollmentLinkKind.Pending)
      return this.enrollmentLink.payload;
    return;
  }

  set pendingEnrollmentFromUrl(value: string) {
    this.enrollmentLink = { kind: EnrollmentLinkKind.Pending, payload: value };
  }

  clearPendingEnrollmentFromUrl(): void {
    this.enrollmentLink = { kind: EnrollmentLinkKind.Absent };
  }
}
