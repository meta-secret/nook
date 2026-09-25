import { OpenCompanionLauncherIntent } from '../../../../nook-web-shared/src/extension/companion-launcher-message'

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

export class CompanionLauncher {
  private static readonly normalWindowType = 'normal' as const

  private static readonly directLauncherSource: CompanionLauncherSource = {
    kind: CompanionLauncherSourceKind.DirectEntry,
  }

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
        if (windowType === CompanionLauncher.normalWindowType) {
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
      windowTypes: [CompanionLauncher.normalWindowType],
    }
    const normalWindow = await chrome.windows.getLastFocused(getLastFocusedArgs)
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

  openCompanionLauncherBestEffort(request: CompanionLauncherOpenRequest): void {
    void this.openCompanionLauncher(request).catch(() => {
      console.warn('Nook authentication tab could not be opened')
    })
  }
}
