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

export type CompanionLauncherOpenRequest = {
  intent: OpenCompanionLauncherIntent
  source: CompanionLauncherSource
}

type CompanionLauncherContextArgs = {
  contexts: chrome.runtime.ExtensionContext[]
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

enum CompanionLauncherObservedWindowTypeKind {
  Missing = 'missing',
  Normal = 'normal',
  NonNormal = 'non-normal',
}

type CompanionLauncherObservedWindowType =
  | { kind: CompanionLauncherObservedWindowTypeKind.Missing }
  | { kind: CompanionLauncherObservedWindowTypeKind.Normal }
  | { kind: CompanionLauncherObservedWindowTypeKind.NonNormal }

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

enum CompanionLauncherDocumentUrlKind {
  Missing = 'missing',
  Different = 'different',
  Matching = 'matching',
}

/** Owns the browser runtime resources shared by these interactions. */
export class ExtensionSessionLifecycle {
  private static readonly normalWindowType = 'normal' as const

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
      case 'object':
        return this.sourceWindow(senderTab.windowId)
      case 'string':
      case 'number':
      case 'bigint':
      case 'boolean':
      case 'symbol':
      case 'function':
        throw new Error('sender tab has an invalid runtime type')
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

  private observedWindowType(
    windowType: chrome.windows.Window['type'],
  ): CompanionLauncherObservedWindowType {
    switch (typeof windowType) {
      case 'undefined':
        return { kind: CompanionLauncherObservedWindowTypeKind.Missing }
      case 'string':
        if (windowType === ExtensionSessionLifecycle.normalWindowType) {
          return { kind: CompanionLauncherObservedWindowTypeKind.Normal }
        }
        return { kind: CompanionLauncherObservedWindowTypeKind.NonNormal }
      case 'number':
      case 'bigint':
      case 'boolean':
      case 'symbol':
      case 'object':
      case 'function':
        return { kind: CompanionLauncherObservedWindowTypeKind.NonNormal }
    }
  }

  private launcherTab({
    contexts,
    launcherUrl,
  }: CompanionLauncherContextArgs): CompanionLauncherTabLookup {
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
      let documentUrlKind = CompanionLauncherDocumentUrlKind.Missing
      switch (typeof context.documentUrl) {
        case 'undefined':
          break
        case 'string':
          switch (context.documentUrl) {
            case launcherUrl:
              documentUrlKind = CompanionLauncherDocumentUrlKind.Matching
              break
            default:
              documentUrlKind = CompanionLauncherDocumentUrlKind.Different
              break
          }
          break
        case 'number':
        case 'bigint':
        case 'boolean':
        case 'symbol':
        case 'object':
        case 'function':
          throw new Error('launcher tab document URL has an invalid type')
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
        const sourceWindowIdState = this.launcherWindowIdState(source.windowId)
        switch (sourceWindowIdState.kind) {
          case CompanionLauncherWindowIdKind.Invalid:
            throw new Error('source tab has no valid browser window')
          case CompanionLauncherWindowIdKind.Valid: {
            const initiatingWindow = await chrome.windows.get(
              sourceWindowIdState.windowId,
            )
            const observedWindowType = this.observedWindowType(
              initiatingWindow.type,
            )
            switch (observedWindowType.kind) {
              case CompanionLauncherObservedWindowTypeKind.Normal:
                return {
                  kind: CompanionLauncherWindowScopeKind.NormalWindow,
                  windowId: sourceWindowIdState.windowId,
                }
              case CompanionLauncherObservedWindowTypeKind.Missing:
              case CompanionLauncherObservedWindowTypeKind.NonNormal:
                throw new Error('source tab is not in a normal browser window')
            }
          }
        }
      }
    }
  }

  private async lastFocusedNormalWindowScope(): Promise<CompanionLauncherWindowScope> {
    const getLastFocusedArgs: Parameters<
      typeof chrome.windows.getLastFocused
    >[0] = {
      windowTypes: [ExtensionSessionLifecycle.normalWindowType],
    }
    const normalWindow = await chrome.windows.getLastFocused(
      getLastFocusedArgs,
    )
    const observedWindowType = this.observedWindowType(normalWindow.type)
    switch (observedWindowType.kind) {
      case CompanionLauncherObservedWindowTypeKind.Missing:
      case CompanionLauncherObservedWindowTypeKind.NonNormal:
        throw new Error('last-focused browser window is not normal')
      case CompanionLauncherObservedWindowTypeKind.Normal: {
        let windowIdState: CompanionLauncherWindowIdState
        switch (typeof normalWindow.id) {
          case 'undefined':
            windowIdState = { kind: CompanionLauncherWindowIdKind.Invalid }
            break
          case 'number':
            windowIdState = this.launcherWindowIdState(normalWindow.id)
            break
          case 'string':
          case 'bigint':
          case 'boolean':
          case 'symbol':
          case 'object':
          case 'function':
            throw new Error('last-focused normal window has an invalid ID type')
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
        break
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

  async openCompanionLauncher({
    intent,
    source,
  }: CompanionLauncherOpenRequest): Promise<void> {
    const popupUrl = chrome.runtime.getURL('popup/index.html')
    const launcherUrlArgs: CompanionLauncherUrlArgs = { popupUrl, intent }
    const requestedLauncherUrl = this.launcherUrl(launcherUrlArgs)
    const windowScope = await this.launcherWindowScope(source)
    const contextQuery: Parameters<typeof chrome.runtime.getContexts>[0] = {
      contextTypes: [chrome.runtime.ContextType.TAB],
      windowIds: [windowScope.windowId],
    }
    const contexts = await chrome.runtime.getContexts(contextQuery)
    const lookupArgs: CompanionLauncherContextArgs = {
      contexts,
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
    request: CompanionLauncherOpenRequest,
  ): void {
    void this.openCompanionLauncher(request).catch(() => {
      console.warn('Nook authentication tab could not be opened')
    })
  }
}

export const extensionSessionLifecycle = new ExtensionSessionLifecycle()
