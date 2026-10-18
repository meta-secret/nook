import { WebsitePasskeyOptionsStatus } from '../lib/webauthn-message-types'

export enum PageResponseAction {
  Fallback = 'fallback',
  Result = 'result',
  Error = 'error',
}

export enum WebsitePasskeyOptionsDispositionKind {
  Continue = 'continue',
  Respond = 'respond',
  /** Nook has nothing to offer: its card says why, and the browser runs only on request. */
  Explain = 'explain',
}

/** Why Nook cannot offer a passkey for this request. */
export enum WebsitePasskeyUnavailableReason {
  /** None of the vault's passkeys is one the site asked for. */
  NoMatch = 'no-match',
  Locked = 'locked',
  /** No connected vault keeps passkeys. */
  NoVault = 'no-vault',
  /** Nook could not ask its vaults. */
  CheckFailed = 'check-failed',
  /** Every vault already holds this account's passkey; the site listed it as excluded. */
  AlreadySaved = 'already-saved',
}

export type WebsitePasskeyOptionsDisposition =
  | { kind: WebsitePasskeyOptionsDispositionKind.Continue }
  | {
      kind: WebsitePasskeyOptionsDispositionKind.Explain
      reason: WebsitePasskeyUnavailableReason
    }
  | {
      kind: WebsitePasskeyOptionsDispositionKind.Respond
      action: PageResponseAction.Error
      reason: 'NotAllowedError'
    }

type WebsitePasskeyOptionsDispositionArgs = {
  ok: boolean
  status: WebsitePasskeyOptionsStatus
  hasOptions: boolean
}

function explain(
  reason: WebsitePasskeyUnavailableReason,
): WebsitePasskeyOptionsDisposition {
  return { kind: WebsitePasskeyOptionsDispositionKind.Explain, reason }
}

export function websitePasskeyOptionsDisposition({
  ok,
  status,
  hasOptions,
}: WebsitePasskeyOptionsDispositionArgs): WebsitePasskeyOptionsDisposition {
  if (!ok) return explain(WebsitePasskeyUnavailableReason.CheckFailed)
  switch (status) {
    case WebsitePasskeyOptionsStatus.Invalid:
      return {
        kind: WebsitePasskeyOptionsDispositionKind.Respond,
        action: PageResponseAction.Error,
        reason: 'NotAllowedError',
      }
    case WebsitePasskeyOptionsStatus.Locked:
      return explain(WebsitePasskeyUnavailableReason.Locked)
    case WebsitePasskeyOptionsStatus.Unavailable:
      return explain(WebsitePasskeyUnavailableReason.NoVault)
    case WebsitePasskeyOptionsStatus.AlreadySaved:
      return explain(WebsitePasskeyUnavailableReason.AlreadySaved)
    case WebsitePasskeyOptionsStatus.Ready:
      return hasOptions
        ? { kind: WebsitePasskeyOptionsDispositionKind.Continue }
        : explain(WebsitePasskeyUnavailableReason.NoMatch)
  }
}

/** The DOMException name a closed card hands the site. */
export enum DeclinedPasskeyError {
  InvalidState = 'InvalidStateError',
  NotAllowed = 'NotAllowedError',
}

/**
 * The error a closed card hands the site. WebAuthn answers a registration for
 * an account the authenticator already holds with InvalidStateError, so the
 * site can say the passkey exists instead of reporting a failure.
 */
export function declinedPasskeyError(
  disposition: WebsitePasskeyOptionsDisposition,
): DeclinedPasskeyError {
  return disposition.kind === WebsitePasskeyOptionsDispositionKind.Explain &&
    disposition.reason === WebsitePasskeyUnavailableReason.AlreadySaved
    ? DeclinedPasskeyError.InvalidState
    : DeclinedPasskeyError.NotAllowed
}
