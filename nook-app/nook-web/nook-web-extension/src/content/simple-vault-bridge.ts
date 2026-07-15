import { isExtensionLocalEventLogUpdatedMessage } from '../../../nook-web-shared/src/extension/runtime-messages'

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
