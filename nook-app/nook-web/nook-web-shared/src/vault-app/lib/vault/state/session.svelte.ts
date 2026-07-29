import type { JoinRequest, VaultMember } from "$lib/nook";
import {
  EMPTY_VALUE,
  presentValue,
  type ValueState,
} from "../../../../explicit-state";
import {
  DeviceProtectionStatus,
  JoinEnrollmentState,
  RemoteVaultRecoveryState,
  type NookPasswordEntrySummary,
  type NookVaultManager,
  type PasswordEntryId,
} from "$app-wasm";
export class VaultSessionState {
  private managerState = $state<ValueState<NookVaultManager>>(EMPTY_VALUE);
  get manager(): NookVaultManager | void {
    if (this.managerState.kind === "present") return this.managerState.value;
    return;
  }
  set manager(value: NookVaultManager | void) {
    this.managerState =
      typeof value === "undefined" ? EMPTY_VALUE : presentValue(value);
  }
  clearManager(): void {
    this.managerState = EMPTY_VALUE;
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
  private selectedPasswordEntryState =
    $state<ValueState<PasswordEntryId>>(EMPTY_VALUE);
  get selectedPasswordEntryId(): PasswordEntryId | void {
    if (this.selectedPasswordEntryState.kind === "present")
      return this.selectedPasswordEntryState.value;
    return;
  }
  set selectedPasswordEntryId(value: PasswordEntryId | void) {
    this.selectedPasswordEntryState =
      typeof value === "undefined" ? EMPTY_VALUE : presentValue(value);
  }
  clearSelectedPasswordEntry(): void {
    this.selectedPasswordEntryState = EMPTY_VALUE;
  }

  private activeEnrollmentEntryState =
    $state<ValueState<PasswordEntryId>>(EMPTY_VALUE);
  get activeEnrollmentEntryId(): PasswordEntryId | void {
    if (this.activeEnrollmentEntryState.kind === "present")
      return this.activeEnrollmentEntryState.value;
    return;
  }
  set activeEnrollmentEntryId(value: PasswordEntryId | void) {
    this.activeEnrollmentEntryState =
      typeof value === "undefined" ? EMPTY_VALUE : presentValue(value);
  }
  clearActiveEnrollmentEntry(): void {
    this.activeEnrollmentEntryState = EMPTY_VALUE;
  }
}
