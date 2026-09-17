import { ExtensionRuntimeRequestType } from '../../lib/extension-runtime-request-type'
import { ExtensionSessionLifecycleMessageType } from '../../lib/extension-session-lifecycle-message-type'
import { ExtensionSessionMessageType } from '../../lib/extension-session-message-type'
import type { BrowserRuntimeMessage } from '../../lib/browser-runtime-message'

type ExtensionSessionRuntimeMessage = {
  type:
    | ExtensionRuntimeRequestType.EnsureRuntime
    | ExtensionSessionLifecycleMessageType.Expired
    | ExtensionSessionMessageType.Lock
}

type AuthenticationSurfacesRefreshMessage = {
  type: ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces
}

export type ExtensionSessionRuntimeMessageValue = BrowserRuntimeMessage

export function isExtensionSessionEnsureMessage(
  message: ExtensionSessionRuntimeMessageValue,
): message is ExtensionSessionRuntimeMessage {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === ExtensionRuntimeRequestType.EnsureRuntime
  )
}

export function isExtensionAuthenticationSurfacesRefreshMessage(
  message: ExtensionSessionRuntimeMessageValue,
): message is AuthenticationSurfacesRefreshMessage {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces
  )
}

export function isExtensionSessionExpiryMessage(
  message: ExtensionSessionRuntimeMessageValue,
): message is ExtensionSessionRuntimeMessage {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === ExtensionSessionLifecycleMessageType.Expired
  )
}

export function isExtensionSessionLockMessage(
  message: ExtensionSessionRuntimeMessageValue,
): message is ExtensionSessionRuntimeMessage {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === ExtensionSessionMessageType.Lock
  )
}
