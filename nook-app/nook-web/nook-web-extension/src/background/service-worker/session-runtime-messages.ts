import { ExtensionRuntimeRequestType } from '../../lib/extension-runtime-request-type'
import { ExtensionSessionLifecycleMessageType } from '../../lib/extension-session-lifecycle-message-type'
import { ExtensionSessionMessageType } from '../../lib/extension-session-message-type'

type ExtensionSessionRuntimeMessage = {
  type:
    | ExtensionRuntimeRequestType.EnsureRuntime
    | ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces
    | ExtensionSessionLifecycleMessageType.Expired
    | ExtensionSessionMessageType.Lock
}

export function isExtensionAuthenticationSurfacesRefreshMessage(
  message: ChromeRuntimeMessage,
): message is ExtensionSessionRuntimeMessage {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces
  )
}

type ChromeMessageListener = Parameters<
  typeof chrome.runtime.onMessage.addListener
>[0]
type ChromeRuntimeMessage = Parameters<ChromeMessageListener>[0]

export function isExtensionSessionEnsureMessage(
  message: ChromeRuntimeMessage,
): message is ExtensionSessionRuntimeMessage {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === ExtensionRuntimeRequestType.EnsureRuntime
  )
}

export function isExtensionSessionExpiryMessage(
  message: ChromeRuntimeMessage,
): message is ExtensionSessionRuntimeMessage {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === ExtensionSessionLifecycleMessageType.Expired
  )
}

export function isExtensionSessionLockMessage(
  message: ChromeRuntimeMessage,
): message is ExtensionSessionRuntimeMessage {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === ExtensionSessionMessageType.Lock
  )
}
