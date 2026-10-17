enum AuthenticatorHandOffKind {
  None = 'none',
  Requested = 'requested',
}
type AuthenticatorHandOffRequest = {
  readonly at: number
  readonly document: Document
  readonly origin: string
  readonly topFrame: boolean
}
type AuthenticatorHandOffState =
  | { readonly kind: AuthenticatorHandOffKind.None }
  | {
      readonly kind: AuthenticatorHandOffKind.Requested
      readonly request: AuthenticatorHandOffRequest
    }

/**
 * Fill 2FA code chosen on a sign-in attempt's login Pilot. That Pilot owns
 * no one-time-code field binding: the field, its Rust workflow approval and
 * the picker request belong to the authenticator Pilot the next scan mounts
 * for the 2FA step. So the choice is carried to that Pilot, which only OPENS
 * the existing authenticator picker; the code is filled only after the
 * person explicitly picks an authenticator there.
 *
 * The carry is single use, bound to this document, origin and frame, lapses
 * after five seconds, and is cleared by any other user action or navigation.
 */
class AuthenticatorHandOff {
  static readonly LIFETIME_MS = 5_000
  static readonly CLEARING_EVENTS = [
    'pointerdown',
    'keydown',
    'submit',
    'pagehide',
  ] as const
  private state: AuthenticatorHandOffState = {
    kind: AuthenticatorHandOffKind.None,
  }
  private readonly clear = (): void => {
    this.reset()
  }

  request(): void {
    this.reset()
    this.state = {
      kind: AuthenticatorHandOffKind.Requested,
      request: this.facts(),
    }
    for (const type of AuthenticatorHandOff.CLEARING_EVENTS) {
      window.addEventListener(type, this.clear, true)
    }
  }

  /** Consumes the request if it is fresh and still for this document. */
  take(): boolean {
    const state = this.state
    this.reset()
    switch (state.kind) {
      case AuthenticatorHandOffKind.None:
        return false
      case AuthenticatorHandOffKind.Requested:
        break
    }
    const now = this.facts()
    return (
      now.at - state.request.at <= AuthenticatorHandOff.LIFETIME_MS &&
      now.document === state.request.document &&
      now.origin === state.request.origin &&
      now.topFrame === state.request.topFrame
    )
  }

  private reset(): void {
    this.state = { kind: AuthenticatorHandOffKind.None }
    for (const type of AuthenticatorHandOff.CLEARING_EVENTS) {
      window.removeEventListener(type, this.clear, true)
    }
  }

  private facts(): AuthenticatorHandOffRequest {
    return {
      at: Date.now(),
      document,
      origin: location.origin,
      topFrame: window === window.top,
    }
  }
}

export const authenticatorHandOff = new AuthenticatorHandOff()
