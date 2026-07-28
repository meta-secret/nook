import type { JoinRequest, VaultMember } from "$lib/nook";
import {
  DeviceProtectionStatus,
  JoinEnrollmentState,
  RemoteVaultRecoveryState,
  type NookPasswordEntrySummary,
  type NookVaultManager,
  type PasswordEntryId,
} from "$app-wasm";
export class VaultSessionState {
  manager = $state<NookVaultManager>();
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
  selectedPasswordEntryId = $state<PasswordEntryId>();
  activeEnrollmentEntryId = $state<PasswordEntryId>();
}
