import type { JoinRequest, VaultMember } from '$lib/nook'
import {
  DeviceProtectionStatus,
  JoinEnrollmentState,
  RemoteVaultRecoveryState,
  type NookPasswordEntrySummary,
  type NookVaultManager,
  type PasswordEntryId,
} from '$app-wasm'
enum ManagerSessionKind {
  Locked = 'locked',
  Unlocked = 'unlocked',
}

type ManagerSession =
  | { kind: ManagerSessionKind.Locked }
  | { kind: ManagerSessionKind.Unlocked; manager: NookVaultManager }
export enum PasswordEntrySelectionKind {
  NotSelected = 'not-selected',
  Selected = 'selected',
}

export type PasswordEntrySelection =
  | { kind: PasswordEntrySelectionKind.NotSelected }
  | { kind: PasswordEntrySelectionKind.Selected; entryId: PasswordEntryId }
enum EnrollmentEntryKind {
  Inactive = 'inactive',
  Active = 'active',
}

type EnrollmentEntry =
  | { kind: EnrollmentEntryKind.Inactive }
  | { kind: EnrollmentEntryKind.Active; entryId: PasswordEntryId }
export class VaultSessionState {
  private managerState = $state<ManagerSession>({
    kind: ManagerSessionKind.Locked,
  })
  get manager(): NookVaultManager | void {
    if (this.managerState.kind === ManagerSessionKind.Unlocked)
      return this.managerState.manager
    return
  }
  set manager(value: NookVaultManager) {
    this.managerState = { kind: ManagerSessionKind.Unlocked, manager: value }
  }
  clearManager(): void {
    this.managerState = { kind: ManagerSessionKind.Locked }
  }
  deviceProtectionStatus = $state<DeviceProtectionStatus>(
    DeviceProtectionStatus.Loading,
  )
  deviceProtectionLockedStatus = $state<DeviceProtectionStatus>(
    DeviceProtectionStatus.Passkey,
  )
  isAuthenticated = $state(false)
  /** True when the login gate should explain that the last lock was due to idle timeout. */
  sessionExpiredByIdle = $state(false)

  deviceId = $state('')
  devicePublicKey = $state('')
  pendingJoins = $state<JoinRequest[]>([])
  vaultMembers = $state<VaultMember[]>([])
  enrollSecretsKey = $state('')
  enrollMembersKey = $state('')
  sharedJoinerIdentity = $state('')
  sharedGrantInstructions = $state('')
  joinEnrollmentPrompt = $state<JoinEnrollmentState>(JoinEnrollmentState.None)
  /**
   * True from the moment this device sends a join request until it unlocks.
   * Survives the join dialog being dismissed, so background sync can still
   * auto-connect when the approval lands.
   */
  awaitingJoinApproval = $state(false)

  loginPasswordPrompt = $state(false)
  remoteVaultRecoveryState = $state<RemoteVaultRecoveryState>(
    RemoteVaultRecoveryState.None,
  )
  isPasswordBusy = $state(false)
  passwordError = $state('')
  enrollmentCode = $state('')
  prefillEnrollmentCode = $state('')
  enrollmentFromUrlPending = $state(false)
  loginEnrollmentCode = $state('')
  passwordEntries = $state<NookPasswordEntrySummary[]>([])
  private selectedPasswordEntryState = $state<PasswordEntrySelection>({
    kind: PasswordEntrySelectionKind.NotSelected,
  })
  get selectedPasswordEntry(): PasswordEntrySelection {
    return this.selectedPasswordEntryState
  }
  set selectedPasswordEntry(value: PasswordEntrySelection) {
    this.selectedPasswordEntryState = value
  }
  get selectedPasswordEntryId(): PasswordEntryId | void {
    if (
      this.selectedPasswordEntryState.kind ===
      PasswordEntrySelectionKind.Selected
    )
      return this.selectedPasswordEntryState.entryId
    return
  }
  set selectedPasswordEntryId(value: PasswordEntryId) {
    this.selectedPasswordEntryState = {
      kind: PasswordEntrySelectionKind.Selected,
      entryId: value,
    }
  }
  clearSelectedPasswordEntry(): void {
    this.selectedPasswordEntryState = {
      kind: PasswordEntrySelectionKind.NotSelected,
    }
  }

  private activeEnrollmentEntryState = $state<EnrollmentEntry>({
    kind: EnrollmentEntryKind.Inactive,
  })
  get activeEnrollmentEntryId(): PasswordEntryId | void {
    if (this.activeEnrollmentEntryState.kind === EnrollmentEntryKind.Active)
      return this.activeEnrollmentEntryState.entryId
    return
  }
  set activeEnrollmentEntryId(value: PasswordEntryId) {
    this.activeEnrollmentEntryState = {
      kind: EnrollmentEntryKind.Active,
      entryId: value,
    }
  }
  clearActiveEnrollmentEntry(): void {
    this.activeEnrollmentEntryState = { kind: EnrollmentEntryKind.Inactive }
  }
}
