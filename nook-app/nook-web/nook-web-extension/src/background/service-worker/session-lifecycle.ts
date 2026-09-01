import {
  LoginDetectionStatus,
  type LoginDetectionResponse,
} from '../../lib/login-detection-messages'
import { runtimeSimpleVaultUrl } from '../../lib/simple-vault-runtime'
import { DeviceProtectionStatus } from '../../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { OpenCompanionLauncherIntent } from '../../../../nook-web-shared/src/extension/companion-launcher-message'

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
  const nookTypedArgs0_0: Parameters<
    typeof chrome.offscreen.createDocument
  >[0] = {
    url: extensionSessionDocument,
    reasons: ['WORKERS'],
    justification:
      'Keep a user-authorized extension device identity in memory for a 15-minute session.',
  }
  const operation = chrome.offscreen
    .createDocument(nookTypedArgs0_0)
    .catch((error) => {
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

export function isUnlockedSessionStatus(status: unknown): boolean {
  return Boolean(
    status &&
    typeof status === 'object' &&
    'status' in status &&
    status.status === DeviceProtectionStatus.Unlocked,
  )
}

export function openSimpleVault(path = ''): void {
  const nookTypedArgs0_1: Parameters<typeof chrome.tabs.create>[0] = {
    url: runtimeSimpleVaultUrl(path),
  }
  void chrome.tabs.create(nookTypedArgs0_1)
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
    const nookTypedArgs0_2: Parameters<typeof chrome.tabs.query>[0] = {
      active: true,
      currentWindow: true,
    }
    chrome.tabs.query(nookTypedArgs0_2, (tabs) => {
      const tab = tabs[0]
      const result: ActiveTabQuery = tab
        ? { kind: ActiveTabQueryKind.Found, tab }
        : { kind: ActiveTabQueryKind.Unavailable }
      resolve(result)
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
      const nookTypedArgs1_0: Parameters<typeof chrome.tabs.sendMessage>[1] = {
        type: 'nook:query-login-detection',
      }
      chrome.tabs.sendMessage(tabId, nookTypedArgs1_0, (result: unknown) => {
        if (chrome.runtime.lastError) {
          const nookTypedArgs0_3: Parameters<typeof resolve>[0] = {
            ok: true,
            status: LoginDetectionStatus.Unavailable,
          }
          resolve(nookTypedArgs0_3)
          return
        }
        if (!result || typeof result !== 'object') {
          const nookTypedArgs0_4: Parameters<typeof resolve>[0] = {
            ok: true,
            status: LoginDetectionStatus.Unavailable,
          }
          resolve(nookTypedArgs0_4)
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
          const nookTypedArgs0_5: Parameters<typeof resolve>[0] = {
            ok: true,
            status: LoginDetectionStatus.Unavailable,
          }
          resolve(nookTypedArgs0_5)
          return
        }
        const nookTypedArgs0_6: Parameters<typeof resolve>[0] = {
          ok: true,
          status: payload.status as LoginDetectionStatus,
        }
        resolve(nookTypedArgs0_6)
      })
    })
    return response
  } catch {
    // Content script may be absent on restricted pages.
  }
  return { ok: true, status: LoginDetectionStatus.Unavailable }
}

export async function openCompanionLauncher(
  intent: OpenCompanionLauncherIntent,
): Promise<void> {
  const popupUrl = chrome.runtime.getURL('popup/index.html')
  const launcherUrl =
    intent === OpenCompanionLauncherIntent.Pair
      ? `${popupUrl}?intent=${OpenCompanionLauncherIntent.Pair}`
      : popupUrl
  if (chrome.windows?.create) {
    const nookTypedArgs0_7: Parameters<typeof chrome.windows.create>[0] = {
      url: launcherUrl,
      type: 'popup',
      width: 440,
      height: 620,
      focused: true,
    }
    await chrome.windows.create(nookTypedArgs0_7)
    return
  }
  const nookTypedArgs0_8: Parameters<typeof chrome.tabs.create>[0] = {
    url: launcherUrl,
  }
  await chrome.tabs.create(nookTypedArgs0_8)
}

export function openCompanionLauncherBestEffort(
  intent: OpenCompanionLauncherIntent,
): void {
  void openCompanionLauncher(intent).catch(() => {})
}
