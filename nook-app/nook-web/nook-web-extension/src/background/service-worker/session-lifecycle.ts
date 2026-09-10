import {
  ExtensionSessionDocumentOwner,
  type ExtensionSessionTransportResult,
  type ExtensionSessionTransport,
} from './session-document'
export { extensionSessionDocument } from './session-document'
import { simpleVaultRuntime } from '../../lib/simple-vault-runtime'
import { DeviceProtectionStatus } from '../../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { OpenCompanionLauncherIntent } from '../../../../nook-web-shared/src/extension/companion-launcher-message'
import { ExtensionRuntimeRequestType } from '../../lib/extension-runtime-request-type'

export const SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS = 4_000

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
  private readonly document = new ExtensionSessionDocumentOwner()

  async ensureExtensionSessionDocument(): Promise<
    ExtensionSessionTransportResult<void>
  > {
    const opened = await this.document.open()
    return opened.map(() => {})
  }

  openSessionDocument(): Promise<
    ExtensionSessionTransportResult<ExtensionSessionTransport>
  > {
    return this.document.open()
  }

  closeExtensionSessionDocument(): Promise<
    ExtensionSessionTransportResult<void>
  > {
    return this.document.close()
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
    await chrome.tabs.create(nookTypedArgs0_1)
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
