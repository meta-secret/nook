export {}

import { summarizePasswordForms } from '../../../nook-web-shared/src/extension/password-forms'
import { isScanPasswordFieldsMessage } from '../../../nook-web-shared/src/extension/runtime-messages'

const SENTINEL_ORIGIN = 'https://sentinel.nokey.sh'

let pendingScan: number | undefined

function sendSummary() {
  const summary = summarizePasswordForms()

  chrome.runtime.sendMessage(
    {
      type: 'nook:password-fields-detected',
      payload: summary,
    },
    () => {
      void chrome.runtime.lastError
    },
  )
}

function scheduleScan() {
  if (pendingScan !== undefined) {
    window.clearTimeout(pendingScan)
  }

  pendingScan = window.setTimeout(() => {
    pendingScan = undefined
    sendSummary()
  }, 150)
}

if (location.origin !== SENTINEL_ORIGIN) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (isScanPasswordFieldsMessage(message)) {
      const summary = summarizePasswordForms()
      sendResponse({ ok: true, summary })
      return false
    }

    return false
  })

  sendSummary()

  const observer = new MutationObserver(scheduleScan)
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
}
