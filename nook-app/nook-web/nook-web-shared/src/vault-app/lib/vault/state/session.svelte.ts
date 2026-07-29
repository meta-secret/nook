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
  get manager(): NookVaultManager | undefined {
    return this.managerState.kind === "present"
      ? this.managerState.value
      : undefined;
  }
  set manager(value: NookVaultManager | undefined) {
    this.managerState = value === undefined ? EMPTY_VALUE : presentValue(value);
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
  get selectedPasswordEntryId(): PasswordEntryId | undefined {
    return this.selectedPasswordEntryState.kind === "present"
      ? this.selectedPasswordEntryState.value
      : undefined;
  }
  set selectedPasswordEntryId(value: PasswordEntryId | undefined) {
    this.selectedPasswordEntryState =
      value === undefined ? EMPTY_VALUE : presentValue(value);
  }

  private activeEnrollmentEntryState =
    $state<ValueState<PasswordEntryId>>(EMPTY_VALUE);
  get activeEnrollmentEntryId(): PasswordEntryId | undefined {
    return this.activeEnrollmentEntryState.kind === "present"
      ? this.activeEnrollmentEntryState.value
      : undefined;
  }
  set activeEnrollmentEntryId(value: PasswordEntryId | undefined) {
    this.activeEnrollmentEntryState =
      value === undefined ? EMPTY_VALUE : presentValue(value);
  }
}
