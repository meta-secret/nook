import { err, ok, type Result } from "neverthrow";
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from "$lib/runtime/storage-failure";
import type { JoinRequest, VaultMember } from "$lib/nook";
import {
  DeviceProtectionStatus,
  JoinEnrollmentState,
  RemoteVaultRecoveryState,
  type NookVaultManager,
} from "$app-wasm";
export enum ManagerSessionKind {
  Unavailable = "unavailable",
  Available = "available",
}

export type ManagerSession =
  | { kind: ManagerSessionKind.Unavailable }
  | { kind: ManagerSessionKind.Available; manager: NookVaultManager };
export class VaultSessionState {
  private managerState = $state<ManagerSession>({
    kind: ManagerSessionKind.Unavailable,
  });
  get managerSession(): ManagerSession {
    return this.managerState;
  }
  get hasManager(): boolean {
    return this.managerState.kind === ManagerSessionKind.Available;
  }
  admitManager(): Result<NookVaultManager, VaultStorageFailure> {
    return this.managerState.kind === ManagerSessionKind.Available
      ? ok(this.managerState.manager)
      : err(
          new VaultStorageFailure(VaultStorageFailureKind.ManagerUnavailable),
        );
  }
  openManager(value: NookVaultManager): void {
    this.managerState = { kind: ManagerSessionKind.Available, manager: value };
  }
  clearManager(): void {
    this.managerState = { kind: ManagerSessionKind.Unavailable };
  }
  deviceProtectionStatus = $state<DeviceProtectionStatus>(
    DeviceProtectionStatus.Loading,
  );
  deviceProtectionLockedStatus = $state<DeviceProtectionStatus>(
    DeviceProtectionStatus.Passkey,
  );
  isAuthenticated = $state(false);
  sessionEpoch = $state(0);
  /** True when the login gate should explain that the last lock was due to idle timeout. */
  sessionExpiredByIdle = $state(false);

  deviceId = $state("");
  devicePublicKey = $state("");
  pendingJoins = $state<JoinRequest[]>([]);
  vaultMembers = $state<VaultMember[]>([]);
  enrollSecretsKey = $state("");
  enrollMembersKey = $state("");
  joinEnrollmentPrompt = $state<JoinEnrollmentState>(JoinEnrollmentState.None);
  /**
   * True from the moment this device sends a join request until it unlocks.
   * Survives the join dialog being dismissed, so background sync can still
   * auto-connect when the approval lands.
   */
  awaitingJoinApproval = $state(false);

  /**
   * Whether the current device identity can unwrap vault keys for the selected
   * login vault. Unknown until assess runs with a device identity in memory.
   */
  remoteVaultRecoveryState = $state<RemoteVaultRecoveryState>(
    RemoteVaultRecoveryState.None,
  );
  /** A one-time invite code is being issued or joined; sync waits. */
  isInviteBusy = $state(false);
  enrollmentCode = $state("");
  prefillEnrollmentCode = $state("");
  enrollmentFromUrlPending = $state(false);
  loginEnrollmentCode = $state("");
}
