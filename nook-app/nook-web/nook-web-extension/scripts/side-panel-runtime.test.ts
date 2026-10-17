import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Effect } from 'effect'
import {
  OpenCompanionLauncherIntent,
  OpenCompanionLauncherMessageType,
} from '../../nook-web-shared/src/extension/companion-launcher-message'
import { OpenSimpleVaultMessageType } from '../../nook-web-shared/src/extension/lifecycle-runtime-messages'
import type { BrowserRuntimeMessageValue } from '../src/lib/browser-runtime-message'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import {
  SidePanelChangeKind,
  SidePanelNookTabIntent,
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
  Refused = 'refused',
  /** No listener answered: Chrome sets lastError. */
  Unanswered = 'unanswered',
}

enum FixtureWindowKind {
  Identified = 'identified',
  MissingId = 'missing-id',
  Rejected = 'rejected',
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
    visibilityState: 'visible',
  })
  readonly window = new EventTarget()
  reply = FixtureReplyKind.Acknowledged
  currentWindow = FixtureWindowKind.Identified

  private readonly runtime = {
    onMessage: {
      addListener: () => this.runtimeListeners.push('onMessage'),
    },
    sendMessage: (message: SentMessage, callback: ReplyCallback) => {
      this.sent.push(message)
      this.answer(callback)
    },
  }

  private readonly tabs = {
    sendMessage: () => this.tabMessages.push('sendMessage'),
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
    const index = request.list.indexOf(request.listener)
    request.list.splice(index, 1)
  }

  private answer(callback: ReplyCallback): void {
    switch (this.reply) {
      case FixtureReplyKind.Acknowledged:
        callback({ ok: true })
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

  fireVisibility(state: 'visible' | 'hidden'): void {
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
    const release = new SidePanelRuntime().follow({
      window: panelWindow,
      onchange: (change) => changes.push(change),
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
    fixture.fireVisibility('hidden')
    fixture.fireVisibility('visible')
    fixture.window.dispatchEvent(new Event('focus'))

    expect(changes).toEqual([
      SidePanelChangeKind.TabActivated,
      SidePanelChangeKind.TabNavigated,
      SidePanelChangeKind.TabNavigated,
      SidePanelChangeKind.PanelHidden,
      SidePanelChangeKind.PanelShown,
      SidePanelChangeKind.PanelFocused,
    ])
    expect(fixture.runtimeListeners).toEqual([])
    expect(fixture.tabMessages).toEqual([])

    release()
    fixture.fireActivated(7)
    fixture.fireVisibility('visible')
    expect(changes).toHaveLength(6)
    expect(fixture.activated).toHaveLength(0)
    expect(fixture.updated).toHaveLength(0)
  })

  test('an unknown window follows only the panel itself', () => {
    const changes: SidePanelChangeKind[] = []
    const release = new SidePanelRuntime().follow({
      window: { kind: SidePanelWindowKind.Unknown },
      onchange: (change) => changes.push(change),
    })
    expect(fixture.activated).toHaveLength(0)
    fixture.fireVisibility('visible')
    expect(changes).toEqual([SidePanelChangeKind.PanelShown])
    release()
  })

  test('sends only its own requests to the service worker', async () => {
    const runtime = new SidePanelRuntime()
    await Effect.runPromise(runtime.openVault())
    await Effect.runPromise(runtime.openNookTab(SidePanelNookTabIntent.Pair))
    await Effect.runPromise(runtime.openNookTab(SidePanelNookTabIntent.Manage))
    await Effect.runPromise(runtime.lock())

    expect(fixture.sent).toEqual([
      { type: OpenSimpleVaultMessageType.NookOpenSimpleVault },
      {
        type: OpenCompanionLauncherMessageType.NookOpenCompanionLauncher,
        payload: { intent: OpenCompanionLauncherIntent.Pair },
      },
      { type: OpenCompanionLauncherMessageType.NookOpenCompanionLauncher },
      { type: ExtensionSessionMessageType.Lock },
    ])
    expect(fixture.runtimeListeners).toEqual([])
    expect(fixture.tabMessages).toEqual([])
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

describe('side panel sources', () => {
  test('never listen to runtime broadcasts, message tabs or inject scripts', async () => {
    const directory = join(import.meta.dir, '../src/side-panel')
    const names = await readdir(directory)
    const sources = await Promise.all(
      names.map((name) => readFile(join(directory, name), 'utf8')),
    )
    expect(names.length).toBeGreaterThan(0)
    for (const source of sources) {
      expect(source).not.toMatch(/\bonMessage\b/)
      expect(source).not.toContain('tabs.sendMessage')
      expect(source).not.toContain('chrome.scripting')
      expect(source).not.toContain('window.close')
    }
  })
})
