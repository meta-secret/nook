export {}

import {
  isExtensionPairingApprovedMessage,
  isRuntimeMessage,
  tabStorageKey,
  type TabPasswordFormSummary,
} from '../../../nook-web-shared/src/extension/runtime-messages'
import { extensionPairingGrantStorageItems } from './pairing-grants'

function isNokeySender(sender: chrome.runtime.MessageSender): boolean {
  if (!sender.url) return false
  try {
    return new URL(sender.url).origin === 'https://simple.nokey.sh'
  } catch {
    return false
  }
}

function isExtensionPageSender(sender: chrome.runtime.MessageSender): boolean {
  if (!sender.url) return false
  try {
    return (
      new URL(sender.url).origin === `chrome-extension://${chrome.runtime.id}`
    )
  } catch {
    return false
  }
}

function hasPairingApprovedType(
  message: unknown,
): message is { type: 'nook:extension-pairing-approved' } {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'nook:extension-pairing-approved'
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
  if (
    hasPairingApprovedType(message) &&
    !isExtensionPairingApprovedMessage(message)
  ) {
    sendResponse({ ok: false, reason: 'invalid-pairing-grant' })
    return false
  }

  if (!isRuntimeMessage(message)) {
    return false
  }

  if (isExtensionPairingApprovedMessage(message)) {
    if (!isExtensionPageSender(sender)) {
      sendResponse({ ok: false, reason: 'forbidden-sender' })
      return false
    }

    chrome.storage.local.set(
      extensionPairingGrantStorageItems(message.payload),
      () => {
        sendResponse({ ok: true })
      },
    )
    return true
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

chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    if (!isExtensionPairingApprovedMessage(message) || !isNokeySender(sender)) {
      sendResponse({ ok: false, reason: 'invalid-pairing-grant' })
      return false
    }

    chrome.storage.local.set(
      extensionPairingGrantStorageItems(message.payload),
      () => {
        sendResponse({ ok: true })
      },
    )
    return true
  },
)
