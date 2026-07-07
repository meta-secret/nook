export {}

import {
  isRuntimeMessage,
  tabStorageKey,
  type TabPasswordFormSummary,
} from '../../../nook-web-shared/src/extension/runtime-messages'

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

    const summary: TabPasswordFormSummary = {
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
