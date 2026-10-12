import {
  AuthenticatedWorkspaceObservation,
  AuthenticatedWorkspaceState,
} from './authenticated-workspace'

export type DeviceProtectionAuthorizationObservation = {
  readonly overlayVisible: boolean
  readonly unlockReady: boolean
  readonly pickerVisible: boolean
  readonly lockedAccessVisible: boolean
  readonly authorizeReady: boolean
  readonly vaultAuthenticated: boolean
  readonly workspaceUnlocked: boolean
}

export enum DeviceProtectionAuthorizationGateState {
  Overlay = 'overlay',
  Unlock = 'unlock',
  Picker = 'picker',
  LockedAccess = 'locked-access',
  Authorize = 'authorize',
  Unlocked = 'unlocked',
  Waiting = 'waiting',
  Error = 'error',
}

export type DeviceProtectionPostUnlockObservation = {
  readonly loginGateVisible: boolean
  readonly authenticatedShellVisible: boolean
  readonly vaultAuthenticated: boolean
  readonly overlayVisible: boolean
  readonly authorizeReady: boolean
  readonly unlockReady: boolean
  readonly pickerVisible: boolean
  readonly errorVisible: boolean
}

export function deviceProtectionAuthenticatedSurface(
  workspaceUnlocked: boolean,
  vaultAuthenticated: boolean,
  consentVisible: boolean,
): boolean {
  return workspaceUnlocked || (vaultAuthenticated && consentVisible)
}

export class DeviceProtectionPostUnlockGate {
  constructor(
    private readonly observation: DeviceProtectionPostUnlockObservation,
  ) {}

  state(): DeviceProtectionAuthorizationGateState {
    if (this.observation.vaultAuthenticated) {
      return DeviceProtectionAuthorizationGateState.Unlocked
    }
    if (
      new AuthenticatedWorkspaceObservation({
        authenticatedShellVisible: this.observation.authenticatedShellVisible,
        loginGateVisible: this.observation.loginGateVisible,
      }).state() === AuthenticatedWorkspaceState.Unlocked
    ) {
      return DeviceProtectionAuthorizationGateState.Unlocked
    }
    if (this.observation.errorVisible) {
      return DeviceProtectionAuthorizationGateState.Error
    }
    if (this.observation.authorizeReady) {
      return DeviceProtectionAuthorizationGateState.Authorize
    }
    return DeviceProtectionAuthorizationGateState.Waiting
  }
}

export function deviceProtectionAuthorizationGateState({
  overlayVisible,
  unlockReady,
  pickerVisible,
  lockedAccessVisible,
  authorizeReady,
  vaultAuthenticated,
  workspaceUnlocked,
}: DeviceProtectionAuthorizationObservation): DeviceProtectionAuthorizationGateState {
  if (vaultAuthenticated || workspaceUnlocked) {
    return DeviceProtectionAuthorizationGateState.Unlocked
  }
  if (overlayVisible) return DeviceProtectionAuthorizationGateState.Overlay
  if (unlockReady) return DeviceProtectionAuthorizationGateState.Unlock
  if (pickerVisible) return DeviceProtectionAuthorizationGateState.Picker
  if (lockedAccessVisible) {
    return DeviceProtectionAuthorizationGateState.LockedAccess
  }
  if (authorizeReady) return DeviceProtectionAuthorizationGateState.Authorize
  return DeviceProtectionAuthorizationGateState.Waiting
}

/** Observe a disposable login control in one browser turn. */
export function deviceProtectionButtonReady(testId: string): boolean {
  const button = document.querySelector(`[data-testid="${testId}"]`)
  if (!(button instanceof HTMLButtonElement)) return false
  const style = window.getComputedStyle(button)
  return (
    button.getClientRects().length > 0 &&
    style.visibility !== 'hidden' &&
    style.visibility !== 'collapse' &&
    !button.disabled
  )
}
