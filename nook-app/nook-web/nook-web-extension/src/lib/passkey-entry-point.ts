import { AuthenticationWorkflowAction } from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export enum PasskeyEntryPointKind {
  SiteControl = 'site-control',
  ScopedAuthenticationAdvance = 'scoped-authentication-advance',
  Unavailable = 'unavailable',
}

type PasskeyEntryPointKindArgs = {
  action: AuthenticationWorkflowAction
  siteControlPresent: boolean
}

export function passkeyEntryPointKind({
  action,
  siteControlPresent,
}: PasskeyEntryPointKindArgs): PasskeyEntryPointKind {
  if (siteControlPresent) return PasskeyEntryPointKind.SiteControl
  return action === AuthenticationWorkflowAction.UsePasskey
    ? PasskeyEntryPointKind.ScopedAuthenticationAdvance
    : PasskeyEntryPointKind.Unavailable
}
