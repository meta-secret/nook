import {
  type LoginDetectionResponse,
  type LoginDetectionStatus,
} from '../../lib/login-detection-messages'
import { runtimeSimpleVaultUrl } from '../../lib/simple-vault-runtime'

export const extensionSessionDocument = 'offscreen/session.html'

export const SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS = 4_000

type ExtensionSessionDocumentState =
  | { kind: 'closed' }
  | { kind: 'creating'; operation: Promise<void> }
  | { kind: 'open' }
  | { kind: 'closing'; operation: Promise<void> }

let extensionSessionDocumentState: ExtensionSessionDocumentState = {
  kind: 'closed',
}

export async function ensureExtensionSessionDocument(): Promise<void> {
  if (extensionSessionDocumentState.kind === 'closing') {
    await extensionSessionDocumentState.operation
  }
  if (extensionSessionDocumentState.kind === 'open') return
  if (extensionSessionDocumentState.kind === 'creating') {
    return extensionSessionDocumentState.operation
  }
  const operation = chrome.offscreen
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
      if (String(error).includes('single offscreen')) {
        return
      }
      throw error
    })
    .then(() => {
      if (
        extensionSessionDocumentState.kind === 'creating' &&
        extensionSessionDocumentState.operation === operation
      ) {
        extensionSessionDocumentState = { kind: 'open' }
      }
    })
  extensionSessionDocumentState = { kind: 'creating', operation }
  return operation
}

export function closeExtensionSessionDocument(): Promise<void> {
  if (extensionSessionDocumentState.kind === 'closing') {
    return extensionSessionDocumentState.operation
  }
  const closure = chrome.offscreen.closeDocument().finally(() => {
    if (
      extensionSessionDocumentState.kind === 'closing' &&
      extensionSessionDocumentState.operation === closure
    ) {
      extensionSessionDocumentState = { kind: 'closed' }
    }
  })
  extensionSessionDocumentState = { kind: 'closing', operation: closure }
  return closure
}

export function isExtensionSessionExpiryMessage(
  message: unknown,
): message is { type: 'nook:extension-session-expired' } {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'nook:extension-session-expired'
  )
}

export function isExtensionSessionLockMessage(
  message: unknown,
): message is { type: 'nook:extension-session-lock' } {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'nook:extension-session-lock'
  )
}

export function isExtensionSessionEnsureMessage(
  message: unknown,
): message is { type: 'nook:ensure-extension-session-runtime' } {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'nook:ensure-extension-session-runtime'
  )
}

export function isUnlockedSessionStatus(status: unknown): boolean {
  return Boolean(
    status &&
    typeof status === 'object' &&
    'status' in status &&
    status.status === 'unlocked',
  )
}

export function openSimpleVault(path = ''): void {
  chrome.tabs.create({ url: runtimeSimpleVaultUrl(path) })
}

function queryActiveTab(): Promise<chrome.tabs.Tab | void> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0])
    })
  })
}

export async function queryActiveTabLoginDetection(): Promise<LoginDetectionResponse> {
  const tab = await queryActiveTab()
  const tabId = tab?.id
  if (typeof tabId === 'undefined') {
    return { ok: true, status: 'unavailable' }
  }
  try {
    const response = await new Promise<{
      ok?: boolean
      status?: LoginDetectionStatus
    } | void>((resolve) => {
      chrome.tabs.sendMessage(
        tabId,
        { type: 'nook:query-login-detection' },
        (result: unknown) => {
          if (chrome.runtime.lastError) {
            resolve()
            return
          }
          if (!result || typeof result !== 'object') {
            resolve()
            return
          }
          const payload = result as {
            ok?: unknown
            status?: unknown
          }
          if (
            payload.ok !== true ||
            (payload.status !== 'detected' &&
              payload.status !== 'not-detected' &&
              payload.status !== 'unavailable')
          ) {
            resolve()
            return
          }
          resolve({ ok: true, status: payload.status })
        },
      )
    })
    if (response?.ok === true && response.status) {
      return { ok: true, status: response.status }
    }
  } catch {
    // Content script may be absent on restricted pages.
  }
  return { ok: true, status: 'unavailable' }
}

export async function openCompanionLauncher(intent?: 'pair'): Promise<void> {
  const popupUrl = chrome.runtime.getURL('popup/index.html')
  const launcherUrl = intent ? `${popupUrl}?intent=${intent}` : popupUrl
  if (chrome.windows?.create) {
    await chrome.windows.create({
      url: launcherUrl,
      type: 'popup',
      width: 440,
      height: 620,
      focused: true,
    })
    return
  }
  await chrome.tabs.create({ url: launcherUrl })
}
