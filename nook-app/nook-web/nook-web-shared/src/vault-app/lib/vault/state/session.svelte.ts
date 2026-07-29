import type { JoinRequest, VaultMember } from '$lib/nook'
import {
  DeviceProtectionStatus,
  JoinEnrollmentState,
  RemoteVaultRecoveryState,
  type NookPasswordEntrySummary,
  type NookVaultManager,
  type PasswordEntryId,
} from '$app-wasm'
export enum ManagerSessionKind {
  Locked = 'locked',
  Unlocked = 'unlocked',
}

export type ManagerSession =
  | { kind: ManagerSessionKind.Locked }
  | { kind: ManagerSessionKind.Unlocked; manager: NookVaultManager }
export enum PasswordEntrySelectionKind {
  NotSelected = 'not-selected',
  Selected = 'selected',
}

export type PasswordEntrySelection =
  | { kind: PasswordEntrySelectionKind.NotSelected }
  | { kind: PasswordEntrySelectionKind.Selected; entryId: PasswordEntryId }
export enum EnrollmentEntryKind {
  Inactive = 'inactive',
  Active = 'active',
}

export type EnrollmentEntry =
  | { kind: EnrollmentEntryKind.Inactive }
  | { kind: EnrollmentEntryKind.Active; entryId: PasswordEntryId }
export class VaultSessionState {
  private managerState = $state<ManagerSession>({
    kind: ManagerSessionKind.Locked,
  })
  get managerSession(): ManagerSession {
    return this.managerState
  }
  get hasManager(): boolean {
    return this.managerState.kind === ManagerSessionKind.Unlocked
  }
  requireManager(): NookVaultManager {
    if (this.managerState.kind === ManagerSessionKind.Unlocked) {
      return this.managerState.manager
    }
    throw new Error('Vault manager is required')
  }
  openManager(value: NookVaultManager): void {
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
  selectPasswordEntry(value: PasswordEntryId): void {
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
  get activeEnrollmentEntry(): EnrollmentEntry {
    return this.activeEnrollmentEntryState
  }
  beginEnrollmentEntry(value: PasswordEntryId): void {
    this.activeEnrollmentEntryState = {
      kind: EnrollmentEntryKind.Active,
      entryId: value,
    }
  }
  clearActiveEnrollmentEntry(): void {
    this.activeEnrollmentEntryState = { kind: EnrollmentEntryKind.Inactive }
  }
}
