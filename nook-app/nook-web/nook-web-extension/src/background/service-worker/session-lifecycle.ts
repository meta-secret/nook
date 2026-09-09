import { simpleVaultRuntime } from '../../lib/simple-vault-runtime'
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
      operation: Promise<OpenExtensionSessionDocument>
    }
  | {
      kind: ExtensionSessionDocumentStateKind.Open
      document: OpenExtensionSessionDocument
    }
  | {
      kind: ExtensionSessionDocumentStateKind.Closing
      operation: Promise<void>
    }

/** The sending capability exists only after browser document creation completes. */
export interface ExtensionSessionTransport {
  sendMessage(message: unknown): Promise<unknown>
}

class OpenExtensionSessionDocument {
  private active = true
  private constructor() {}
  static async create(): Promise<OpenExtensionSessionDocument> {
    try {
      await chrome.offscreen.createDocument({
        url: extensionSessionDocument,
        reasons: ['WORKERS'],
        justification:
          'Keep a user-authorized extension device identity in memory for a 15-minute session.',
      })
    } catch (error) {
      if (!String(error).includes('single offscreen')) throw error
    }
    return new OpenExtensionSessionDocument()
  }
  sendMessage(message: unknown): Promise<unknown> {
    if (!this.active)
      return Promise.reject(new Error('Extension session document closed'))
    // eslint-disable-next-line max-params -- Promise owns this executor.
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError?.message
        if (!this.active) reject(new Error('Extension session document closed'))
        else if (error) reject(new Error(error))
        else resolve(response)
      })
    })
  }
  close(): Promise<void> {
    if (!this.active) return Promise.resolve()
    this.active = false
    return chrome.offscreen.closeDocument()
  }
}

type AuthenticationSurfaceNotification = {
  type: ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces
}

type AuthenticationSurfaceRefreshSuccess = { ok: true }

type AuthenticationSurfaceDeliveryRequest = {
  tabId: number
  message: AuthenticationSurfaceNotification
}

/** Owns the browser runtime resources shared by these interactions. */
class ExtensionSessionLifecycle {
  private extensionSessionDocumentState: ExtensionSessionDocumentState = {
    kind: ExtensionSessionDocumentStateKind.Closed,
  }
  async ensureExtensionSessionDocument(): Promise<void> {
    await this.openSessionDocument()
  }

  async openSessionDocument(): Promise<ExtensionSessionTransport> {
    const state = this.extensionSessionDocumentState
    if (state.kind === ExtensionSessionDocumentStateKind.Closing) {
      await state.operation
      return this.openSessionDocument()
    }
    if (state.kind === ExtensionSessionDocumentStateKind.Open)
      return state.document
    if (state.kind === ExtensionSessionDocumentStateKind.Creating)
      return state.operation
    const operation = OpenExtensionSessionDocument.create().then((document) => {
      if (
        this.extensionSessionDocumentState.kind ===
          ExtensionSessionDocumentStateKind.Creating &&
        this.extensionSessionDocumentState.operation === operation
      ) {
        this.extensionSessionDocumentState = {
          kind: ExtensionSessionDocumentStateKind.Open,
          document,
        }
      }
      return document
    })
    this.extensionSessionDocumentState = {
      kind: ExtensionSessionDocumentStateKind.Creating,
      operation,
    }
    return operation
  }

  closeExtensionSessionDocument(): Promise<void> {
    const state = this.extensionSessionDocumentState
    if (state.kind === ExtensionSessionDocumentStateKind.Closed)
      return Promise.resolve()
    if (state.kind === ExtensionSessionDocumentStateKind.Closing)
      return state.operation
    const closure = (
      state.kind === ExtensionSessionDocumentStateKind.Creating
        ? state.operation.then((document) => document.close())
        : state.document.close()
    ).finally(() => {
      if (
        this.extensionSessionDocumentState.kind ===
          ExtensionSessionDocumentStateKind.Closing &&
        this.extensionSessionDocumentState.operation === closure
      ) {
        this.extensionSessionDocumentState = {
          kind: ExtensionSessionDocumentStateKind.Closed,
        }
      }
    })
    this.extensionSessionDocumentState = {
      kind: ExtensionSessionDocumentStateKind.Closing,
      operation: closure,
    }
    return closure
  }

  isUnlockedSessionStatus(status: unknown): boolean {
    return Boolean(
      status &&
      typeof status === 'object' &&
      'status' in status &&
      status.status === DeviceProtectionStatus.Unlocked,
    )
  }

  async openSimpleVault(path = ''): Promise<void> {
    const nookTypedArgs0_1: Parameters<typeof chrome.tabs.create>[0] = {
      url: await simpleVaultRuntime.runtimeSimpleVaultUrl(path),
    }
    void chrome.tabs.create(nookTypedArgs0_1)
  }

  private authenticationSurfaceRefreshSucceeded(
    response: unknown,
  ): response is AuthenticationSurfaceRefreshSuccess {
    return (
      !!response &&
      typeof response === 'object' &&
      'ok' in response &&
      response.ok === true
    )
  }

  private async authenticationSurfaceTabId(
    tab: chrome.tabs.Tab,
  ): Promise<number | false> {
    if (
      typeof tab.id !== 'number' ||
      !Number.isInteger(tab.id) ||
      typeof tab.url !== 'string' ||
      (await simpleVaultRuntime.isRuntimeNookVaultAppUrl(tab.url))
    ) {
      return false
    }
    try {
      const protocol = new URL(tab.url).protocol
      if (!['http:', 'https:'].includes(protocol)) return false
    } catch {
      return false
    }
    return tab.id
  }

  private async deliverAuthenticationSurfaceNotification({
    tabId,
    message,
  }: AuthenticationSurfaceDeliveryRequest): Promise<void> {
    const response = await chrome.tabs.sendMessage(tabId, message)
    if (!this.authenticationSurfaceRefreshSucceeded(response)) {
      throw new Error('authentication surface refresh rejected')
    }
  }

  private async notifyAuthenticationSurfaces(
    message: AuthenticationSurfaceNotification,
  ): Promise<void> {
    const queryArgs: Parameters<typeof chrome.tabs.query>[0] = {}
    const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
      chrome.tabs.query(queryArgs, resolve)
    })
    const eligibleTabIds: number[] = []
    for (const tab of tabs) {
      const tabId = await this.authenticationSurfaceTabId(tab)
      if (tabId !== false) eligibleTabIds.push(tabId)
    }
    const deliveries = await Promise.allSettled(
      eligibleTabIds.map((tabId) => {
        const deliveryRequest: AuthenticationSurfaceDeliveryRequest = {
          tabId,
          message,
        }
        return this.deliverAuthenticationSurfaceNotification(deliveryRequest)
      }),
    )
    if (deliveries.some((delivery) => delivery.status === 'rejected')) {
      throw new Error('authentication surface refresh delivery failed')
    }
  }

  refreshAuthenticationSurfaces(): Promise<void> {
    const args: AuthenticationSurfaceNotification = {
      type: ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces,
    }
    return this.notifyAuthenticationSurfaces(args)
  }

  async openCompanionLauncher(
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

  openCompanionLauncherBestEffort(intent: OpenCompanionLauncherIntent): void {
    void this.openCompanionLauncher(intent).catch(() => {})
  }
}

export const extensionSessionLifecycle = new ExtensionSessionLifecycle()
