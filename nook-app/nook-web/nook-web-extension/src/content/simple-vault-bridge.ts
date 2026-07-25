import { isExtensionLocalEventLogUpdatedMessage } from '../../../nook-web-shared/src/extension/runtime-messages'

const extensionRuntimeIdAttribute = 'data-nook-extension-runtime-id'

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source !== window || event.origin !== window.location.origin) return

  if (isExtensionLocalEventLogUpdatedMessage(event.data)) {
    chrome.runtime.sendMessage(event.data, () => {
      // The bridge is best-effort when the vault is not paired. Reading
      // lastError prevents an expected unloaded/reloaded worker response from
      // becoming an unhandled console error.
      void chrome.runtime.lastError
    })
  }
})

function publishExtensionRuntimeId(): boolean {
  const root = document.documentElement
  if (!root) return false
  root.setAttribute(extensionRuntimeIdAttribute, chrome.runtime.id)
  return true
}

if (!publishExtensionRuntimeId()) {
  const observer = new MutationObserver(() => {
    if (!publishExtensionRuntimeId()) return
    observer.disconnect()
  })
  observer.observe(document, { childList: true })
}
