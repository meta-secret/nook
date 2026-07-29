import {
  EnrollmentLocationKind,
  consumeEnrollmentFromLocation,
} from '$lib/enrollment-code'
import type { VaultIdleSessionTracker } from '$lib/vault-idle-session'
import { VaultStateSlices } from '$lib/vault/state/index.svelte'

enum SuccessDismissScheduleKind {
  Stopped = 'stopped',
  Scheduled = 'scheduled',
}

type SuccessDismissSchedule =
  | { kind: SuccessDismissScheduleKind.Stopped }
  | {
      kind: SuccessDismissScheduleKind.Scheduled
      timer: ReturnType<typeof setTimeout>
    }
enum IdleSessionTrackingKind {
  Inactive = 'inactive',
  Active = 'active',
}

type IdleSessionTracking =
  | { kind: IdleSessionTrackingKind.Inactive }
  | { kind: IdleSessionTrackingKind.Active; tracker: VaultIdleSessionTracker }
enum SyncScheduleKind {
  Stopped = 'stopped',
  Scheduled = 'scheduled',
}

type SyncSchedule =
  | { kind: SyncScheduleKind.Stopped }
  | { kind: SyncScheduleKind.Scheduled; timer: ReturnType<typeof setInterval> }
export enum VaultInitializationKind {
  NotStarted = 'not-started',
  Initializing = 'initializing',
}

export type VaultInitialization =
  | { kind: VaultInitializationKind.NotStarted }
  | { kind: VaultInitializationKind.Initializing; completion: Promise<void> }
export enum EnrollmentLinkKind {
  Absent = 'absent',
  Pending = 'pending',
}

export type EnrollmentLink =
  | { kind: EnrollmentLinkKind.Absent }
  | { kind: EnrollmentLinkKind.Pending; payload: string }

function initialEnrollmentLink(): EnrollmentLink {
  if (!('window' in globalThis)) return { kind: EnrollmentLinkKind.Absent }
  const enrollment = consumeEnrollmentFromLocation()
  return enrollment.kind === EnrollmentLocationKind.Consumed
    ? { kind: EnrollmentLinkKind.Pending, payload: enrollment.payload }
    : { kind: EnrollmentLinkKind.Absent }
}

export class VaultLifecycleState extends VaultStateSlices {
  private successDismissSchedule: SuccessDismissSchedule = {
    kind: SuccessDismissScheduleKind.Stopped,
  }

  get successDismissScheduled(): boolean {
    return (
      this.successDismissSchedule.kind === SuccessDismissScheduleKind.Scheduled
    )
  }

  scheduleSuccessDismiss(value: ReturnType<typeof setTimeout>): void {
    this.successDismissSchedule = {
      kind: SuccessDismissScheduleKind.Scheduled,
      timer: value,
    }
  }

  clearSuccessDismissTimer(): void {
    this.successDismissSchedule = {
      kind: SuccessDismissScheduleKind.Stopped,
    }
  }

  cancelSuccessDismissTimer(): void {
    if (
      this.successDismissSchedule.kind === SuccessDismissScheduleKind.Scheduled
    ) {
      clearTimeout(this.successDismissSchedule.timer)
    }
    this.clearSuccessDismissTimer()
  }

  private idleSessionTracking: IdleSessionTracking = {
    kind: IdleSessionTrackingKind.Inactive,
  }

  hasIdleSessionTracker(): boolean {
    return this.idleSessionTracking.kind === IdleSessionTrackingKind.Active
  }

  setIdleSessionTracker(value: VaultIdleSessionTracker): void {
    this.idleSessionTracking = {
      kind: IdleSessionTrackingKind.Active,
      tracker: value,
    }
  }

  clearIdleSessionTracker(): void {
    this.idleSessionTracking = { kind: IdleSessionTrackingKind.Inactive }
  }

  startIdleSessionTracker(): void {
    if (this.idleSessionTracking.kind === IdleSessionTrackingKind.Active) {
      this.idleSessionTracking.tracker.start()
    }
  }

  stopIdleSessionTracker(): void {
    if (this.idleSessionTracking.kind === IdleSessionTrackingKind.Active) {
      this.idleSessionTracking.tracker.stop()
    }
  }

  private syncSchedule: SyncSchedule = { kind: SyncScheduleKind.Stopped }

  isSyncScheduled(): boolean {
    return this.syncSchedule.kind === SyncScheduleKind.Scheduled
  }

  scheduleSync(callback: () => void, intervalMs: number): void {
    this.stopScheduledSync()
    this.syncSchedule = {
      kind: SyncScheduleKind.Scheduled,
      timer: setInterval(callback, intervalMs),
    }
  }

  stopScheduledSync(): boolean {
    if (this.syncSchedule.kind === SyncScheduleKind.Stopped) return false
    clearInterval(this.syncSchedule.timer)
    this.syncSchedule = { kind: SyncScheduleKind.Stopped }
    return true
  }

  private initialization: VaultInitialization = {
    kind: VaultInitializationKind.NotStarted,
  }

  get vaultInitialization(): VaultInitialization {
    return this.initialization
  }

  beginInitialization(value: Promise<void>): void {
    this.initialization = {
      kind: VaultInitializationKind.Initializing,
      completion: value,
    }
  }

  clearInitPromise(): void {
    this.initialization = { kind: VaultInitializationKind.NotStarted }
  }

  private enrollmentLink: EnrollmentLink = initialEnrollmentLink()

  get enrollmentLinkState(): EnrollmentLink {
    return this.enrollmentLink
  }

  set pendingEnrollmentFromUrl(value: string) {
    this.enrollmentLink = { kind: EnrollmentLinkKind.Pending, payload: value }
  }

  clearPendingEnrollmentFromUrl(): void {
    this.enrollmentLink = { kind: EnrollmentLinkKind.Absent }
  }
}
