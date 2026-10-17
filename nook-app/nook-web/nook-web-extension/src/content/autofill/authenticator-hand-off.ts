enum AuthenticatorHandOffKind {
  None = 'none',
  Requested = 'requested',
}
type AuthenticatorHandOffState =
  | { readonly kind: AuthenticatorHandOffKind.None }
  | { readonly kind: AuthenticatorHandOffKind.Requested; readonly at: number }

/**
 * The person chose Fill 2FA code on the login Pilot of a sign-in attempt.
 * The login Pilot has no one-time-code controls, so the choice is carried to
 * the authenticator Pilot the next scan mounts on this document, which then
 * runs its own Fill 2FA code path once. The request lapses quickly so it can
 * never act on a later, unrelated 2FA step.
 */
class AuthenticatorHandOff {
  static readonly LIFETIME_MS = 5_000
  private state: AuthenticatorHandOffState = {
    kind: AuthenticatorHandOffKind.None,
  }

  request(): void {
    this.state = { kind: AuthenticatorHandOffKind.Requested, at: Date.now() }
  }

  /** Consumes a fresh request; a lapsed or absent one is not acted on. */
  take(): boolean {
    const state = this.state
    this.state = { kind: AuthenticatorHandOffKind.None }
    switch (state.kind) {
      case AuthenticatorHandOffKind.None:
        return false
      case AuthenticatorHandOffKind.Requested:
        return Date.now() - state.at <= AuthenticatorHandOff.LIFETIME_MS
    }
  }
}

export const authenticatorHandOff = new AuthenticatorHandOff()
