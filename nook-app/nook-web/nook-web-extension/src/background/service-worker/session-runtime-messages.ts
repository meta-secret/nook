export enum ExtensionSessionRuntimeMessageType {
  Ensure = 'nook:ensure-extension-session-runtime',
  Expired = 'nook:extension-session-expired',
  Lock = 'nook:extension-session-lock',
}

type ExtensionSessionRuntimeMessage = {
  type: ExtensionSessionRuntimeMessageType
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
    message.type === ExtensionSessionRuntimeMessageType.Ensure
  )
}

export function isExtensionSessionExpiryMessage(
  message: ChromeRuntimeMessage,
): message is ExtensionSessionRuntimeMessage {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === ExtensionSessionRuntimeMessageType.Expired
  )
}

export function isExtensionSessionLockMessage(
  message: ChromeRuntimeMessage,
): message is ExtensionSessionRuntimeMessage {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === ExtensionSessionRuntimeMessageType.Lock
  )
}
