export {}

import {
  isBeginExtensionPairingMessage,
  isExtensionIdentityHandoffRequestMessage,
  isExtensionLocalEventLogUpdatedMessage,
  isExtensionPairingApprovedMessage,
  isOpenSimpleVaultMessage,
} from '../../../nook-web-shared/src/extension/runtime-messages'
import type {
  BeginExtensionPairingMessage,
  ExtensionIdentityHandoffRequestMessage,
  ExtensionPairingApprovedMessage,
} from '../../../nook-web-shared/src/extension/runtime-messages'
import {
  extensionPairingGrantStorageItems,
  extensionStoredPairingGrantStorageItems,
  isStoredExtensionPairingGrant,
  pairingGrantStorageKey,
  setupStorageKey,
} from './pairing-grants'
import { importExtensionEventLog } from './vault-runtime'
import {
  isRuntimeSimpleVaultUrl,
  runtimeSimpleVaultUrl,
} from '../lib/simple-vault-runtime'

const extensionSessionDocument = 'offscreen/session.html'
let extensionSessionDocumentCreation: Promise<void> | undefined

async function ensureExtensionSessionDocument(): Promise<void> {
  extensionSessionDocumentCreation ??= chrome.offscreen
    .createDocument({
      url: extensionSessionDocument,
      reasons: ['WORKERS'],
      justification:
        'Keep a user-authorized extension device identity in memory for a 15-minute session.',
    })
    .catch((error: unknown) => {
      // Manifest V3 permits only one offscreen document. A restarted service
      // worker may race with the existing session document; it is safe to use
      // that already-open document.
      if (
        error instanceof Error &&
        error.message.includes('single offscreen')
      ) {
        return
      }
      throw error
    })
  return extensionSessionDocumentCreation
}

function isExtensionSessionExpiryMessage(
  message: unknown,
): message is { type: 'nook:extension-session-expired' } {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'nook:extension-session-expired'
  )
}

function isExtensionSessionEnsureMessage(
  message: unknown,
): message is { type: 'nook:ensure-extension-session-runtime' } {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'nook:ensure-extension-session-runtime'
  )
}

function openSimpleVault(path = ''): void {
  chrome.tabs.create({ url: runtimeSimpleVaultUrl(path) })
}

function randomNonce(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}

function openExtensionPairing(
  device: BeginExtensionPairingMessage['payload'],
): void {
  const url = new URL(runtimeSimpleVaultUrl('extension-connect'))
  url.searchParams.set('device_id', device.deviceId)
  url.searchParams.set('device_public_key', device.devicePublicKey)
  url.searchParams.set(
    'device_signing_public_key',
    device.deviceSigningPublicKey,
  )
  url.searchParams.set('extension_id', chrome.runtime.id)
  url.searchParams.set('device_label', device.deviceLabel)
  url.searchParams.set('nonce', randomNonce())
  url.searchParams.set('scopes', 'vault-access,password-filling')
  chrome.tabs.create({ url: url.toString() })
}

function isNokeySender(sender: chrome.runtime.MessageSender): boolean {
  if (!sender.url) return false
  try {
    return isRuntimeSimpleVaultUrl(sender.url)
  } catch {
    return false
  }
}

function sendSessionMessage(message: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError?.message
      if (error) reject(new Error(error))
      else resolve(response)
    })
  })
}

async function createIdentityHandoff(
  message: ExtensionIdentityHandoffRequestMessage,
): Promise<{ ok: boolean; envelope?: string; reason?: string }> {
  try {
    await ensureExtensionSessionDocument()
    const response = await sendSessionMessage({
      type: 'nook:extension-session-seal-identity-handoff',
      payload: message.payload,
    })
    if (
      typeof response === 'object' &&
      response !== null &&
      'ok' in response &&
      response.ok === true &&
      'envelope' in response &&
      typeof response.envelope === 'string'
    ) {
      return { ok: true, envelope: response.envelope }
    }
    return { ok: false, reason: 'extension-identity-unavailable' }
  } catch {
    return { ok: false, reason: 'extension-identity-handoff-failed' }
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

function setLocalStorage(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      const message = chrome.runtime.lastError?.message
      if (message) reject(new Error(message))
      else resolve()
    })
  })
}

function getLocalStorage(key: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (items) => {
      const message = chrome.runtime.lastError?.message
      if (message) reject(new Error(message))
      else resolve(items)
    })
  })
}

function removeLocalStorage(keys: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      const message = chrome.runtime.lastError?.message
      if (message) reject(new Error(message))
      else resolve()
    })
  })
}

async function importApprovedPairing(
  message: ExtensionPairingApprovedMessage,
): Promise<{ ok: boolean; reason?: string; eventCount?: number }> {
  try {
    const imported = await importExtensionEventLog(
      message.payload,
      message.eventLogRecords,
    )
    if (!imported.accessGranted) {
      return { ok: false, reason: 'event-log-access-not-granted' }
    }
    await setLocalStorage(
      extensionPairingGrantStorageItems(message.payload, imported),
    )
    return { ok: true, eventCount: imported.eventCount }
  } catch {
    return { ok: false, reason: 'event-log-import-failed' }
  }
}

async function importLocalEventLogUpdate(
  vaultStoreId: string,
  eventLogRecords: Parameters<typeof importExtensionEventLog>[1],
): Promise<{ ok: boolean; reason?: string; eventCount?: number }> {
  const key = pairingGrantStorageKey(vaultStoreId)
  try {
    const stored = await getLocalStorage(key)
    const grant = stored[key]
    if (!isStoredExtensionPairingGrant(grant)) {
      return { ok: false, reason: 'vault-not-paired' }
    }
    const imported = await importExtensionEventLog(grant, eventLogRecords)
    if (!imported.accessGranted) {
      await removeLocalStorage([key, setupStorageKey])
      return { ok: false, reason: 'event-log-access-revoked' }
    }
    await setLocalStorage(
      extensionStoredPairingGrantStorageItems(grant, imported),
    )
    return { ok: true, eventCount: imported.eventCount }
  } catch {
    return { ok: false, reason: 'event-log-import-failed' }
  }
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
  if (isExtensionSessionEnsureMessage(message)) {
    if (sender.id !== chrome.runtime.id) {
      sendResponse({ ok: false, reason: 'forbidden-sender' })
      return false
    }
    void ensureExtensionSessionDocument()
      .then(() => sendResponse({ ok: true }))
      .catch(() =>
        sendResponse({ ok: false, reason: 'session-runtime-failed' }),
      )
    return true
  }

  if (isExtensionSessionExpiryMessage(message)) {
    if (
      sender.id !== chrome.runtime.id ||
      !sender.url?.endsWith(`/${extensionSessionDocument}`)
    ) {
      sendResponse({ ok: false, reason: 'forbidden-sender' })
      return false
    }
    extensionSessionDocumentCreation = undefined
    void chrome.offscreen.closeDocument().then(() => sendResponse({ ok: true }))
    return true
  }

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

    void importApprovedPairing(message).then(sendResponse)
    return true
  }

  if (isExtensionLocalEventLogUpdatedMessage(message)) {
    if (sender.id !== chrome.runtime.id || !isNokeySender(sender)) {
      sendResponse({ ok: false, reason: 'forbidden-sender' })
      return false
    }
    void importLocalEventLogUpdate(
      message.payload.vaultStoreId,
      message.payload.eventLogRecords,
    ).then(sendResponse)
    return true
  }

  if (isOpenSimpleVaultMessage(message)) {
    if (sender.id !== chrome.runtime.id) {
      sendResponse({ ok: false, reason: 'forbidden-sender' })
      return false
    }
    openSimpleVault()
    sendResponse({ ok: true })
    return false
  }

  if (isBeginExtensionPairingMessage(message)) {
    if (sender.id !== chrome.runtime.id) {
      sendResponse({ ok: false, reason: 'forbidden-sender' })
      return false
    }
    openExtensionPairing(message.payload)
    sendResponse({ ok: true })
    return false
  }

  return false
})

chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    if (isExtensionIdentityHandoffRequestMessage(message)) {
      if (!isNokeySender(sender)) {
        sendResponse({ ok: false, reason: 'forbidden-sender' })
        return false
      }
      void createIdentityHandoff(message).then(sendResponse)
      return true
    }

    if (!isExtensionPairingApprovedMessage(message) || !isNokeySender(sender)) {
      sendResponse({ ok: false, reason: 'invalid-pairing-grant' })
      return false
    }

    void importApprovedPairing(message).then(sendResponse)
    return true
  },
)
