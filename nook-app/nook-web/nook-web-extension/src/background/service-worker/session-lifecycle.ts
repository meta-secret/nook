import { runtimeSimpleVaultUrl } from '../../lib/simple-vault-runtime'
import { DeviceProtectionStatus } from '../../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { OpenCompanionLauncherIntent } from '../../../../nook-web-shared/src/extension/companion-launcher-message'
import { ExtensionRuntimeRequestType } from '../../lib/extension-runtime-request-type'

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

type AuthenticationSurfaceNotification = {
  type: ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces
}

async function notifyAuthenticationSurfaces(
  message: AuthenticationSurfaceNotification,
): Promise<void> {
  const queryArgs: Parameters<typeof chrome.tabs.query>[0] = {}
  const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
    chrome.tabs.query(queryArgs, resolve)
  })
  const eligibleTabIds: number[] = []
  for (const tab of tabs) {
    if (typeof tab.id === 'number' && Number.isInteger(tab.id)) {
      eligibleTabIds.push(tab.id)
    }
  }
  const deliveries = await Promise.allSettled(
    eligibleTabIds.map((tabId) => chrome.tabs.sendMessage(tabId, message)),
  )
  if (
    eligibleTabIds.length > 0 &&
    !deliveries.some((delivery) => 'value' in delivery)
  ) {
    throw new Error('authentication surface refresh delivery failed')
  }
}

export function refreshAuthenticationSurfaces(): Promise<void> {
  const args: AuthenticationSurfaceNotification = {
    type: ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces,
  }
  return notifyAuthenticationSurfaces(args)
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
