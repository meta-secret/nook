export {}

type PasswordFormSummary = {
  tabId: number
  url?: string
  title?: string
  passwordFieldCount: number
  usernameFieldCount: number
  formCount: number
  observedAt: number
}

type RuntimeMessage =
  | {
      type: 'nook:password-fields-detected'
      payload: Omit<PasswordFormSummary, 'tabId' | 'url' | 'title'>
    }
  | {
      type: 'nook:get-tab-summary'
      tabId: number
    }

function tabStorageKey(tabId: number) {
  return `tab:${tabId}:password-form-summary`
}

function isRuntimeMessage(message: unknown): message is RuntimeMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    typeof message.type === 'string'
  )
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install') {
    return
  }

  chrome.storage.local.set({
    installedAt: new Date().toISOString(),
  })
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isRuntimeMessage(message)) {
    return false
  }

  if (message.type === 'nook:password-fields-detected') {
    const tabId = sender.tab?.id
    if (typeof tabId !== 'number') {
      sendResponse({ ok: false, reason: 'missing-tab' })
      return false
    }

    const summary: PasswordFormSummary = {
      ...message.payload,
      tabId,
      url: sender.tab?.url,
      title: sender.tab?.title,
    }

    chrome.storage.local.set({ [tabStorageKey(tabId)]: summary }, () => {
      sendResponse({ ok: true })
    })

    return true
  }

  if (message.type === 'nook:get-tab-summary') {
    chrome.storage.local.get(tabStorageKey(message.tabId), (items) => {
      sendResponse({
        ok: true,
        summary: items[tabStorageKey(message.tabId)] ?? null,
      })
    })
    return true
  }

  return false
})
