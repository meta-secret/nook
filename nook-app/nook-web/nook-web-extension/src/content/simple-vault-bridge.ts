import {
  isExtensionDeviceIdentityHandoffMessage,
  isExtensionDeviceIdentityHandoffResultMessage,
  isExtensionLocalEventLogUpdatedMessage,
} from '../../../nook-web-shared/src/extension/runtime-messages'

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (
    event.source !== window ||
    event.origin !== window.location.origin ||
    !isExtensionLocalEventLogUpdatedMessage(event.data)
  ) {
    return
  }

  chrome.runtime.sendMessage(event.data, () => {
    // The bridge is best-effort when the vault is not paired. Reading
    // lastError prevents an expected unloaded/reloaded worker response from
    // becoming an unhandled console error.
    void chrome.runtime.lastError
  })
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isExtensionDeviceIdentityHandoffMessage(message)) return false

  // This script is injected only into the configured Simple Vault origin.
  // Keep the raw identity in the renderer's memory only; do not put it in a
  // URL, page storage, or an extension storage area.
  const handleResult = (event: MessageEvent<unknown>) => {
    if (
      event.source !== window ||
      event.origin !== window.location.origin ||
      !isExtensionDeviceIdentityHandoffResultMessage(event.data) ||
      event.data.requestId !== message.requestId
    ) {
      return
    }
    window.removeEventListener('message', handleResult)
    clearTimeout(timeout)
    sendResponse({ ok: event.data.ok })
  }
  window.addEventListener('message', handleResult)
  const timeout = window.setTimeout(() => {
    window.removeEventListener('message', handleResult)
    sendResponse({ ok: false })
  }, 15_000)
  window.postMessage(message, window.location.origin)
  return true
})
