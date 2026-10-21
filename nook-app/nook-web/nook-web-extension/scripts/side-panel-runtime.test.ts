import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Effect } from 'effect'
import {
  BeginExtensionPairingMessageType,
  OpenSimpleVaultMessageType,
} from '../../nook-web-shared/src/extension/lifecycle-runtime-messages'
import type { BrowserRuntimeMessageValue } from '../src/lib/browser-runtime-message'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import {
  ExtensionSessionSenderAdmission,
  ExtensionSessionSenderPolicy,
} from '../src/offscreen/session-sender-policy'
import {
  SidePanelChangeKind,
  SidePanelRuntime,
  SidePanelWindowKind,
  type SidePanelWindow,
} from '../src/side-panel/side-panel-runtime'
import { browserTab } from './companion-launcher-test-support'

type ActivatedListener = Parameters<
  typeof chrome.tabs.onActivated.addListener
>[0]
type UpdatedListener = Parameters<typeof chrome.tabs.onUpdated.addListener>[0]
type ReplyCallback = (reply: BrowserRuntimeMessageValue) => void
type SentMessage = BrowserRuntimeMessageValue
type ListenerRemoval<Listener> = {
  readonly list: Listener[]
  readonly listener: Listener
}
type TabUpdate = {
  readonly change: chrome.tabs.OnUpdatedInfo
  readonly tab: chrome.tabs.Tab
}
type TabPlacement = {
  readonly windowId: number
  readonly active: boolean
}

enum FixtureReplyKind {
  Acknowledged = 'acknowledged',
  /** The service worker opened or reused the Nook tab. */
  TabOpened = 'tab-opened',
  Refused = 'refused',
  /** No listener answered: Chrome sets lastError. */
  Unanswered = 'unanswered',
}

enum FixtureWindowKind {
  Identified = 'identified',
  MissingId = 'missing-id',
  Rejected = 'rejected',
}

/** The document visibility states the fixture can switch the panel to. */
enum FixtureVisibility {
  Visible = 'visible',
  Hidden = 'hidden',
}

/** A browser host for the panel: it records what the panel registers and
 * sends, and fires tab and visibility changes on request. */
class SidePanelBrowserFixture {
  readonly sent: SentMessage[] = []
  readonly runtimeListeners: string[] = []
  readonly tabMessages: string[] = []
  readonly activated: ActivatedListener[] = []
  readonly updated: UpdatedListener[] = []
  readonly document = Object.assign(new EventTarget(), {
    visibilityState: FixtureVisibility.Visible,
  })
  readonly window = new EventTarget()
  reply = FixtureReplyKind.Acknowledged
  currentWindow = FixtureWindowKind.Identified

  private readonly runtime = {
    id: 'nook-extension',
    getURL: (resource: string) =>
      `chrome-extension://nook-extension/${resource}`,
    onMessage: {
      addListener: () => this.runtimeListeners.push('onMessage'),
    },
    sendMessage: (message: SentMessage, callback: ReplyCallback) => {
      this.sent.push(message)
      this.answer(callback)
    },
  }

  readonly focusedTabs: number[] = []

  private readonly tabs = {
    sendMessage: () => this.tabMessages.push('sendMessage'),
    update: (tabId: number, update: chrome.tabs.UpdateProperties) => {
      switch (update.active === true) {
        case true:
          this.focusedTabs.push(tabId)
          return Promise.resolve(browserTab('https://simple.nokey.sh/', tabId))
        case false:
          return Promise.reject(new Error('unexpected tab update'))
      }
    },
    onActivated: {
      addListener: (listener: ActivatedListener) =>
        this.activated.push(listener),
      removeListener: (listener: ActivatedListener) => {
        const removal: ListenerRemoval<ActivatedListener> = {
          list: this.activated,
          listener,
        }
        this.remove(removal)
      },
    },
    onUpdated: {
      addListener: (listener: UpdatedListener) => this.updated.push(listener),
      removeListener: (listener: UpdatedListener) => {
        const removal: ListenerRemoval<UpdatedListener> = {
          list: this.updated,
          listener,
        }
        this.remove(removal)
      },
    },
  }

  private readonly windows = {
    getCurrent: () => this.currentWindowReply(),
  }

  install(): void {
    const chromeStub = {
      runtime: this.runtime,
      tabs: this.tabs,
      windows: this.windows,
    }
    Object.assign(globalThis, {
      chrome: chromeStub,
      document: this.document,
      window: this.window,
    })
  }

  private remove<Listener>(request: ListenerRemoval<Listener>): void {
    // Chrome ignores removing a listener it never added.
    const index = request.list.indexOf(request.listener)
    switch (index) {
      case -1:
        return
      default:
        request.list.splice(index, 1)
    }
  }

  private answer(callback: ReplyCallback): void {
    switch (this.reply) {
      case FixtureReplyKind.Acknowledged:
        callback({ ok: true })
        return
      case FixtureReplyKind.TabOpened:
        callback({ ok: true, tabId: 31 })
        return
      case FixtureReplyKind.Refused:
        callback({ ok: false, reason: 'forbidden-sender' })
        return
      case FixtureReplyKind.Unanswered: {
        const lastError: chrome.runtime.LastError = {
          message: 'Could not establish connection.',
        }
        Reflect.set(this.runtime, 'lastError', lastError)
        callback('')
        Reflect.deleteProperty(this.runtime, 'lastError')
      }
    }
  }

  private currentWindowReply(): Promise<chrome.windows.Window> {
    const base: chrome.windows.Window = {
      focused: true,
      alwaysOnTop: false,
      incognito: false,
    }
    switch (this.currentWindow) {
      case FixtureWindowKind.Identified:
        return Promise.resolve({ ...base, id: 7 })
      case FixtureWindowKind.MissingId:
        return Promise.resolve(base)
      case FixtureWindowKind.Rejected:
        return Promise.reject(new Error('No current window.'))
    }
  }

  fireActivated(windowId: number): void {
    const info: chrome.tabs.OnActivatedInfo = { tabId: 3, windowId }
    for (const listener of this.activated) listener(info)
  }

  fireUpdated(request: TabUpdate): void {
    for (const listener of this.updated)
      listener(3, request.change, request.tab)
  }

  fireVisibility(state: FixtureVisibility): void {
    this.document.visibilityState = state
    this.document.dispatchEvent(new Event('visibilitychange'))
  }
}

const panelWindow: SidePanelWindow = { kind: SidePanelWindowKind.Known, id: 7 }
const savedChrome = globalThis.chrome
let fixture = new SidePanelBrowserFixture()

beforeEach(() => {
  fixture = new SidePanelBrowserFixture()
  fixture.install()
})

afterEach(() => {
  Object.assign(globalThis, { chrome: savedChrome })
  // Bun has no document or window of its own.
  Reflect.deleteProperty(globalThis, 'document')
  Reflect.deleteProperty(globalThis, 'window')
})

function tabIn(request: TabPlacement): chrome.tabs.Tab {
  // The URL is never read by the panel; any page will do.
  const tab = browserTab('https://accounts.example.test/login', 3)
  return { ...tab, windowId: request.windowId, active: request.active }
}

describe('side panel browser runtime', () => {
  test('follows its own window without runtime broadcasts or tab messages', () => {
    const changes: SidePanelChangeKind[] = []
    const activatedTabs: number[] = []
    const release = new SidePanelRuntime().follow({
      window: panelWindow,
      onchange: (change) => changes.push(change),
      ontabactivated: (tabId) => activatedTabs.push(tabId),
    })

    fixture.fireActivated(7)
    fixture.fireActivated(8)
    fixture.fireUpdated({
      change: { title: 'Signed in' },
      tab: tabIn({ windowId: 7, active: true }),
    })
    fixture.fireUpdated({
      change: { url: 'https://accounts.example.test/next' },
      tab: tabIn({ windowId: 7, active: true }),
    })
    fixture.fireUpdated({
      change: { status: 'complete' },
      tab: tabIn({ windowId: 7, active: true }),
    })
    fixture.fireUpdated({
      change: { status: 'complete' },
      tab: tabIn({ windowId: 7, active: false }),
    })
    fixture.fireUpdated({
      change: { status: 'complete' },
      tab: tabIn({ windowId: 8, active: true }),
    })
    fixture.fireVisibility(FixtureVisibility.Hidden)
    fixture.fireVisibility(FixtureVisibility.Visible)
    fixture.window.dispatchEvent(new Event('focus'))

    expect(changes).toEqual([
      SidePanelChangeKind.TabActivated,
      SidePanelChangeKind.TabNavigated,
      SidePanelChangeKind.TabNavigated,
      SidePanelChangeKind.PanelHidden,
      SidePanelChangeKind.PanelShown,
      SidePanelChangeKind.PanelFocused,
    ])
    // Only the activation in the panel's window names its tab.
    expect(activatedTabs).toEqual([3])
    expect(fixture.runtimeListeners).toEqual([])
    expect(fixture.tabMessages).toEqual([])

    release()
    fixture.fireActivated(7)
    fixture.fireVisibility(FixtureVisibility.Visible)
    expect(changes).toHaveLength(6)
    expect(fixture.activated).toHaveLength(0)
    expect(fixture.updated).toHaveLength(0)
  })

  test('an unknown window follows only the panel itself', () => {
    const changes: SidePanelChangeKind[] = []
    const release = new SidePanelRuntime().follow({
      window: { kind: SidePanelWindowKind.Unknown },
      onchange: (change) => changes.push(change),
      ontabactivated: () => {},
    })
    expect(fixture.activated).toHaveLength(0)
    fixture.fireVisibility(FixtureVisibility.Visible)
    expect(changes).toEqual([SidePanelChangeKind.PanelShown])
    release()
  })

  test('sends only its own requests to the service worker', async () => {
    const runtime = new SidePanelRuntime()
    await Effect.runPromise(runtime.openVault())
    fixture.reply = FixtureReplyKind.TabOpened
    const tabId = await Effect.runPromise(
      runtime.beginPairing({
        device: {
          deviceId: 'device-1',
          devicePublicKey: 'public-1',
          deviceSigningPublicKey: 'signing-1',
        },
        deviceLabel: 'Nook Extension',
        windowId: 7,
        connectId: 'connect-1',
      }),
    )
    expect(tabId).toBe(31)
    fixture.reply = FixtureReplyKind.Acknowledged
    await Effect.runPromise(runtime.lock())

    expect(fixture.sent).toEqual([
      { type: OpenSimpleVaultMessageType.NookOpenSimpleVault },
      // Connecting opens Nook's connect page directly, never the launcher.
      {
        type: BeginExtensionPairingMessageType.NookBeginExtensionPairing,
        payload: {
          deviceId: 'device-1',
          devicePublicKey: 'public-1',
          deviceSigningPublicKey: 'signing-1',
          deviceLabel: 'Nook Extension',
          // The panel names its own window and its connect; no choice
          // rides along.
          windowId: 7,
          connectId: 'connect-1',
        },
      },
      { type: ExtensionSessionMessageType.Lock },
    ])
    expect(fixture.runtimeListeners).toEqual([])
    expect(fixture.tabMessages).toEqual([])
  })

  test('begin-pairing fails visibly without the Nook tab id', async () => {
    const runtime = new SidePanelRuntime()
    const pairing = {
      device: {
        deviceId: 'device-1',
        devicePublicKey: 'public-1',
        deviceSigningPublicKey: 'signing-1',
      },
      deviceLabel: 'Nook Extension',
      windowId: 7,
      connectId: 'connect-1',
    }
    // An acknowledgement without a tab id leaves nothing to follow.
    const missing = await Effect.runPromise(
      Effect.result(runtime.beginPairing(pairing)),
    )
    expect(missing._tag).toBe('Failure')
  })

  test('brings the Nook tab to the front', async () => {
    const runtime = new SidePanelRuntime()
    await Effect.runPromise(runtime.focusTab(31))
    expect(fixture.focusedTabs).toEqual([31])
    expect(fixture.sent).toEqual([])
  })

  test('a refused or unanswered request fails visibly', async () => {
    const runtime = new SidePanelRuntime()
    fixture.reply = FixtureReplyKind.Refused
    const refused = await Effect.runPromise(Effect.result(runtime.lock()))
    expect(refused._tag).toBe('Failure')
    fixture.reply = FixtureReplyKind.Unanswered
    const unanswered = await Effect.runPromise(
      Effect.result(runtime.openVault()),
    )
    expect(unanswered._tag).toBe('Failure')
  })

  test('names its window only when the browser does', async () => {
    const runtime = new SidePanelRuntime()
    expect(await Effect.runPromise(runtime.currentWindow())).toEqual(
      panelWindow,
    )
    fixture.currentWindow = FixtureWindowKind.MissingId
    expect(await Effect.runPromise(runtime.currentWindow())).toEqual({
      kind: SidePanelWindowKind.Unknown,
    })
    fixture.currentWindow = FixtureWindowKind.Rejected
    expect(await Effect.runPromise(runtime.currentWindow())).toEqual({
      kind: SidePanelWindowKind.Unknown,
    })
  })
})

/** The sources the side panel bundle runs: its own page, the shared
 * ceremony and the clients it calls. */
class SidePanelSources {
  private static readonly SHARED = [
    '../src/popup/ExtensionDeviceProtection.svelte',
    '../src/popup/device-protection-ceremony.ts',
    '../src/popup/popup-app-state.ts',
    '../src/lib/side-panel-site.ts',
    '../src/lib/paired-vaults.ts',
    '../src/lib/i18n.ts',
    '../src/lib/extension-runtime-retry.ts',
    '../src/lib/nook-wasm.ts',
  ]

  /** The setup and unlock requests the panel's ceremony and startup make,
   * with the offscreen session types each one sends. */
  static readonly SESSION_CALLS: Readonly<
    Record<string, readonly ExtensionSessionMessageType[]>
  > = {
    extensionDeviceProtectionStatus: [ExtensionSessionMessageType.Status],
    extensionSessionDevice: [ExtensionSessionMessageType.Status],
    recoverExtensionPasskey: [ExtensionSessionMessageType.RecoverPasskey],
    // Asks the browser whether it offers passkey autofill; sends nothing.
    passkeyAutofillAvailable: [],
    createExtensionPasskey: [
      ExtensionSessionMessageType.BeginPasskeySetup,
      ExtensionSessionMessageType.FinishPasskeySetup,
    ],
    unlockExtensionPasskey: [
      ExtensionSessionMessageType.UnlockOptions,
      ExtensionSessionMessageType.UnlockPasskey,
    ],
    createExtensionPin: [ExtensionSessionMessageType.CreatePin],
    unlockExtensionPin: [ExtensionSessionMessageType.UnlockPin],
    // Use this identity: that identity then opens with its own unlock.
    activateIdentity: [ExtensionSessionMessageType.ActivateIdentity],
    // Connecting an identity: Rust picks the key, or stages one to drop.
    beginIdentityConnection: [
      ExtensionSessionMessageType.BeginIdentityConnection,
    ],
    cancelIdentityConnection: [
      ExtensionSessionMessageType.CancelIdentityConnection,
    ],
  }

  async panelSources(): Promise<readonly string[]> {
    const directory = join(import.meta.dir, '../src/side-panel')
    const names = await readdir(directory)
    return Promise.all(
      names.map((name) => readFile(join(directory, name), 'utf8')),
    )
  }

  async loadedSources(): Promise<readonly string[]> {
    const shared = await Promise.all(
      SidePanelSources.SHARED.map((file) =>
        readFile(join(import.meta.dir, file), 'utf8'),
      ),
    )
    return [...(await this.panelSources()), ...shared]
  }

  /** extensionWasmRuntime methods the panel and its ceremony call. */
  async wasmRuntimeCalls(): Promise<readonly string[]> {
    const sources = await this.panelSources()
    const ceremony = await readFile(
      join(import.meta.dir, '../src/popup/ExtensionDeviceProtection.svelte'),
      'utf8',
    )
    const calls = [...sources, ceremony].flatMap((source) =>
      [...source.matchAll(/extensionWasmRuntime\.(?<method>\w+)/g)].flatMap(
        (match) => Object.values({ ...match.groups }),
      ),
    )
    return [...new Set(calls)].sort()
  }
}

describe('side panel sources', () => {
  const sources = new SidePanelSources()

  test('the panel bundle never listens to broadcasts, messages tabs, injects, stores or logs', async () => {
    const loaded = await sources.loadedSources()
    expect(loaded.length).toBeGreaterThan(8)
    for (const source of loaded) {
      // Runtime broadcasts stay unheard; the only messages the panel takes
      // arrive on the connect page's admitted port.
      expect(source).not.toMatch(/\bruntime\.onMessage\b/)
      expect(source).not.toContain('tabs.sendMessage')
      expect(source).not.toContain('chrome.scripting')
      expect(source).not.toContain('chrome.storage')
      expect(source).not.toMatch(/\bconsole\./)
      expect(source).not.toContain('window.close')
    }
  })

  test('the ceremony sends only the setup and unlock requests extension pages may send', async () => {
    expect(await sources.wasmRuntimeCalls()).toEqual(
      Object.keys(SidePanelSources.SESSION_CALLS).sort(),
    )
    // The offscreen session admits each of them from the side panel page.
    const panelSender: chrome.runtime.MessageSender = {
      id: 'nook-extension',
      url: 'chrome-extension://nook-extension/side-panel/index.html',
    }
    const policy = new ExtensionSessionSenderPolicy(panelSender)
    const types = Object.values(SidePanelSources.SESSION_CALLS).flat()
    for (const type of types) {
      expect(policy.admission(type)).toBe(
        ExtensionSessionSenderAdmission.Admitted,
      )
    }
    // Requests that list, reveal or write vault items stay refused.
    for (const type of [
      ExtensionSessionMessageType.RevealLogin,
      ExtensionSessionMessageType.ListAuthenticators,
      ExtensionSessionMessageType.ListSiteSecrets,
      ExtensionSessionMessageType.PlanLoginSave,
    ]) {
      expect(policy.admission(type)).toBe(
        ExtensionSessionSenderAdmission.Forbidden,
      )
    }
  })

  test('the service worker sets the toolbar side panel behavior at startup', async () => {
    // service-worker.ts runs the whole worker when imported, so its startup
    // wiring is checked from source; ToolbarSidePanelBehavior is tested above.
    const worker = await readFile(
      join(import.meta.dir, '../src/background/service-worker.ts'),
      'utf8',
    )
    expect(worker).toContain('sidePanel: chrome.sidePanel,')
    expect(worker).toMatch(
      /^void Effect\.runPromise\(\s*new ToolbarSidePanelBehavior\(toolbarSidePanelRequest\)\.apply\(\),\s*\)$/m,
    )
  })
})
