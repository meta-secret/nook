export {}

import {
  isExtensionPairingApprovedMessage,
  isOpenSimpleVaultMessage,
  isStartExtensionPairingMessage,
} from '../../../nook-web-shared/src/extension/runtime-messages'
import {
  extensionPairingGrantStorageItems,
  setupStorageKey,
} from './pairing-grants'

const SIMPLE_VAULT_URL = 'https://simple.nokey.sh/'

function openSimpleVault(path = ''): void {
  chrome.tabs.create({ url: new URL(path, SIMPLE_VAULT_URL).toString() })
}

function openExtensionPairing(): void {
  const url = new URL('/extension-connect', SIMPLE_VAULT_URL)
  url.searchParams.set('extension_id', chrome.runtime.id)
  openSimpleVault(`${url.pathname}${url.search}`)
}

function openDeviceProtectionWindow(
  sendResponse: (response: unknown) => void,
): void {
  chrome.windows.create(
    {
      url: chrome.runtime.getURL('connect/index.html'),
      type: 'popup',
      width: 460,
      height: 560,
      focused: true,
    },
    () => {
      const message = chrome.runtime.lastError?.message
      sendResponse(message ? { ok: false, reason: message } : { ok: true })
    },
  )
}

function isNokeySender(sender: chrome.runtime.MessageSender): boolean {
  if (!sender.url) return false
  try {
    return new URL(sender.url).origin === 'https://simple.nokey.sh'
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

chrome.action.onClicked.addListener(() => {
  chrome.storage.local.get(setupStorageKey, (items) => {
    const setup = items[setupStorageKey]
    const paired =
      !!setup &&
      typeof setup === 'object' &&
      'status' in setup &&
      (setup.status === 'ready' || setup.status === 'locked')

    if (paired) {
      openSimpleVault()
      return
    }
    openExtensionPairing()
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

  if (isExtensionPairingApprovedMessage(message)) {
    if (sender.id !== chrome.runtime.id) {
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

  if (isOpenSimpleVaultMessage(message) && typeof sender.tab?.id === 'number') {
    openSimpleVault()
    sendResponse({ ok: true })
    return false
  }

  return false
})

chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    if (isStartExtensionPairingMessage(message) && isNokeySender(sender)) {
      openDeviceProtectionWindow(sendResponse)
      return true
    }

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
