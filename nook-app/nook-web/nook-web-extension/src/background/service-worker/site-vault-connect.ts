import { OpenCompanionLauncherIntent } from '../../../../nook-web-shared/src/extension/companion-launcher-message'
import {
  SiteVaultConnectResponseKind,
  type SiteVaultConnectMessage,
  type SiteVaultConnectResponse,
} from '../../lib/site-vault-connect-messages'
import {
  CompanionLauncherSourceKind,
  type CompanionLauncherOpenRequest,
} from './companion-launcher'

/** The tab whose widget asked to connect, and the tab that opened it, if any. */
export type SiteVaultConnectOrigin = {
  readonly tabId: number
  readonly windowId: number
  readonly opener: SiteVaultConnectOpener
}

export enum SiteVaultConnectOpenerKind {
  Known = 'known',
  Unknown = 'unknown',
}

export type SiteVaultConnectOpener =
  | { readonly kind: SiteVaultConnectOpenerKind.Known; readonly tabId: number }
  | { readonly kind: SiteVaultConnectOpenerKind.Unknown }

/** Which normal window the connect flow opens in, and why. */
export enum SiteVaultConnectWindowKind {
  /** The originating tab is already in a normal window. */
  Source = 'source',
  /** The originating popup's opener tab sits in a normal window. */
  Opener = 'opener',
  /** The last focused normal window. */
  LastFocused = 'last-focused',
  /** A new normal window, because none could be determined. */
  NewWindow = 'new-window',
}

export type SiteVaultConnectWindow = {
  readonly kind: SiteVaultConnectWindowKind
  readonly windowId: number
}

export type SiteVaultConnectFocus = {
  readonly tabId: number
  readonly windowId: number
}

/** Whether a browser window can hold the connect flow's tab. */
export enum SiteVaultConnectWindowType {
  Normal = 'normal',
  /** A popup or any other window type, or one without an id. */
  Other = 'other',
}

/** What the connect flow reads of a browser window. */
export type SiteVaultConnectWindowFacts =
  | {
      readonly type: SiteVaultConnectWindowType.Normal
      readonly windowId: number
    }
  | { readonly type: SiteVaultConnectWindowType.Other }

/** What the connect flow reads of a browser tab. */
export type SiteVaultConnectTabFacts = { readonly windowId: number }

/** The browser calls the connect flow needs; all reject when unavailable. */
export type SiteVaultConnectBrowser = {
  readonly getWindow: (windowId: number) => Promise<SiteVaultConnectWindowFacts>
  readonly getTab: (tabId: number) => Promise<SiteVaultConnectTabFacts>
  readonly lastFocusedNormalWindow: () => Promise<SiteVaultConnectWindowFacts>
  readonly createNormalWindow: () => Promise<SiteVaultConnectWindowFacts>
  readonly focusTab: (focus: SiteVaultConnectFocus) => Promise<void>
}

enum ConnectWindowLookupKind {
  Found = 'found',
  Missing = 'missing',
}

type ConnectWindowLookup =
  | {
      readonly kind: ConnectWindowLookupKind.Found
      readonly window: SiteVaultConnectWindow
    }
  | { readonly kind: ConnectWindowLookupKind.Missing }

type ObservedConnectWindow = {
  readonly window: SiteVaultConnectWindowFacts
  readonly kind: SiteVaultConnectWindowKind
}

/**
 * Chooses the normal window for a connect flow. A popup window, such as a
 * provider's sign-in popup, never receives a tab: the flow opens beside the
 * popup's opener, else in the last focused normal window, else in a new
 * normal window. When none can be opened, the choice fails.
 */
export class SiteVaultConnectWindows {
  private static readonly missing: ConnectWindowLookup = {
    kind: ConnectWindowLookupKind.Missing,
  }

  constructor(private readonly browser: SiteVaultConnectBrowser) {}

  private lookup(observed: ObservedConnectWindow): ConnectWindowLookup {
    const window = observed.window
    switch (window.type) {
      case SiteVaultConnectWindowType.Other:
        return SiteVaultConnectWindows.missing
      case SiteVaultConnectWindowType.Normal:
        return {
          kind: ConnectWindowLookupKind.Found,
          window: { kind: observed.kind, windowId: window.windowId },
        }
    }
  }

  private async openerWindow(
    opener: SiteVaultConnectOpener,
  ): Promise<ConnectWindowLookup> {
    switch (opener.kind) {
      case SiteVaultConnectOpenerKind.Unknown:
        return SiteVaultConnectWindows.missing
      case SiteVaultConnectOpenerKind.Known:
        break
    }
    try {
      const openerTab = await this.browser.getTab(opener.tabId)
      const window = await this.browser.getWindow(openerTab.windowId)
      const observed: ObservedConnectWindow = {
        window,
        kind: SiteVaultConnectWindowKind.Opener,
      }
      return this.lookup(observed)
    } catch {
      // The opener tab closed or cannot be read: it cannot be determined.
      return SiteVaultConnectWindows.missing
    }
  }

  private async lastFocusedWindow(): Promise<ConnectWindowLookup> {
    try {
      const observed: ObservedConnectWindow = {
        window: await this.browser.lastFocusedNormalWindow(),
        kind: SiteVaultConnectWindowKind.LastFocused,
      }
      return this.lookup(observed)
    } catch {
      // No normal window is open.
      return SiteVaultConnectWindows.missing
    }
  }

  private async newWindow(): Promise<SiteVaultConnectWindow> {
    const observed: ObservedConnectWindow = {
      window: await this.browser.createNormalWindow(),
      kind: SiteVaultConnectWindowKind.NewWindow,
    }
    const created = this.lookup(observed)
    switch (created.kind) {
      case ConnectWindowLookupKind.Found:
        return created.window
      case ConnectWindowLookupKind.Missing:
        throw new Error('the new browser window is not a normal window')
    }
  }

  private async outsideWindow(
    origin: SiteVaultConnectOrigin,
  ): Promise<SiteVaultConnectWindow> {
    const opener = await this.openerWindow(origin.opener)
    switch (opener.kind) {
      case ConnectWindowLookupKind.Found:
        return opener.window
      case ConnectWindowLookupKind.Missing:
        break
    }
    const lastFocused = await this.lastFocusedWindow()
    switch (lastFocused.kind) {
      case ConnectWindowLookupKind.Found:
        return lastFocused.window
      case ConnectWindowLookupKind.Missing:
        return this.newWindow()
    }
  }

  async select(
    origin: SiteVaultConnectOrigin,
  ): Promise<SiteVaultConnectWindow> {
    const source: ObservedConnectWindow = {
      window: await this.browser.getWindow(origin.windowId),
      kind: SiteVaultConnectWindowKind.Source,
    }
    const lookup = this.lookup(source)
    switch (lookup.kind) {
      case ConnectWindowLookupKind.Found:
        return lookup.window
      case ConnectWindowLookupKind.Missing:
        return this.outsideWindow(origin)
    }
  }
}

enum ConnectReturnKind {
  Empty = 'empty',
  Pending = 'pending',
}

type ConnectReturn =
  | { readonly kind: ConnectReturnKind.Empty }
  | {
      readonly kind: ConnectReturnKind.Pending
      readonly focus: SiteVaultConnectFocus
      readonly expiresAt: number
    }

export type SiteVaultConnectReturnDependencies = {
  readonly browser: Pick<SiteVaultConnectBrowser, 'focusTab'>
  readonly now: () => number
}

/**
 * Remembers, in memory only, the tab whose widget started the latest
 * connect, and focuses it once after that connection is approved. A worker
 * restart or an expired connect leaves nothing to return to.
 */
export class SiteVaultConnectReturn {
  static readonly TTL_MS = 15 * 60 * 1000

  private pending: ConnectReturn = { kind: ConnectReturnKind.Empty }

  constructor(
    private readonly dependencies: SiteVaultConnectReturnDependencies,
  ) {}

  remember(focus: SiteVaultConnectFocus): void {
    this.pending = {
      kind: ConnectReturnKind.Pending,
      focus,
      expiresAt: this.dependencies.now() + SiteVaultConnectReturn.TTL_MS,
    }
  }

  async restore(): Promise<void> {
    const pending = this.pending
    this.pending = { kind: ConnectReturnKind.Empty }
    switch (pending.kind) {
      case ConnectReturnKind.Empty:
        return
      case ConnectReturnKind.Pending:
        break
    }
    switch (pending.expiresAt > this.dependencies.now()) {
      case false:
        return
      case true:
        return this.dependencies.browser.focusTab(pending.focus)
    }
  }
}

export type SiteVaultConnectDependencies = {
  readonly windows: Pick<SiteVaultConnectWindows, 'select'>
  readonly returnTo: Pick<SiteVaultConnectReturn, 'remember'>
  readonly openLauncher: (
    request: CompanionLauncherOpenRequest,
  ) => Promise<void>
  readonly runtimeId: string
}

export type SiteVaultConnectRequest = {
  readonly message: SiteVaultConnectMessage
  readonly sender: chrome.runtime.MessageSender
}

enum ConnectSenderKind {
  Page = 'page',
  Other = 'other',
}

/**
 * Starts the existing connect flow for a page widget: the authentication tab
 * with the pair intent, in the chosen normal window. It never connects
 * anything itself; the approval follows the existing pairing path.
 */
export class SiteVaultConnect {
  private static readonly failed: SiteVaultConnectResponse = {
    kind: SiteVaultConnectResponseKind.Failed,
  }

  constructor(private readonly dependencies: SiteVaultConnectDependencies) {}

  private senderKind(sender: chrome.runtime.MessageSender): ConnectSenderKind {
    switch (
      sender.id === this.dependencies.runtimeId &&
      typeof sender.tab?.id === 'number' &&
      typeof sender.tab.windowId === 'number'
    ) {
      case true:
        return ConnectSenderKind.Page
      case false:
        return ConnectSenderKind.Other
    }
  }

  private origin(tab: chrome.tabs.Tab): SiteVaultConnectOrigin {
    return {
      tabId: Number(tab.id),
      windowId: tab.windowId,
      opener: this.opener(tab),
    }
  }

  private opener(tab: chrome.tabs.Tab): SiteVaultConnectOpener {
    const openerTabId = tab.openerTabId
    switch (typeof openerTabId) {
      case 'number':
        return { kind: SiteVaultConnectOpenerKind.Known, tabId: openerTabId }
      case 'undefined':
      case 'string':
      case 'bigint':
      case 'boolean':
      case 'symbol':
      case 'object':
      case 'function':
        return { kind: SiteVaultConnectOpenerKind.Unknown }
    }
  }

  async connect(
    request: SiteVaultConnectRequest,
  ): Promise<SiteVaultConnectResponse> {
    const tab = request.sender.tab
    switch (this.senderKind(request.sender)) {
      case ConnectSenderKind.Other:
        return SiteVaultConnect.failed
      case ConnectSenderKind.Page:
        break
    }
    switch (typeof tab) {
      case 'object':
        break
      case 'undefined':
      case 'string':
      case 'number':
      case 'bigint':
      case 'boolean':
      case 'symbol':
      case 'function':
        return SiteVaultConnect.failed
    }
    const origin = this.origin(tab)
    try {
      const window = await this.dependencies.windows.select(origin)
      const launch: CompanionLauncherOpenRequest = {
        intent: OpenCompanionLauncherIntent.Pair,
        source: {
          kind: CompanionLauncherSourceKind.SourceWindow,
          windowId: window.windowId,
        },
      }
      await this.dependencies.openLauncher(launch)
    } catch {
      return SiteVaultConnect.failed
    }
    const focus: SiteVaultConnectFocus = {
      tabId: origin.tabId,
      windowId: origin.windowId,
    }
    this.dependencies.returnTo.remember(focus)
    return { kind: SiteVaultConnectResponseKind.Opened }
  }
}

/** The worker's browser bindings for the connect flow. */
export class ChromeSiteVaultConnectBrowser implements SiteVaultConnectBrowser {
  private static readonly normalWindowType = 'normal' as const

  private facts(window: chrome.windows.Window): SiteVaultConnectWindowFacts {
    switch (
      window.type === ChromeSiteVaultConnectBrowser.normalWindowType &&
      typeof window.id === 'number'
    ) {
      case true:
        return {
          type: SiteVaultConnectWindowType.Normal,
          windowId: Number(window.id),
        }
      case false:
        return { type: SiteVaultConnectWindowType.Other }
    }
  }

  readonly getWindow = async (windowId: number) =>
    this.facts(await chrome.windows.get(windowId))
  readonly getTab = async (tabId: number) => {
    const tab = await chrome.tabs.get(tabId)
    const facts: SiteVaultConnectTabFacts = { windowId: tab.windowId }
    return facts
  }
  readonly lastFocusedNormalWindow = async () => {
    const query: chrome.windows.QueryOptions = {
      windowTypes: [ChromeSiteVaultConnectBrowser.normalWindowType],
    }
    return this.facts(await chrome.windows.getLastFocused(query))
  }
  readonly createNormalWindow = async () => {
    const create: chrome.windows.CreateData = {
      type: ChromeSiteVaultConnectBrowser.normalWindowType,
      focused: true,
    }
    const created = await chrome.windows.create(create)
    switch (typeof created) {
      case 'object':
        return this.facts(created)
      case 'undefined':
      case 'string':
      case 'number':
      case 'bigint':
      case 'boolean':
      case 'symbol':
      case 'function':
        throw new Error('the browser did not open a window')
    }
  }
  readonly focusTab = async (focus: SiteVaultConnectFocus) => {
    const windowUpdate: chrome.windows.UpdateInfo = { focused: true }
    await chrome.windows.update(focus.windowId, windowUpdate)
    const tabUpdate: chrome.tabs.UpdateProperties = { active: true }
    await chrome.tabs.update(focus.tabId, tabUpdate)
  }
}
