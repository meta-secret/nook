import { WebsitePasskeyOptionsStatus } from '../lib/webauthn-messages'

export enum PageResponseAction {
  Fallback = 'fallback',
  Result = 'result',
  Error = 'error',
}

export enum WebsitePasskeyOptionsDispositionKind {
  Continue = 'continue',
  Respond = 'respond',
}

export type WebsitePasskeyOptionsDisposition =
  | { kind: WebsitePasskeyOptionsDispositionKind.Continue }
  | {
      kind: WebsitePasskeyOptionsDispositionKind.Respond
      action: PageResponseAction.Fallback
    }
  | {
      kind: WebsitePasskeyOptionsDispositionKind.Respond
      action: PageResponseAction.Error
      reason: 'NotAllowedError'
    }

type WebsitePasskeyOptionsDispositionArgs = {
  ok: boolean
  status?: WebsitePasskeyOptionsStatus
  hasOptions: boolean
}

export function websitePasskeyOptionsDisposition({
  ok,
  status,
  hasOptions,
}: WebsitePasskeyOptionsDispositionArgs): WebsitePasskeyOptionsDisposition {
  if (status === WebsitePasskeyOptionsStatus.Invalid) {
    return {
      kind: WebsitePasskeyOptionsDispositionKind.Respond,
      action: PageResponseAction.Error,
      reason: 'NotAllowedError',
    }
  }
  if (!ok || status !== WebsitePasskeyOptionsStatus.Ready || !hasOptions) {
    return {
      kind: WebsitePasskeyOptionsDispositionKind.Respond,
      action: PageResponseAction.Fallback,
    }
  }
  return { kind: WebsitePasskeyOptionsDispositionKind.Continue }
}
