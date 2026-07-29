import {
  LoginDetectionStatus,
  type LoginDetectionResponse,
} from '../../lib/login-detection-messages'
import { runtimeSimpleVaultUrl } from '../../lib/simple-vault-runtime'

export const extensionSessionDocument = 'offscreen/session.html'

export const SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS = 4_000

enum ExtensionSessionDocumentStateKind {
  Closed = 'closed',
  Creating = 'creating',
  Open = 'open',
  Closing = 'closing',
}

type ExtensionSessionDocumentState =
  | { kind: ExtensionSessionDocumentStateKind.Closed }
  | {
      kind: ExtensionSessionDocumentStateKind.Creating
      operation: Promise<void>
    }
  | { kind: ExtensionSessionDocumentStateKind.Open }
  | {
      kind: ExtensionSessionDocumentStateKind.Closing
      operation: Promise<void>
    }

let extensionSessionDocumentState: ExtensionSessionDocumentState = {
  kind: ExtensionSessionDocumentStateKind.Closed,
}

export async function ensureExtensionSessionDocument(): Promise<void> {
  if (
    extensionSessionDocumentState.kind ===
    ExtensionSessionDocumentStateKind.Closing
  ) {
    await extensionSessionDocumentState.operation
  }
  if (
    extensionSessionDocumentState.kind ===
    ExtensionSessionDocumentStateKind.Open
  )
    return
  if (
    extensionSessionDocumentState.kind ===
    ExtensionSessionDocumentStateKind.Creating
  ) {
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
        extensionSessionDocumentState.kind ===
          ExtensionSessionDocumentStateKind.Creating &&
        extensionSessionDocumentState.operation === operation
      ) {
        extensionSessionDocumentState = {
          kind: ExtensionSessionDocumentStateKind.Open,
        }
      }
    })
  extensionSessionDocumentState = {
    kind: ExtensionSessionDocumentStateKind.Creating,
    operation,
  }
  return operation
}

export function closeExtensionSessionDocument(): Promise<void> {
  if (
    extensionSessionDocumentState.kind ===
    ExtensionSessionDocumentStateKind.Closing
  ) {
    return extensionSessionDocumentState.operation
  }
  const closure = chrome.offscreen.closeDocument().finally(() => {
    if (
      extensionSessionDocumentState.kind ===
        ExtensionSessionDocumentStateKind.Closing &&
      extensionSessionDocumentState.operation === closure
    ) {
      extensionSessionDocumentState = {
        kind: ExtensionSessionDocumentStateKind.Closed,
      }
    }
  })
  extensionSessionDocumentState = {
    kind: ExtensionSessionDocumentStateKind.Closing,
    operation: closure,
  }
  return closure
}

export enum IsExtensionSessionExpiryMessageResultType {
  NookExtensionSessionExpired = 'nook:extension-session-expired',
}

export function isExtensionSessionExpiryMessage(message: unknown): message is {
  type: IsExtensionSessionExpiryMessageResultType.NookExtensionSessionExpired
} {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type ===
      IsExtensionSessionExpiryMessageResultType.NookExtensionSessionExpired
  )
}

export enum IsExtensionSessionLockMessageResultType {
  NookExtensionSessionLock = 'nook:extension-session-lock',
}

export function isExtensionSessionLockMessage(message: unknown): message is {
  type: IsExtensionSessionLockMessageResultType.NookExtensionSessionLock
} {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type ===
      IsExtensionSessionLockMessageResultType.NookExtensionSessionLock
  )
}

export enum IsExtensionSessionEnsureMessageResultType {
  NookEnsureExtensionSessionRuntime = 'nook:ensure-extension-session-runtime',
}

export function isExtensionSessionEnsureMessage(message: unknown): message is {
  type: IsExtensionSessionEnsureMessageResultType.NookEnsureExtensionSessionRuntime
} {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type ===
      IsExtensionSessionEnsureMessageResultType.NookEnsureExtensionSessionRuntime
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

enum ActiveTabQueryKind {
  Found = 'found',
  Unavailable = 'unavailable',
}

type ActiveTabQuery =
  | { kind: ActiveTabQueryKind.Found; tab: chrome.tabs.Tab }
  | { kind: ActiveTabQueryKind.Unavailable }

function queryActiveTab(): Promise<ActiveTabQuery> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      resolve(
        tab
          ? { kind: ActiveTabQueryKind.Found, tab }
          : { kind: ActiveTabQueryKind.Unavailable },
      )
    })
  })
}

export async function queryActiveTabLoginDetection(): Promise<LoginDetectionResponse> {
  const activeTab = await queryActiveTab()
  if (activeTab.kind === ActiveTabQueryKind.Unavailable) {
    return { ok: true, status: LoginDetectionStatus.Unavailable }
  }
  const tabId = activeTab.tab.id
  if (typeof tabId !== 'number' || !Number.isInteger(tabId)) {
    return { ok: true, status: LoginDetectionStatus.Unavailable }
  }
  try {
    const response = await new Promise<LoginDetectionResponse>((resolve) => {
      chrome.tabs.sendMessage(
        tabId,
        { type: 'nook:query-login-detection' },
        (result: unknown) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: true, status: LoginDetectionStatus.Unavailable })
            return
          }
          if (!result || typeof result !== 'object') {
            resolve({ ok: true, status: LoginDetectionStatus.Unavailable })
            return
          }
          const payload = result as {
            ok?: unknown
            status?: unknown
          }
          if (
            payload.ok !== true ||
            (payload.status !== LoginDetectionStatus.Detected &&
              payload.status !== LoginDetectionStatus.NotDetected &&
              payload.status !== LoginDetectionStatus.Unavailable)
          ) {
            resolve({ ok: true, status: LoginDetectionStatus.Unavailable })
            return
          }
          resolve({
            ok: true,
            status: payload.status as LoginDetectionStatus,
          })
        },
      )
    })
    return response
  } catch {
    // Content script may be absent on restricted pages.
  }
  return { ok: true, status: LoginDetectionStatus.Unavailable }
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
