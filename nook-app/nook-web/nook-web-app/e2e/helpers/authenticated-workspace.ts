export enum AuthenticatedWorkspaceState {
  Locked = 'locked',
  Unlocked = 'unlocked',
}

export interface AuthenticatedWorkspaceVisibility {
  readonly authenticatedShellVisible: boolean
  readonly loginGateVisible: boolean
}

/** Owns the test driver's projection of authenticated workspace visibility. */
export class AuthenticatedWorkspaceObservation {
  constructor(private readonly visibility: AuthenticatedWorkspaceVisibility) {}

  state(): AuthenticatedWorkspaceState {
    return this.visibility.authenticatedShellVisible &&
      !this.visibility.loginGateVisible
      ? AuthenticatedWorkspaceState.Unlocked
      : AuthenticatedWorkspaceState.Locked
  }
}
