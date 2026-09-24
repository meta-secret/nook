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
  launcherUrl: string
}

export enum CompanionLauncherSourceKind {
  DirectEntry = 'direct-entry',
  SourceWindow = 'source-window',
}

export type CompanionLauncherSource =
  | { kind: CompanionLauncherSourceKind.DirectEntry }
  | { kind: CompanionLauncherSourceKind.SourceWindow; windowId: number }

enum CompanionLauncherWindowScopeKind {
  NormalWindow = 'normal-window',
}

type CompanionLauncherWindowScope = {
  kind: CompanionLauncherWindowScopeKind.NormalWindow
  windowId: number
}

enum CompanionLauncherWindowIdKind {
  Valid = 'valid',
  Invalid = 'invalid',
}

type CompanionLauncherWindowIdState =
  | { kind: CompanionLauncherWindowIdKind.Valid; windowId: number }
  | { kind: CompanionLauncherWindowIdKind.Invalid }

enum CompanionLauncherTabLookupKind {
  Found = 'found',
  Missing = 'missing',
  Unobservable = 'unobservable',
}

type CompanionLauncherTabLookup =
  | {
      kind: CompanionLauncherTabLookupKind.Found
      tabId: number
      windowId: number
    }
  | { kind: CompanionLauncherTabLookupKind.Missing }
  | { kind: CompanionLauncherTabLookupKind.Unobservable }

enum CompanionLauncherContextObservationKind {
  NoMissingDocumentUrl = 'no-missing-document-url',
  MissingDocumentUrl = 'missing-document-url',
}

enum CompanionLauncherMatchingTabKind {
  Missing = 'missing',
  Present = 'present',
}

enum CompanionLauncherDocumentUrlKind {
  Missing = 'missing',
  Different = 'different',
  Matching = 'matching',
}

enum CompanionLauncherTabsQueryResultKind {
  Succeeded = 'succeeded',
  Failed = 'failed',
}

/** Owns the browser runtime resources shared by these interactions. */
export class ExtensionSessionLifecycle {
  private static readonly directLauncherSource: CompanionLauncherSource = {
    kind: CompanionLauncherSourceKind.DirectEntry,
  }

  private readonly document = new ExtensionSessionDocumentOwner()

  static directEntrySource(): CompanionLauncherSource {
    return this.directLauncherSource
  }

  static sourceFromTab(tab: chrome.tabs.Tab): CompanionLauncherSource {
    return this.sourceWindow(tab.windowId)
  }

  static sourceFromSender(
    sender: chrome.runtime.MessageSender,
  ): CompanionLauncherSource {
    const senderTab = sender.tab
    switch (typeof senderTab) {
      case 'undefined':
        return this.directLauncherSource
      default:
        return this.sourceWindow(senderTab.windowId)
    }
  }

  private static sourceWindow(windowId: number): CompanionLauncherSource {
    return {
      kind: CompanionLauncherSourceKind.SourceWindow,
      windowId,
    }
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
    launcherUrl,
  }: CompanionLauncherContextArgs):
    CompanionLauncherTabLookup {
    let contextObservation =
      CompanionLauncherContextObservationKind.NoMissingDocumentUrl
    for (const context of contexts) {
      if (
        context.contextType !== chrome.runtime.ContextType.TAB ||
        context.tabId < 0 ||
        context.windowId < 0
      ) {
        continue
      }
      const matchingTab = tabs.find(
        (tab) =>
          tab.id === context.tabId && tab.windowId === context.windowId,
      )
      let matchingTabKind = CompanionLauncherMatchingTabKind.Present
      switch (typeof matchingTab) {
        case 'undefined':
          matchingTabKind = CompanionLauncherMatchingTabKind.Missing
          break
        default:
          break
      }
      switch (matchingTabKind) {
        case CompanionLauncherMatchingTabKind.Missing:
          continue
        case CompanionLauncherMatchingTabKind.Present:
          break
      }
      let documentUrlKind = CompanionLauncherDocumentUrlKind.Missing
      switch (typeof context.documentUrl) {
        case 'undefined':
          break
        default:
          switch (context.documentUrl) {
            case launcherUrl:
              documentUrlKind = CompanionLauncherDocumentUrlKind.Matching
              break
            default:
              documentUrlKind = CompanionLauncherDocumentUrlKind.Different
              break
          }
          break
      }
      switch (documentUrlKind) {
        case CompanionLauncherDocumentUrlKind.Missing:
          contextObservation =
            CompanionLauncherContextObservationKind.MissingDocumentUrl
          break
        case CompanionLauncherDocumentUrlKind.Different:
          break
        case CompanionLauncherDocumentUrlKind.Matching:
          return {
            kind: CompanionLauncherTabLookupKind.Found,
            tabId: context.tabId,
            windowId: context.windowId,
          }
      }
    }
    switch (contextObservation) {
      case CompanionLauncherContextObservationKind.MissingDocumentUrl:
        return {
          kind: CompanionLauncherTabLookupKind.Unobservable,
        }
      case CompanionLauncherContextObservationKind.NoMissingDocumentUrl:
        return { kind: CompanionLauncherTabLookupKind.Missing }
    }
  }

  private async launcherWindowScope(
    source: CompanionLauncherSource,
  ): Promise<CompanionLauncherWindowScope> {
    switch (source.kind) {
      case CompanionLauncherSourceKind.DirectEntry:
        return this.lastFocusedNormalWindowScope()
      case CompanionLauncherSourceKind.SourceWindow: {
        const sourceWindowIdState = this.launcherWindowIdState(
          source.windowId,
        )
        switch (sourceWindowIdState.kind) {
          case CompanionLauncherWindowIdKind.Invalid:
            throw new Error('source tab has no valid browser window')
          case CompanionLauncherWindowIdKind.Valid: {
            const initiatingWindow = await chrome.windows.get(
              sourceWindowIdState.windowId,
            )
            switch (initiatingWindow.type) {
              case 'normal':
                return {
                  kind: CompanionLauncherWindowScopeKind.NormalWindow,
                  windowId: sourceWindowIdState.windowId,
                }
              default:
                throw new Error('source tab is not in a normal browser window')
            }
          }
        }
      }
    }
  }

  private async lastFocusedNormalWindowScope():
    Promise<CompanionLauncherWindowScope> {
    const normalWindow = await chrome.windows.getLastFocused({
      windowTypes: ['normal'],
    })
    switch (normalWindow.type) {
      case 'normal': {
        let windowIdState: CompanionLauncherWindowIdState
        switch (typeof normalWindow.id) {
          case 'undefined':
            windowIdState = { kind: CompanionLauncherWindowIdKind.Invalid }
            break
          default:
            windowIdState = this.launcherWindowIdState(normalWindow.id)
            break
        }
        switch (windowIdState.kind) {
          case CompanionLauncherWindowIdKind.Valid:
            return {
              kind: CompanionLauncherWindowScopeKind.NormalWindow,
              windowId: windowIdState.windowId,
            }
          case CompanionLauncherWindowIdKind.Invalid:
            throw new Error('last-focused normal window has no valid ID')
        }
      }
      default:
        throw new Error('last-focused browser window is not normal')
    }
  }

  private launcherWindowIdState(
    windowId: number,
  ): CompanionLauncherWindowIdState {
    switch (Number.isInteger(windowId)) {
      case true:
        switch (windowId >= 0) {
          case true:
            return {
              kind: CompanionLauncherWindowIdKind.Valid,
              windowId,
            }
          case false:
            return { kind: CompanionLauncherWindowIdKind.Invalid }
        }
      case false:
        return { kind: CompanionLauncherWindowIdKind.Invalid }
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
    source: CompanionLauncherSource,
  ): Promise<void> {
    const popupUrl = chrome.runtime.getURL('popup/index.html')
    const launcherUrlArgs: CompanionLauncherUrlArgs = { popupUrl, intent }
    const requestedLauncherUrl = this.launcherUrl(launcherUrlArgs)
    const windowScope = await this.launcherWindowScope(source)
    const queryArgs: Parameters<typeof chrome.tabs.query>[0] = {
      windowId: windowScope.windowId,
      windowType: 'normal',
    }
    const tabs = await new Promise<chrome.tabs.Tab[]>((resolve, reject) => {
      chrome.tabs.query(queryArgs, (result) => {
        let queryResultKind = CompanionLauncherTabsQueryResultKind.Succeeded
        switch (typeof chrome.runtime.lastError) {
          case 'undefined':
            break
          default:
            queryResultKind = CompanionLauncherTabsQueryResultKind.Failed
            break
        }
        switch (queryResultKind) {
          case CompanionLauncherTabsQueryResultKind.Succeeded:
            resolve(result)
            break
          case CompanionLauncherTabsQueryResultKind.Failed:
            reject(new Error('launcher tabs.query failed'))
            break
        }
      })
    })
    const contextQuery: Parameters<typeof chrome.runtime.getContexts>[0] = {
      contextTypes: [chrome.runtime.ContextType.TAB],
    }
    const contexts = await chrome.runtime.getContexts(contextQuery)
    const lookupArgs: CompanionLauncherContextArgs = {
      contexts,
      tabs,
      launcherUrl: requestedLauncherUrl,
    }
    const launcherTabLookup = this.launcherTab(lookupArgs)
    switch (launcherTabLookup.kind) {
      case CompanionLauncherTabLookupKind.Missing: {
        const createArgs: Parameters<typeof chrome.tabs.create>[0] = {
          url: requestedLauncherUrl,
          active: true,
          windowId: windowScope.windowId,
        }
        await chrome.tabs.create(createArgs)
        return
      }
      case CompanionLauncherTabLookupKind.Unobservable:
        throw new Error('launcher tab context is unobservable')
      case CompanionLauncherTabLookupKind.Found: {
        const updateArgs: Parameters<typeof chrome.tabs.update>[1] = {
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
    source: CompanionLauncherSource,
  ): void {
    void this.openCompanionLauncher(intent, source).catch(() => {
      console.warn('Nook authentication tab could not be opened')
    })
  }
}

export const extensionSessionLifecycle = new ExtensionSessionLifecycle()
