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
  SidePanelConnectAdmissionKind,
  SidePanelConnectAdmissionRule,
  SidePanelConnectEventKind,
  SidePanelConnectHoldKind,
  SidePanelConnectPendingKind,
  SidePanelConnectSenderKind,
  SidePanelConnectSenderTrust,
  SidePanelConnectSessions,
  SidePanelConnectTabKind,
  type SidePanelConnectAdmissionRequest,
  type SidePanelConnectEvent,
} from '../src/side-panel/side-panel-connect-port'
import {
  SidePanelConnectFailure,
  SidePanelConnectFollowUp,
  SidePanelConnectKind,
  SidePanelConnectStep,
  SidePanelConnects,
  SidePanelTabFollowKind,
  type SidePanelConnect,
} from '../src/side-panel/side-panel-connect-state'
import { SidePanelVaultsKind } from '../src/side-panel/side-panel-state'
import { browserTab } from './companion-launcher-test-support'

const NOOK_URL = 'https://simple.nokey.sh/extension-connect?nonce=n-1'
const PANEL_WINDOW = 7
const CONNECT_TAB = 31

type PortMessageListener = Parameters<
  chrome.runtime.Port['onMessage']['addListener']
>[0]
type PortDisconnectListener = Parameters<
  chrome.runtime.Port['onDisconnect']['addListener']
>[0]
type ConnectListener = (port: chrome.runtime.Port) => void
type RemovedListener = (tabId: number) => void

type PortOrigin = {
  readonly url: string
  readonly windowId: number
  readonly tabId: number
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
      tab,
      frameId: 0,
    }
    this.chromePort = {
      name: '',
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
class FixtureSenderPolicy {
  checked = 0
  admits(sender: chrome.runtime.MessageSender): Promise<boolean> {
    this.checked += 1
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
    url: NOOK_URL,
    windowId: PANEL_WINDOW,
    tabId: CONNECT_TAB,
    ...origin,
  })
}

const consent: ExtensionConnectStep = {
  kind: ExtensionConnectStepKind.Consent,
}

describe('side panel connect admission rule', () => {
  const admissible: SidePanelConnectAdmissionRequest = {
    trust: SidePanelConnectSenderTrust.Trusted,
    pending: SidePanelConnectPendingKind.Pending,
    hold: SidePanelConnectHoldKind.Free,
    windowId: PANEL_WINDOW,
    tab: { kind: SidePanelConnectTabKind.Known, tabId: CONNECT_TAB },
    sender: {
      kind: SidePanelConnectSenderKind.Present,
      sender: {
        url: NOOK_URL,
        tab: { ...browserTab(NOOK_URL, CONNECT_TAB), windowId: PANEL_WINDOW },
      },
    },
  }

  test('admits the trusted connect tab of the panel window', () => {
    expect(SidePanelConnectAdmissionRule.admission(admissible).kind).toBe(
      SidePanelConnectAdmissionKind.Admitted,
    )
    // Before the service worker named the tab, any tab of the window is it.
    expect(
      SidePanelConnectAdmissionRule.admission({
        ...admissible,
        tab: { kind: SidePanelConnectTabKind.Pending },
      }).kind,
    ).toBe(SidePanelConnectAdmissionKind.Admitted)
  })

  test('rejects an untrusted origin, no pending connect, a second port, another window, another tab or no tab', () => {
    const rejected: SidePanelConnectAdmissionRequest[] = [
      { ...admissible, trust: SidePanelConnectSenderTrust.Untrusted },
      { ...admissible, pending: SidePanelConnectPendingKind.None },
      { ...admissible, hold: SidePanelConnectHoldKind.Held },
      { ...admissible, windowId: PANEL_WINDOW + 1 },
      {
        ...admissible,
        tab: { kind: SidePanelConnectTabKind.Known, tabId: CONNECT_TAB + 1 },
      },
      {
        ...admissible,
        sender: {
          kind: SidePanelConnectSenderKind.Present,
          sender: { url: NOOK_URL },
        },
      },
      { ...admissible, sender: { kind: SidePanelConnectSenderKind.Absent } },
    ]
    for (const request of rejected) {
      expect(SidePanelConnectAdmissionRule.admission(request).kind).toBe(
        SidePanelConnectAdmissionKind.Rejected,
      )
    }
  })
})

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

  test('disconnects ports from an untrusted origin, another window, another tab, or a second page', async () => {
    const scenario = new SessionScenario()
    scenario.open()
    scenario.sessions.tabOpened(CONNECT_TAB)
    const untrusted = nookPage({ url: 'https://simple.nokey.sh.example.com/x' })
    const foreignWindow = nookPage({ windowId: PANEL_WINDOW + 1 })
    const otherTab = nookPage({ tabId: CONNECT_TAB + 1 })
    for (const page of [untrusted, foreignWindow, otherTab]) {
      browser.connect(page)
      page.send(consent)
    }
    await SessionScenario.settle()
    expect(untrusted.disconnected).toBe(true)
    expect(foreignWindow.disconnected).toBe(true)
    expect(otherTab.disconnected).toBe(true)
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

  test('a port admitted before the tab id arrives is dropped when the id names another tab', async () => {
    const scenario = new SessionScenario()
    scenario.open()
    const early = nookPage({ tabId: CONNECT_TAB + 5 })
    browser.connect(early)
    early.send(consent)
    await SessionScenario.settle()
    expect(early.disconnected).toBe(false)
    scenario.sessions.tabOpened(CONNECT_TAB)
    expect(early.disconnected).toBe(true)
    // The real connect tab is admitted next, and only its steps count.
    const page = nookPage()
    browser.connect(page)
    page.send(consent)
    await SessionScenario.settle()
    expect(page.disconnected).toBe(false)
    expect(scenario.events).toEqual([
      { kind: SidePanelConnectEventKind.Step, step: consent },
      { kind: SidePanelConnectEventKind.Step, step: consent },
    ])
  })

  test('an undecodable message disconnects the page and reports a protocol failure', async () => {
    const scenario = new SessionScenario()
    scenario.open()
    scenario.sessions.tabOpened(CONNECT_TAB)
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
