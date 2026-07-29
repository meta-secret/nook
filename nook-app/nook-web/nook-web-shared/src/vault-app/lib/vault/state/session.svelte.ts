import type { JoinRequest, VaultMember } from "$lib/nook";
import {
  DeviceProtectionStatus,
  JoinEnrollmentState,
  RemoteVaultRecoveryState,
  type NookPasswordEntrySummary,
  type NookVaultManager,
  type PasswordEntryId,
} from "$app-wasm";
type ManagerSession =
  | { kind: "locked" }
  | { kind: "unlocked"; manager: NookVaultManager };
type PasswordEntrySelection =
  | { kind: "not-selected" }
  | { kind: "selected"; entryId: PasswordEntryId };
type EnrollmentEntry =
  | { kind: "inactive" }
  | { kind: "active"; entryId: PasswordEntryId };
export class VaultSessionState {
  private managerState = $state<ManagerSession>({ kind: "locked" });
  get manager(): NookVaultManager | void {
    if (this.managerState.kind === "unlocked") return this.managerState.manager;
    return;
  }
  set manager(value: NookVaultManager) {
    this.managerState = { kind: "unlocked", manager: value };
  }
  clearManager(): void {
    this.managerState = { kind: "locked" };
  }
  deviceProtectionStatus = $state<DeviceProtectionStatus>(
    DeviceProtectionStatus.Loading,
  );
  deviceProtectionLockedStatus = $state<DeviceProtectionStatus>(
    DeviceProtectionStatus.Passkey,
  );
  isAuthenticated = $state(false);
  /** True when the login gate should explain that the last lock was due to idle timeout. */
  sessionExpiredByIdle = $state(false);

  deviceId = $state("");
  devicePublicKey = $state("");
  pendingJoins = $state<JoinRequest[]>([]);
  vaultMembers = $state<VaultMember[]>([]);
  enrollSecretsKey = $state("");
  enrollMembersKey = $state("");
  sharedJoinerIdentity = $state("");
  sharedGrantInstructions = $state("");
  joinEnrollmentPrompt = $state<JoinEnrollmentState>(JoinEnrollmentState.None);
  /**
   * True from the moment this device sends a join request until it unlocks.
   * Survives the join dialog being dismissed, so background sync can still
   * auto-connect when the approval lands.
   */
  awaitingJoinApproval = $state(false);

  loginPasswordPrompt = $state(false);
  remoteVaultRecoveryState = $state<RemoteVaultRecoveryState>(
    RemoteVaultRecoveryState.None,
  );
  isPasswordBusy = $state(false);
  passwordError = $state("");
  enrollmentCode = $state("");
  prefillEnrollmentCode = $state("");
  enrollmentFromUrlPending = $state(false);
  loginEnrollmentCode = $state("");
  passwordEntries = $state<NookPasswordEntrySummary[]>([]);
  private selectedPasswordEntryState = $state<PasswordEntrySelection>({
    kind: "not-selected",
  });
  get selectedPasswordEntryId(): PasswordEntryId | void {
    if (this.selectedPasswordEntryState.kind === "selected")
      return this.selectedPasswordEntryState.entryId;
    return;
  }
  set selectedPasswordEntryId(value: PasswordEntryId) {
    this.selectedPasswordEntryState = { kind: "selected", entryId: value };
  }
  clearSelectedPasswordEntry(): void {
    this.selectedPasswordEntryState = { kind: "not-selected" };
  }

  private activeEnrollmentEntryState = $state<EnrollmentEntry>({
    kind: "inactive",
  });
  get activeEnrollmentEntryId(): PasswordEntryId | void {
    if (this.activeEnrollmentEntryState.kind === "active")
      return this.activeEnrollmentEntryState.entryId;
    return;
  }
  set activeEnrollmentEntryId(value: PasswordEntryId) {
    this.activeEnrollmentEntryState = { kind: "active", entryId: value };
  }
  clearActiveEnrollmentEntry(): void {
    this.activeEnrollmentEntryState = { kind: "inactive" };
  }
}
