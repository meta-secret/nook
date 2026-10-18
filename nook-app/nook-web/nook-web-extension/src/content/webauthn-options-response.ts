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
    case WebsitePasskeyOptionsStatus.Ready:
      return hasOptions
        ? { kind: WebsitePasskeyOptionsDispositionKind.Continue }
        : explain(WebsitePasskeyUnavailableReason.NoMatch)
  }
}
