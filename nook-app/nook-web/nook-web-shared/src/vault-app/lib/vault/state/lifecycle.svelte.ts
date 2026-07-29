import { consumeEnrollmentFromLocation } from "$lib/enrollment-code";
import type { VaultIdleSessionTracker } from "$lib/vault-idle-session";
import { VaultStateSlices } from "$lib/vault/state/index.svelte";

type SuccessDismissSchedule =
  | { kind: "stopped" }
  | { kind: "scheduled"; timer: ReturnType<typeof setTimeout> };
type IdleSessionTracking =
  | { kind: "inactive" }
  | { kind: "active"; tracker: VaultIdleSessionTracker };
type SyncSchedule =
  | { kind: "stopped" }
  | { kind: "scheduled"; timer: ReturnType<typeof setInterval> };
type VaultInitialization =
  | { kind: "not-started" }
  | { kind: "initializing"; completion: Promise<void> };
type EnrollmentLink = { kind: "absent" } | { kind: "pending"; payload: string };

function initialEnrollmentLink(): EnrollmentLink {
  if (typeof window === "undefined") return { kind: "absent" };
  const payload = consumeEnrollmentFromLocation();
  return payload ? { kind: "pending", payload } : { kind: "absent" };
}

export class VaultLifecycleState extends VaultStateSlices {
  private successDismissSchedule: SuccessDismissSchedule = { kind: "stopped" };

  get successDismissTimer(): ReturnType<typeof setTimeout> | void {
    if (this.successDismissSchedule.kind === "scheduled")
      return this.successDismissSchedule.timer;
    return;
  }

  set successDismissTimer(value: ReturnType<typeof setTimeout> | void) {
    this.successDismissSchedule =
      typeof value === "undefined"
        ? { kind: "stopped" }
        : { kind: "scheduled", timer: value };
  }

  clearSuccessDismissTimer(): void {
    this.successDismissSchedule = { kind: "stopped" };
  }

  private idleSessionTracking: IdleSessionTracking = { kind: "inactive" };

  get idleSessionTracker(): VaultIdleSessionTracker | void {
    if (this.idleSessionTracking.kind === "active")
      return this.idleSessionTracking.tracker;
    return;
  }

  set idleSessionTracker(value: VaultIdleSessionTracker | void) {
    this.idleSessionTracking =
      typeof value === "undefined"
        ? { kind: "inactive" }
        : { kind: "active", tracker: value };
  }

  clearIdleSessionTracker(): void {
    this.idleSessionTracking = { kind: "inactive" };
  }

  private syncSchedule: SyncSchedule = { kind: "stopped" };

  get syncTimer(): ReturnType<typeof setInterval> | void {
    if (this.syncSchedule.kind === "scheduled") return this.syncSchedule.timer;
    return;
  }

  set syncTimer(value: ReturnType<typeof setInterval> | void) {
    this.syncSchedule =
      typeof value === "undefined"
        ? { kind: "stopped" }
        : { kind: "scheduled", timer: value };
  }

  clearSyncTimer(): void {
    this.syncSchedule = { kind: "stopped" };
  }

  private initialization: VaultInitialization = { kind: "not-started" };

  get initPromise(): Promise<void> | void {
    if (this.initialization.kind === "initializing")
      return this.initialization.completion;
    return;
  }

  set initPromise(value: Promise<void> | void) {
    this.initialization =
      typeof value === "undefined"
        ? { kind: "not-started" }
        : { kind: "initializing", completion: value };
  }

  clearInitPromise(): void {
    this.initialization = { kind: "not-started" };
  }

  private enrollmentLink: EnrollmentLink = initialEnrollmentLink();

  get pendingEnrollmentFromUrl(): string | void {
    if (this.enrollmentLink.kind === "pending")
      return this.enrollmentLink.payload;
    return;
  }

  set pendingEnrollmentFromUrl(value: string | void) {
    this.enrollmentLink =
      typeof value === "undefined"
        ? { kind: "absent" }
        : { kind: "pending", payload: value };
  }

  clearPendingEnrollmentFromUrl(): void {
    this.enrollmentLink = { kind: "absent" };
  }
}
