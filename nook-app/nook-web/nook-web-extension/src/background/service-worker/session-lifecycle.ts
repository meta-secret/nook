import { Schema } from 'effect'
import {
  ExtensionSessionDocumentOwner,
  ExtensionSessionDocumentStateKind,
  type ExtensionSessionTransportResult,
  type ExtensionSessionTransport,
} from './session-document'
export { extensionSessionDocument } from './session-document'
import { simpleVaultRuntime } from '../../lib/simple-vault-runtime'
import { DeviceProtectionStatus } from '../../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { OpenCompanionLauncherIntent } from '../../../../nook-web-shared/src/extension/companion-launcher-message'
import { ExtensionRuntimeRequestType } from '../../lib/extension-runtime-request-type'
import {
  ConcreteDecoderResultKind,
  runConcreteDecoder,
} from '../../lib/concrete-decoder'

export const SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS = 4_000

type AuthenticationSurfaceNotification = {
  type: ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces
}

type AuthenticationSurfaceRefreshSuccess = { ok: true }
type AuthenticationSurfaceRefreshResponse = { ok?: boolean }

type ModuleStructRequest = { ok: Schema.Literal<[true]> }
const moduleStructRequest: ModuleStructRequest = {
  ok: Schema.Literal(true),
}
const authenticationSurfaceRefreshSuccessSchema = Schema.Struct(
  moduleStructRequest,
) satisfies Schema.Schema<AuthenticationSurfaceRefreshSuccess>

function decodeAuthenticationSurfaceRefreshSuccess(response: unknown) {
  return Schema.decodeUnknown(authenticationSurfaceRefreshSuccessSchema)(
    response,
  )
}

type AuthenticationSurfaceDeliveryRequest = {
  tabId: number
  message: AuthenticationSurfaceNotification
}

type CompanionLauncherUrlArgs = {
  popupUrl: string
  intent: OpenCompanionLauncherIntent
}

type CompanionLauncherContextArgs = {
  contexts: chrome.runtime.ExtensionContext[]
  tabs: chrome.tabs.Tab[]
  launcherUrls: Set<string>
}

type CompanionLauncherWindowScope =
  | { kind: 'normal-window'; windowId: number }
  | { kind: 'last-focused-normal-window' }

type CompanionLauncherTabLookup =
  | { kind: 'found'; tabId: number; windowId: number }
  | { kind: 'missing' }

/** Owns the browser runtime resources shared by these interactions. */
export class ExtensionSessionLifecycle {
  private readonly document = new ExtensionSessionDocumentOwner()

  private launcherTabUrls(popupUrl: string): Set<string> {
    return new Set([
      popupUrl,
      `${popupUrl}?intent=${OpenCompanionLauncherIntent.Pair}`,
      `${popupUrl}?intent=${OpenCompanionLauncherIntent.PilotAuth}`,
    ])
  }

  private launcherUrl({ popupUrl, intent }: CompanionLauncherUrlArgs): string {
    switch (intent) {
      case OpenCompanionLauncherIntent.Default:
        return popupUrl
      case OpenCompanionLauncherIntent.Pair:
        return `${popupUrl}?intent=${OpenCompanionLauncherIntent.Pair}`
      case OpenCompanionLauncherIntent.PilotAuth:
        return `${popupUrl}?intent=${OpenCompanionLauncherIntent.PilotAuth}`
    }
  }

  private launcherTab({
    contexts,
    tabs,
    launcherUrls,
  }: CompanionLauncherContextArgs):
    CompanionLauncherTabLookup {
    const candidate = contexts.find((context) => {
      if (
        context.contextType !== chrome.runtime.ContextType.TAB ||
        context.tabId < 0 ||
        context.windowId < 0
      ) {
        return false
      }
      switch (typeof context.documentUrl) {
        case 'string':
          if (!launcherUrls.has(context.documentUrl)) return false
          break
        case 'undefined':
          return false
      }
      return tabs.some(
        (tab) =>
          tab.id === context.tabId && tab.windowId === context.windowId,
      )
    })
    switch (candidate) {
      case undefined:
        return { kind: 'missing' }
      default:
        return {
          kind: 'found',
          tabId: candidate.tabId,
          windowId: candidate.windowId,
        }
    }
  }

  private async launcherWindowScope(
    initiatingTab: chrome.tabs.Tab | undefined,
  ): Promise<CompanionLauncherWindowScope> {
    switch (initiatingTab) {
      case undefined:
        return this.lastFocusedNormalWindowScope()
      default:
        if (
          Number.isInteger(initiatingTab.windowId) &&
          initiatingTab.windowId >= 0
        ) {
          try {
            const initiatingWindow = await chrome.windows.get(
              initiatingTab.windowId,
            )
            switch (initiatingWindow.type) {
              case 'normal':
                return {
                  kind: 'normal-window',
                  windowId: initiatingTab.windowId,
                }
              default:
                return this.lastFocusedNormalWindowScope()
            }
          } catch {
            return this.lastFocusedNormalWindowScope()
          }
        }
        return this.lastFocusedNormalWindowScope()
    }
  }

  private async lastFocusedNormalWindowScope():
    Promise<CompanionLauncherWindowScope> {
    try {
      const normalWindow = await chrome.windows.getLastFocused({
        windowTypes: ['normal'],
      })
      switch (normalWindow.type) {
        case 'normal':
          switch (typeof normalWindow.id) {
            case 'number':
              if (Number.isInteger(normalWindow.id) && normalWindow.id >= 0) {
                return { kind: 'normal-window', windowId: normalWindow.id }
              }
              break
            case 'undefined':
              break
          }
          break
        default:
          break
      }
    } catch {
      // Keep the default-window fallback when the browser has no normal window.
    }
    return { kind: 'last-focused-normal-window' }
  }

  private launcherTabQueryArgs(
    windowScope: CompanionLauncherWindowScope,
  ): Parameters<typeof chrome.tabs.query>[0] {
    switch (windowScope.kind) {
      case 'normal-window':
        return {
          windowId: windowScope.windowId,
          windowType: 'normal',
        }
      case 'last-focused-normal-window':
        return {
          lastFocusedWindow: true,
          windowType: 'normal',
        }
    }
  }

  async ensureExtensionSessionDocument(): Promise<
    ExtensionSessionTransportResult<ExtensionSessionTransport>
  > {
    return this.document.open()
  }

  openSessionDocument(): Promise<
    ExtensionSessionTransportResult<ExtensionSessionTransport>
  > {
    return this.document.open()
  }

  closeExtensionSessionDocument(): Promise<
    ExtensionSessionTransportResult<ExtensionSessionDocumentStateKind.Closed>
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
    const sendTabMessage = ({
      tabId: targetTabId,
      message: targetMessage,
    }: AuthenticationSurfaceDeliveryRequest): Promise<AuthenticationSurfaceRefreshResponse> =>
      chrome.tabs.sendMessage(targetTabId, targetMessage)
    const request: AuthenticationSurfaceDeliveryRequest = { tabId, message }
    const response = await sendTabMessage(request)
    const decoded = runConcreteDecoder(
      decodeAuthenticationSurfaceRefreshSuccess,
      response,
    )
    if (decoded.kind === ConcreteDecoderResultKind.Rejected) {
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
    initiatingTab?: chrome.tabs.Tab,
  ): Promise<void> {
    const popupUrl = chrome.runtime.getURL('popup/index.html')
    const launcherUrlArgs: CompanionLauncherUrlArgs = { popupUrl, intent }
    const requestedLauncherUrl = this.launcherUrl(launcherUrlArgs)
    const launcherUrls = this.launcherTabUrls(popupUrl)
    const windowScope = await this.launcherWindowScope(initiatingTab)
    const queryArgs = this.launcherTabQueryArgs(windowScope)
    const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
      chrome.tabs.query(queryArgs, resolve)
    })
    let contexts: chrome.runtime.ExtensionContext[]
    try {
      const contextQuery: Parameters<typeof chrome.runtime.getContexts>[0] = {
        contextTypes: [chrome.runtime.ContextType.TAB],
      }
      contexts = await chrome.runtime.getContexts(contextQuery)
    } catch {
      // Opening a fresh tab keeps the launch usable when context observation
      // is unavailable; a later request can reuse it once observation works.
      contexts = []
    }
    const lookupArgs: CompanionLauncherContextArgs = {
      contexts,
      tabs,
      launcherUrls,
    }
    const launcherTabLookup = this.launcherTab(lookupArgs)
    switch (launcherTabLookup.kind) {
      case 'missing': {
        const createArgs: Parameters<typeof chrome.tabs.create>[0] = {
          url: requestedLauncherUrl,
          active: true,
        }
        switch (windowScope.kind) {
          case 'normal-window':
            createArgs.windowId = windowScope.windowId
            break
          case 'last-focused-normal-window': {
            const [lastFocusedTab] = tabs
            switch (lastFocusedTab) {
              case undefined:
                break
              default:
                createArgs.windowId = lastFocusedTab.windowId
                break
            }
            break
          }
        }
        await chrome.tabs.create(createArgs)
        return
      }
      case 'found': {
        const updateArgs: Parameters<typeof chrome.tabs.update>[1] = {
          url: requestedLauncherUrl,
          active: true,
        }
        await chrome.tabs.update(launcherTabLookup.tabId, updateArgs)
        const focusArgs: Parameters<typeof chrome.windows.update>[1] = {
          focused: true,
        }
        await chrome.windows.update(launcherTabLookup.windowId, focusArgs)
        return
      }
    }
  }

  openCompanionLauncherBestEffort(
    intent: OpenCompanionLauncherIntent,
    initiatingTab?: chrome.tabs.Tab,
  ): void {
    void this.openCompanionLauncher(intent, initiatingTab).catch(() => {})
  }
}

export const extensionSessionLifecycle = new ExtensionSessionLifecycle()
