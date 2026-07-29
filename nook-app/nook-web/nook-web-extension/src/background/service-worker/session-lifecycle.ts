import {
  type LoginDetectionResponse,
  type LoginDetectionStatus,
} from '../../lib/login-detection-messages'
import { runtimeSimpleVaultUrl } from '../../lib/simple-vault-runtime'

export const extensionSessionDocument = 'offscreen/session.html'

export const SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS = 4_000

let extensionSessionDocumentCreation: Promise<void> | undefined

let extensionSessionDocumentClosure: Promise<void> | undefined

export async function ensureExtensionSessionDocument(): Promise<void> {
  await extensionSessionDocumentClosure
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
      if (String(error).includes('single offscreen')) {
        return
      }
      throw error
    })
  return extensionSessionDocumentCreation
}

export function closeExtensionSessionDocument(): Promise<void> {
  extensionSessionDocumentCreation = undefined
  if (extensionSessionDocumentClosure) return extensionSessionDocumentClosure
  const closure = chrome.offscreen.closeDocument().finally(() => {
    if (extensionSessionDocumentClosure === closure) {
      extensionSessionDocumentClosure = undefined
    }
  })
  extensionSessionDocumentClosure = closure
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

function queryActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0])
    })
  })
}

export async function queryActiveTabLoginDetection(): Promise<LoginDetectionResponse> {
  const tab = await queryActiveTab()
  const tabId = tab?.id
  if (tabId === undefined) {
    return { ok: true, status: 'unavailable' }
  }
  try {
    const response = await new Promise<
      { ok?: boolean; status?: LoginDetectionStatus } | undefined
    >((resolve) => {
      chrome.tabs.sendMessage(
        tabId,
        { type: 'nook:query-login-detection' },
        (result: unknown) => {
          if (chrome.runtime.lastError) {
            resolve(undefined)
            return
          }
          if (!result || typeof result !== 'object') {
            resolve(undefined)
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
            resolve(undefined)
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
