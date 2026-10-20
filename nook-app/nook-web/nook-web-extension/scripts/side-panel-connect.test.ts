import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  ExtensionConnectFailureReason,
  ExtensionConnectStepKind,
  type ExtensionConnectStep,
} from '../../nook-web-shared/src/extension/extension-connect-progress'
import { I18N_KEYS } from '../../nook-web-shared/src/generated/i18n-keys'
import { DeviceProtectionStatus } from '../src/lib/nook-wasm'
import type { BrowserRuntimeMessageValue } from '../src/lib/browser-runtime-message'
import {
  SidePanelConnectEventKind,
  SidePanelConnectSessions,
  type SidePanelConnectEvent,
} from '../src/side-panel/side-panel-connect-port'
import {
  SidePanelConnectFailure,
  SidePanelConnectFollowUp,
  SidePanelConnectKind,
  SidePanelConnectStep,
  SidePanelConnects,
  SidePanelTabFollowKind,
  SidePanelTabPlace,
  type SidePanelConnect,
} from '../src/side-panel/side-panel-connect-state'
import { SidePanelVaultsKind } from '../src/side-panel/side-panel-state'
import { browserTab } from './companion-launcher-test-support'

const NOOK_URL = 'https://simple.nokey.sh/extension-connect?nonce=n-1'
const PANEL_WINDOW = 7
const CONNECT_TAB = 31
const CONNECT_ID = 'connect-1'

type PortMessageListener = Parameters<
  chrome.runtime.Port['onMessage']['addListener']
>[0]
type PortDisconnectListener = Parameters<
  chrome.runtime.Port['onDisconnect']['addListener']
>[0]
type ConnectListener = (port: chrome.runtime.Port) => void
type RemovedListener = (tabId: number) => void

enum PortTab {
  /** The page runs in a tab, as the connect page does. */
  InTab = 'in-tab',
  /** Chrome named no tab for the sender. */
  None = 'none',
}

type PortOrigin = {
  /** The port's name: the page's connect id. */
  readonly name: string
  readonly url: string
  readonly windowId: number
  readonly tabId: number
  readonly tab: PortTab
}

/** A Chrome event the test fires itself. */
class FixtureEvent<
  Listener extends PortMessageListener | PortDisconnectListener,
> implements chrome.events.Event<Listener> {
  readonly listeners: Listener[] = []
  addListener(listener: Listener): void {
    this.listeners.push(listener)
  }
  removeListener(listener: Listener): void {
    this.listeners.splice(this.listeners.indexOf(listener), 1)
  }
  hasListener(listener: Listener): boolean {
    return this.listeners.includes(listener)
  }
  hasListeners(): boolean {
    return this.listeners.length > 0
  }
  getRules(): void {}
  addRules(): void {}
  removeRules(): void {}
}

/** One page port as Chrome hands it to the panel. */
class FakePagePort {
  private readonly messages = new FixtureEvent<PortMessageListener>()
  private readonly disconnects = new FixtureEvent<PortDisconnectListener>()
  private readonly chromePort: chrome.runtime.Port
  disconnected = false

  constructor(readonly origin: PortOrigin) {
    const tab: chrome.tabs.Tab = {
      ...browserTab(origin.url, origin.tabId),
      windowId: origin.windowId,
    }
    const sender: chrome.runtime.MessageSender = {
      url: origin.url,
      origin: new URL(origin.url).origin,
      frameId: 0,
    }
    switch (origin.tab) {
      case PortTab.InTab:
        sender.tab = tab
        break
      case PortTab.None:
        break
    }
    this.chromePort = {
      name: origin.name,
      sender,
      postMessage: () => {},
      disconnect: () => {
        this.disconnected = true
      },
      onMessage: this.messages,
      onDisconnect: this.disconnects,
    }
  }

  port(): chrome.runtime.Port {
    return this.chromePort
  }

  send(message: BrowserRuntimeMessageValue): void {
    for (const listener of this.messages.listeners)
      listener(message, this.chromePort)
  }

  /** The page's tab closed, reloaded or navigated away. */
  close(): void {
    for (const listener of this.disconnects.listeners) listener(this.chromePort)
  }
}

/** The runtime events the panel's connect session listens to. */
class ConnectBrowserFixture {
  readonly connects: ConnectListener[] = []
  readonly removals: RemovedListener[] = []

  install(): void {
    const remove =
      <Listener>(list: Listener[]) =>
      (listener: Listener) => {
        const index = list.indexOf(listener)
        switch (index) {
          case -1:
            return
          default:
            list.splice(index, 1)
        }
      }
    const chromeStub = {
      runtime: {
        id: 'nook-extension',
        onConnectExternal: {
          addListener: (listener: ConnectListener) =>
            this.connects.push(listener),
          removeListener: remove(this.connects),
        },
      },
      tabs: {
        onRemoved: {
          addListener: (listener: RemovedListener) =>
            this.removals.push(listener),
          removeListener: remove(this.removals),
        },
      },
    }
    Object.assign(globalThis, { chrome: chromeStub })
  }

  connect(page: FakePagePort): void {
    const port = page.port()
    for (const listener of [...this.connects]) listener(port)
  }

  removeTab(tabId: number): void {
    for (const listener of [...this.removals]) listener(tabId)
  }
}

/** Trusts only the Simple Vault origin, as ExternalSenderTrustPolicy does. */
enum FixturePolicyAnswer {
  Answers = 'answers',
  /** Evaluating the policy fails, as when the companion WASM cannot load. */
  Throws = 'throws',
}

class FixtureSenderPolicy {
  answer = FixturePolicyAnswer.Answers
  asked = 0
  admits(sender: chrome.runtime.MessageSender): Promise<boolean> {
    this.asked += 1
    switch (this.answer) {
      case FixturePolicyAnswer.Throws:
        return Promise.reject(new Error('companion WASM failed to load'))
      case FixturePolicyAnswer.Answers:
        break
    }
    return Promise.resolve(
      typeof sender.url === 'string' &&
        sender.url.startsWith('https://simple.nokey.sh/'),
    )
  }
}

class SessionScenario {
  readonly events: SidePanelConnectEvent[] = []
  readonly policy = new FixtureSenderPolicy()
  readonly sessions = new SidePanelConnectSessions(this.policy)

  open(): void {
    this.sessions.open({
      connectId: CONNECT_ID,
      windowId: PANEL_WINDOW,
      onevent: (event) => this.events.push(event),
    })
  }

  static async settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

const savedChrome = globalThis.chrome
let browser = new ConnectBrowserFixture()

beforeEach(() => {
  browser = new ConnectBrowserFixture()
  browser.install()
})

afterEach(() => {
  Object.assign(globalThis, { chrome: savedChrome })
})

function nookPage(origin: Partial<PortOrigin> = {}): FakePagePort {
  return new FakePagePort({
    name: CONNECT_ID,
    url: NOOK_URL,
    windowId: PANEL_WINDOW,
    tabId: CONNECT_TAB,
    tab: PortTab.InTab,
    ...origin,
  })
}

const consent: ExtensionConnectStep = {
  kind: ExtensionConnectStepKind.Consent,
}

describe('side panel connect session', () => {
  test('listens only while a connect is pending', () => {
    const scenario = new SessionScenario()
    expect(browser.connects).toHaveLength(0)
    scenario.open()
    expect(browser.connects).toHaveLength(1)
    expect(browser.removals).toHaveLength(1)
    scenario.sessions.end()
    expect(browser.connects).toHaveLength(0)
    expect(browser.removals).toHaveLength(0)
  })

  test('reports the admitted page steps, including one sent while its sender was checked', async () => {
    const scenario = new SessionScenario()
    scenario.open()
    scenario.sessions.tabOpened(CONNECT_TAB)
    const page = nookPage()
    browser.connect(page)
    page.send({ kind: ExtensionConnectStepKind.Opened })
    await SessionScenario.settle()
    page.send(consent)
    expect(page.disconnected).toBe(false)
    expect(scenario.events).toEqual([
      {
        kind: SidePanelConnectEventKind.Step,
        step: { kind: ExtensionConnectStepKind.Opened },
      },
      { kind: SidePanelConnectEventKind.Step, step: consent },
    ])
  })

  test('a page that connects before the tab id is admitted by its name, and its latest step applies again once the id arrives', async () => {
    const scenario = new SessionScenario()
    scenario.open()
    const page = nookPage()
    browser.connect(page)
    page.send({ kind: ExtensionConnectStepKind.Opened })
    page.send(consent)
    await SessionScenario.settle()
    expect(page.disconnected).toBe(false)
    scenario.sessions.tabOpened(CONNECT_TAB)
    // The connect state ignores steps until it knows the tab, so the
    // latest one is reported again when the id arrives.
    expect(scenario.events).toEqual([
      { kind: SidePanelConnectEventKind.Step, step: consent },
      { kind: SidePanelConnectEventKind.Step, step: consent },
    ])
  })

  test('disconnects another connect, an untrusted origin, another window, no tab, or a second page', async () => {
    const scenario = new SessionScenario()
    scenario.open()
    const otherConnect = nookPage({ name: 'connect-2' })
    browser.connect(otherConnect)
    // Another connect's port is dropped at once, without asking the policy.
    expect(otherConnect.disconnected).toBe(true)
    expect(scenario.policy.asked).toBe(0)
    const untrusted = nookPage({ url: 'https://simple.nokey.sh.example.com/x' })
    const foreignWindow = nookPage({ windowId: PANEL_WINDOW + 1 })
    const noTab = nookPage({ tab: PortTab.None })
    for (const page of [untrusted, foreignWindow, noTab]) {
      browser.connect(page)
      page.send(consent)
    }
    await SessionScenario.settle()
    expect(untrusted.disconnected).toBe(true)
    expect(foreignWindow.disconnected).toBe(true)
    expect(noTab.disconnected).toBe(true)
    const first = nookPage()
    const second = nookPage()
    browser.connect(first)
    await SessionScenario.settle()
    browser.connect(second)
    await SessionScenario.settle()
    expect(first.disconnected).toBe(false)
    expect(second.disconnected).toBe(true)
    expect(scenario.events).toEqual([])
  })

  test('a port that closes while its sender is checked is not admitted, and the reloaded page is', async () => {
    const scenario = new SessionScenario()
    scenario.open()
    scenario.sessions.tabOpened(CONNECT_TAB)
    const closing = nookPage()
    browser.connect(closing)
    closing.close()
    await SessionScenario.settle()
    expect(scenario.events).toEqual([])
    const page = nookPage()
    browser.connect(page)
    page.send(consent)
    await SessionScenario.settle()
    expect(scenario.events).toEqual([
      { kind: SidePanelConnectEventKind.Step, step: consent },
    ])
  })

  test('a sender policy that cannot answer ends the connect visibly', async () => {
    const scenario = new SessionScenario()
    scenario.open()
    scenario.policy.answer = FixturePolicyAnswer.Throws
    const page = nookPage()
    browser.connect(page)
    await SessionScenario.settle()
    expect(page.disconnected).toBe(true)
    expect(scenario.events).toEqual([
      { kind: SidePanelConnectEventKind.SenderCheckFailure },
    ])
    expect(browser.connects).toHaveLength(0)
  })

  test('an undecodable message disconnects the page and reports a protocol failure', async () => {
    const scenario = new SessionScenario()
    scenario.open()
    const page = nookPage()
    browser.connect(page)
    await SessionScenario.settle()
    page.send({ kind: 'teleported' })
    expect(page.disconnected).toBe(true)
    expect(scenario.events).toEqual([
      { kind: SidePanelConnectEventKind.ProtocolFailure },
    ])
    // The session stopped listening: nothing reconnects.
    expect(browser.connects).toHaveLength(0)
  })

  test('the page closing, or its tab going away, ends the connect without reconnecting', async () => {
    const closing = new SessionScenario()
    closing.open()
    closing.sessions.tabOpened(CONNECT_TAB)
    const page = nookPage()
    browser.connect(page)
    await SessionScenario.settle()
    page.close()
    expect(closing.events).toEqual([{ kind: SidePanelConnectEventKind.Closed }])
    expect(browser.connects).toHaveLength(0)

    // The tab closes before its page connected.
    const removed = new SessionScenario()
    removed.open()
    removed.sessions.tabOpened(CONNECT_TAB)
    browser.removeTab(CONNECT_TAB + 1)
    expect(removed.events).toEqual([])
    browser.removeTab(CONNECT_TAB)
    expect(removed.events).toEqual([{ kind: SidePanelConnectEventKind.Closed }])
    expect(browser.removals).toHaveLength(0)
  })
})

describe('side panel connect state', () => {
  const inTab = SidePanelConnects.inTab(CONNECT_TAB)
  const step = (next: ExtensionConnectStep): SidePanelConnectEvent => ({
    kind: SidePanelConnectEventKind.Step,
    step: next,
  })

  test('the unlocked key pairs at once; a staged identity sets up its key first', () => {
    expect(SidePanelConnects.step('current-key')).toBe(
      SidePanelConnectStep.Pair,
    )
    expect(SidePanelConnects.step('new-key-staged')).toBe(
      SidePanelConnectStep.SetUpKey,
    )
    expect(SidePanelConnects.identityKey()).toEqual({
      kind: SidePanelConnectKind.IdentityKey,
      status: DeviceProtectionStatus.Missing,
    })
  })

  test('follows the page steps and re-reads the vaults once approved', () => {
    expect(inTab).toEqual({
      kind: SidePanelConnectKind.InTab,
      tabId: CONNECT_TAB,
      follow: { kind: SidePanelTabFollowKind.Waiting },
      place: SidePanelTabPlace.Front,
    })
    const unlocking = SidePanelConnects.advance({
      connect: inTab,
      event: step({ kind: ExtensionConnectStepKind.Unlock }),
    })
    expect(unlocking).toEqual({
      connect: {
        kind: SidePanelConnectKind.InTab,
        tabId: CONNECT_TAB,
        follow: {
          kind: SidePanelTabFollowKind.Following,
          step: { kind: ExtensionConnectStepKind.Unlock },
        },
        place: SidePanelTabPlace.Front,
      },
      followUp: SidePanelConnectFollowUp.None,
    })
    const approved = SidePanelConnects.advance({
      connect: unlocking.connect,
      event: step({ kind: ExtensionConnectStepKind.Approved }),
    })
    expect(approved).toEqual({
      connect: { kind: SidePanelConnectKind.Idle },
      followUp: SidePanelConnectFollowUp.ReadVaults,
    })
  })

  test('the Nook tab starts in front, goes behind another tab, and returns', () => {
    const behind = SidePanelConnects.tabActivated(inTab, CONNECT_TAB + 1)
    expect(behind).toEqual({ ...inTab, place: SidePanelTabPlace.Behind })
    // A step keeps where the tab is.
    const consent = SidePanelConnects.advance({
      connect: behind,
      event: step({ kind: ExtensionConnectStepKind.Consent }),
    }).connect
    expect(consent).toMatchObject({ place: SidePanelTabPlace.Behind })
    expect(SidePanelConnects.tabActivated(consent, CONNECT_TAB)).toMatchObject(
      { place: SidePanelTabPlace.Front },
    )
    const idle: SidePanelConnect = { kind: SidePanelConnectKind.Idle }
    expect(SidePanelConnects.tabActivated(idle, CONNECT_TAB + 1)).toBe(idle)
  })

  test('a closed tab before approval brings the card back; a protocol failure says so', () => {
    expect(
      SidePanelConnects.advance({
        connect: inTab,
        event: { kind: SidePanelConnectEventKind.Closed },
      }),
    ).toEqual({
      connect: { kind: SidePanelConnectKind.Idle },
      followUp: SidePanelConnectFollowUp.None,
    })
    const failed = SidePanelConnects.advance({
      connect: inTab,
      event: { kind: SidePanelConnectEventKind.ProtocolFailure },
    })
    expect(failed.connect).toEqual({
      kind: SidePanelConnectKind.Failed,
      failure: SidePanelConnectFailure.Protocol,
    })
    expect(
      SidePanelConnects.failureAlert(SidePanelConnectFailure.Protocol),
    ).toBe(I18N_KEYS.ExtensionConnectTabInterrupted)
    const unchecked = SidePanelConnects.advance({
      connect: inTab,
      event: { kind: SidePanelConnectEventKind.SenderCheckFailure },
    })
    expect(unchecked.connect).toEqual({
      kind: SidePanelConnectKind.Failed,
      failure: SidePanelConnectFailure.SenderCheck,
    })
    expect(
      SidePanelConnects.failureAlert(SidePanelConnectFailure.SenderCheck),
    ).toBe(I18N_KEYS.ExtensionConnectTabSenderCheckFailed)
  })

  test('steps before the tab id arrives, or with no connect, change nothing', () => {
    const starting: SidePanelConnect = { kind: SidePanelConnectKind.Starting }
    const idle: SidePanelConnect = { kind: SidePanelConnectKind.Idle }
    for (const connect of [starting, idle]) {
      expect(
        SidePanelConnects.advance({ connect, event: step(consent) }),
      ).toEqual({ connect, followUp: SidePanelConnectFollowUp.None })
    }
    expect(
      SidePanelConnects.advance({
        connect: idle,
        event: { kind: SidePanelConnectEventKind.Closed },
      }).connect,
    ).toBe(idle)
  })

  test('each step has its own line, and waiting keeps the hand-off line', () => {
    expect(
      SidePanelConnects.followLine({ kind: SidePanelTabFollowKind.Waiting }),
    ).toBe(I18N_KEYS.ExtensionActionContinueInTab)
    const lines = [
      [ExtensionConnectStepKind.Opened, I18N_KEYS.ExtensionConnectTabOpened],
      [ExtensionConnectStepKind.Unlock, I18N_KEYS.ExtensionConnectTabUnlock],
      [
        ExtensionConnectStepKind.Choosing,
        I18N_KEYS.ExtensionConnectTabChoosing,
      ],
      [
        ExtensionConnectStepKind.Creating,
        I18N_KEYS.ExtensionConnectTabCreating,
      ],
      [ExtensionConnectStepKind.Consent, I18N_KEYS.ExtensionConnectTabConsent],
      [
        ExtensionConnectStepKind.Approved,
        I18N_KEYS.ExtensionConnectTabApproved,
      ],
    ] as const
    for (const [kind, key] of lines) {
      expect(
        SidePanelConnects.followLine({
          kind: SidePanelTabFollowKind.Following,
          step: { kind },
        }),
      ).toBe(key)
    }
    expect(
      SidePanelConnects.followLine({
        kind: SidePanelTabFollowKind.Following,
        step: {
          kind: ExtensionConnectStepKind.Failed,
          reason: ExtensionConnectFailureReason.Delivery,
        },
      }),
    ).toBe(I18N_KEYS.ExtensionConnectTabFailedDelivery)
  })

  test('the card leads with no identity and shows under This site while a connect runs', () => {
    const idle: SidePanelConnect = { kind: SidePanelConnectKind.Idle }
    expect(
      SidePanelConnects.cardShown({
        vaults: SidePanelVaultsKind.NoVault,
        connect: idle,
      }),
    ).toBe(true)
    expect(
      SidePanelConnects.cardShown({
        vaults: SidePanelVaultsKind.Paired,
        connect: idle,
      }),
    ).toBe(false)
    expect(
      SidePanelConnects.cardShown({
        vaults: SidePanelVaultsKind.Paired,
        connect: inTab,
      }),
    ).toBe(true)
  })
})
