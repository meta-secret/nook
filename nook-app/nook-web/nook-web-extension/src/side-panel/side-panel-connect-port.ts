import { Effect } from 'effect'
import {
  ExtensionConnectSteps,
  type ExtensionConnectStep,
} from '../../../nook-web-shared/src/extension/extension-connect-progress'
import type { BrowserRuntimeMessageValue } from '../lib/browser-runtime-message'

/**
 * The side panel's live link to the Nook tab it opened for a connect. Chrome
 * hands an external `runtime.connect` to every listening extension document,
 * so the panel of each window sees each page's port. While a connect is
 * pending, the panel listens for those ports and admits one only when:
 *
 * - the trusted Simple Vault origin rule (ExternalSenderTrustPolicy) admits
 *   its sender;
 * - the sender's tab is in this panel's window;
 * - once the service worker named the connect tab, the sender is that tab;
 * - no other port is admitted already.
 *
 * Every other port is disconnected at once. Steps carry no authority: the
 * grant import keeps its own validation. An undecodable message ends the
 * link as a protocol failure, and a closed port ends it too; nothing
 * reconnects.
 */

/** The Simple Vault origin rule the service worker applies to external
 * messages, reused for ports. */
export interface SidePanelConnectSenderPolicy {
  admits(sender: chrome.runtime.MessageSender): Promise<boolean>
}

export enum SidePanelConnectEventKind {
  /** The admitted page reported its current step. */
  Step = 'step',
  /** The admitted page's port closed, or the connect tab closed: the tab
   * closed, reloaded or navigated away. */
  Closed = 'closed',
  /** The admitted page sent a message the protocol does not know. */
  ProtocolFailure = 'protocol-failure',
}

export type SidePanelConnectEvent =
  | {
      readonly kind: SidePanelConnectEventKind.Step
      readonly step: ExtensionConnectStep
    }
  | { readonly kind: SidePanelConnectEventKind.Closed }
  | { readonly kind: SidePanelConnectEventKind.ProtocolFailure }

export type SidePanelConnectListener = (event: SidePanelConnectEvent) => void

export type SidePanelConnectSessionRequest = {
  /** The window this panel is docked in. */
  readonly windowId: number
  readonly senderPolicy: SidePanelConnectSenderPolicy
  readonly onevent: SidePanelConnectListener
}

export enum SidePanelConnectTabKind {
  /** The service worker has not named the connect tab yet. */
  Pending = 'pending',
  Known = 'known',
}

export type SidePanelConnectTab =
  | { readonly kind: SidePanelConnectTabKind.Pending }
  | { readonly kind: SidePanelConnectTabKind.Known; readonly tabId: number }

export enum SidePanelConnectSenderTrust {
  Trusted = 'trusted',
  Untrusted = 'untrusted',
}

/** Whether the panel still waits for its connect page. */
export enum SidePanelConnectPendingKind {
  Pending = 'pending',
  None = 'none',
}

/** Whether a port is admitted already. */
export enum SidePanelConnectHoldKind {
  Free = 'free',
  Held = 'held',
}

export enum SidePanelConnectAdmissionKind {
  Admitted = 'admitted',
  Rejected = 'rejected',
}

/** An admitted port names the tab it came from. */
export type SidePanelConnectAdmission =
  | {
      readonly kind: SidePanelConnectAdmissionKind.Admitted
      readonly tab: chrome.tabs.Tab
    }
  | { readonly kind: SidePanelConnectAdmissionKind.Rejected }

/** What Chrome said about who opened a port. */
export enum SidePanelConnectSenderKind {
  Present = 'present',
  Absent = 'absent',
}

export type SidePanelConnectSender =
  | {
      readonly kind: SidePanelConnectSenderKind.Present
      readonly sender: chrome.runtime.MessageSender
    }
  | { readonly kind: SidePanelConnectSenderKind.Absent }

export type SidePanelConnectAdmissionRequest = {
  readonly trust: SidePanelConnectSenderTrust
  readonly pending: SidePanelConnectPendingKind
  readonly hold: SidePanelConnectHoldKind
  readonly windowId: number
  readonly tab: SidePanelConnectTab
  readonly sender: SidePanelConnectSender
}

type SidePanelConnectTabAdmissionRequest = {
  readonly windowId: number
  readonly tab: SidePanelConnectTab
  readonly sender: chrome.runtime.MessageSender
}

enum SidePanelConnectTabMatch {
  Same = 'same',
  Other = 'other',
}

type SidePanelConnectTabMatchRequest = {
  readonly tab: SidePanelConnectTab
  readonly sender: chrome.tabs.Tab
}

/** The window-scoped admission rule for a page's port. */
export class SidePanelConnectAdmissionRule {
  private constructor() {}

  private static readonly REJECTED: SidePanelConnectAdmission = {
    kind: SidePanelConnectAdmissionKind.Rejected,
  }

  static admission(
    request: SidePanelConnectAdmissionRequest,
  ): SidePanelConnectAdmission {
    const { trust, pending, hold, sender } = request
    switch (trust) {
      case SidePanelConnectSenderTrust.Untrusted:
        return SidePanelConnectAdmissionRule.REJECTED
      case SidePanelConnectSenderTrust.Trusted:
        break
    }
    switch (pending) {
      case SidePanelConnectPendingKind.None:
        return SidePanelConnectAdmissionRule.REJECTED
      case SidePanelConnectPendingKind.Pending:
        break
    }
    switch (hold) {
      case SidePanelConnectHoldKind.Held:
        return SidePanelConnectAdmissionRule.REJECTED
      case SidePanelConnectHoldKind.Free:
        break
    }
    switch (sender.kind) {
      case SidePanelConnectSenderKind.Absent:
        return SidePanelConnectAdmissionRule.REJECTED
      case SidePanelConnectSenderKind.Present:
        break
    }
    const fromTab: SidePanelConnectTabAdmissionRequest = {
      windowId: request.windowId,
      tab: request.tab,
      sender: sender.sender,
    }
    return SidePanelConnectAdmissionRule.fromTab(fromTab)
  }

  /** A port from no tab, from another window, or from another tab than
   * the connect tab is rejected. */
  private static fromTab(
    request: SidePanelConnectTabAdmissionRequest,
  ): SidePanelConnectAdmission {
    const { windowId, tab, sender } = request
    const senderTab = sender.tab
    switch (typeof senderTab) {
      case 'object':
        break
      case 'undefined':
      case 'string':
      case 'number':
      case 'bigint':
      case 'boolean':
      case 'symbol':
      case 'function':
        return SidePanelConnectAdmissionRule.REJECTED
    }
    switch (senderTab.windowId === windowId) {
      case false:
        return SidePanelConnectAdmissionRule.REJECTED
      case true:
        break
    }
    const match: SidePanelConnectTabMatchRequest = { tab, sender: senderTab }
    switch (SidePanelConnectAdmissionRule.tabMatch(match)) {
      case SidePanelConnectTabMatch.Same:
        return { kind: SidePanelConnectAdmissionKind.Admitted, tab: senderTab }
      case SidePanelConnectTabMatch.Other:
        return SidePanelConnectAdmissionRule.REJECTED
    }
  }

  /** Before the tab is known any tab of the window may be it. */
  static tabMatch(
    request: SidePanelConnectTabMatchRequest,
  ): SidePanelConnectTabMatch {
    const { tab, sender } = request
    switch (tab.kind) {
      case SidePanelConnectTabKind.Pending:
        return SidePanelConnectTabMatch.Same
      case SidePanelConnectTabKind.Known:
        break
    }
    switch (sender.id === tab.tabId) {
      case true:
        return SidePanelConnectTabMatch.Same
      case false:
        return SidePanelConnectTabMatch.Other
    }
  }
}

enum SidePanelConnectReadingKind {
  Silent = 'silent',
  Step = 'step',
  /** Once a message failed to decode, the port is a protocol failure. */
  Undecodable = 'undecodable',
}

type SidePanelConnectReading =
  | { readonly kind: SidePanelConnectReadingKind.Silent }
  | {
      readonly kind: SidePanelConnectReadingKind.Step
      readonly step: ExtensionConnectStep
    }
  | { readonly kind: SidePanelConnectReadingKind.Undecodable }

enum SidePanelConnectPortLink {
  Open = 'open',
  Closed = 'closed',
}

/** One page port: the latest step it sent, read as it arrives so nothing
 * is missed while its sender is checked. */
class SidePanelIncomingPort {
  private reading: SidePanelConnectReading = {
    kind: SidePanelConnectReadingKind.Silent,
  }
  private link = SidePanelConnectPortLink.Open

  constructor(readonly port: chrome.runtime.Port) {}

  /** Chrome sets the sender on every port an onConnectExternal listener
   * receives; the absence is still named. */
  sender(): SidePanelConnectSender {
    const { sender } = this.port
    switch (typeof sender) {
      case 'object':
        return { kind: SidePanelConnectSenderKind.Present, sender }
      case 'undefined':
      case 'string':
      case 'number':
      case 'bigint':
      case 'boolean':
      case 'symbol':
      case 'function':
        return { kind: SidePanelConnectSenderKind.Absent }
    }
  }

  receive(message: BrowserRuntimeMessageValue): void {
    switch (this.reading.kind) {
      case SidePanelConnectReadingKind.Undecodable:
        return
      case SidePanelConnectReadingKind.Silent:
      case SidePanelConnectReadingKind.Step:
        break
    }
    const decoded = Effect.runSync(
      Effect.result(ExtensionConnectSteps.decode(message)),
    )
    switch (decoded._tag) {
      case 'Success':
        this.reading = {
          kind: SidePanelConnectReadingKind.Step,
          step: decoded.success,
        }
        return
      case 'Failure':
        this.reading = { kind: SidePanelConnectReadingKind.Undecodable }
    }
  }

  latest(): SidePanelConnectReading {
    return this.reading
  }

  linked(): SidePanelConnectPortLink {
    return this.link
  }

  closed(): void {
    this.link = SidePanelConnectPortLink.Closed
  }

  disconnect(): void {
    this.link = SidePanelConnectPortLink.Closed
    this.port.disconnect()
  }
}

type SidePanelHeldPort =
  | { readonly kind: SidePanelConnectHoldKind.Free }
  | {
      readonly kind: SidePanelConnectHoldKind.Held
      readonly incoming: SidePanelIncomingPort
      /** The tab the admitted port came from. */
      readonly tab: chrome.tabs.Tab
    }

enum SidePanelHeldMatch {
  Held = 'held',
  Other = 'other',
}

type SidePanelIncomingMessage = {
  readonly incoming: SidePanelIncomingPort
  readonly message: BrowserRuntimeMessageValue
}

/** One pending connect: from the begin-pairing request until the page
 * approved, closed, failed the protocol, or the panel ended it. */
export class SidePanelConnectSession {
  private static readonly CLOSED: SidePanelConnectEvent = {
    kind: SidePanelConnectEventKind.Closed,
  }
  private static readonly PROTOCOL_FAILURE: SidePanelConnectEvent = {
    kind: SidePanelConnectEventKind.ProtocolFailure,
  }
  private pending = SidePanelConnectPendingKind.Pending
  private tab: SidePanelConnectTab = { kind: SidePanelConnectTabKind.Pending }
  private held: SidePanelHeldPort = { kind: SidePanelConnectHoldKind.Free }

  constructor(private readonly request: SidePanelConnectSessionRequest) {}

  start(): void {
    chrome.runtime.onConnectExternal.addListener(this.connected)
    chrome.tabs.onRemoved.addListener(this.removed)
  }

  /** The service worker named the connect tab: a port admitted from
   * another tab of the window meanwhile is dropped. */
  tabOpened(tabId: number): void {
    this.tab = { kind: SidePanelConnectTabKind.Known, tabId }
    switch (this.held.kind) {
      case SidePanelConnectHoldKind.Free:
        return
      case SidePanelConnectHoldKind.Held:
        break
    }
    const { incoming, tab } = this.held
    const match: SidePanelConnectTabMatchRequest = {
      tab: this.tab,
      sender: tab,
    }
    switch (SidePanelConnectAdmissionRule.tabMatch(match)) {
      case SidePanelConnectTabMatch.Same:
        this.report(incoming)
        return
      case SidePanelConnectTabMatch.Other:
        incoming.disconnect()
        this.held = { kind: SidePanelConnectHoldKind.Free }
    }
  }

  /** Stop listening and close the admitted port, if any. */
  end(): void {
    this.pending = SidePanelConnectPendingKind.None
    chrome.runtime.onConnectExternal.removeListener(this.connected)
    chrome.tabs.onRemoved.removeListener(this.removed)
    switch (this.held.kind) {
      case SidePanelConnectHoldKind.Free:
        return
      case SidePanelConnectHoldKind.Held:
        this.held.incoming.disconnect()
        this.held = { kind: SidePanelConnectHoldKind.Free }
    }
  }

  private readonly connected = (port: chrome.runtime.Port): void => {
    const incoming = new SidePanelIncomingPort(port)
    port.onMessage.addListener((message: BrowserRuntimeMessageValue) => {
      const received: SidePanelIncomingMessage = { incoming, message }
      this.message(received)
    })
    port.onDisconnect.addListener(() => this.disconnected(incoming))
    void this.admit(incoming)
  }

  private readonly removed = (tabId: number): void => {
    switch (this.tab.kind) {
      case SidePanelConnectTabKind.Pending:
        return
      case SidePanelConnectTabKind.Known:
        break
    }
    switch (this.tab.tabId === tabId) {
      case false:
        return
      case true:
        break
    }
    this.end()
    this.request.onevent(SidePanelConnectSession.CLOSED)
  }

  private async admit(incoming: SidePanelIncomingPort): Promise<void> {
    const trust = await this.trust(incoming)
    // A port that closed while its sender was checked is never admitted.
    switch (incoming.linked()) {
      case SidePanelConnectPortLink.Closed:
        return
      case SidePanelConnectPortLink.Open:
        break
    }
    const admission: SidePanelConnectAdmissionRequest = {
      trust,
      pending: this.pending,
      hold: this.held.kind,
      windowId: this.request.windowId,
      tab: this.tab,
      sender: incoming.sender(),
    }
    const admitted = SidePanelConnectAdmissionRule.admission(admission)
    switch (admitted.kind) {
      case SidePanelConnectAdmissionKind.Rejected:
        incoming.disconnect()
        return
      case SidePanelConnectAdmissionKind.Admitted:
        this.held = {
          kind: SidePanelConnectHoldKind.Held,
          incoming,
          tab: admitted.tab,
        }
        this.report(incoming)
    }
  }

  private trust(
    incoming: SidePanelIncomingPort,
  ): Promise<SidePanelConnectSenderTrust> {
    const sender = incoming.sender()
    switch (sender.kind) {
      case SidePanelConnectSenderKind.Absent:
        return Promise.resolve(SidePanelConnectSenderTrust.Untrusted)
      case SidePanelConnectSenderKind.Present:
        break
    }
    const checked = Effect.tryPromise(() =>
      this.request.senderPolicy.admits(sender.sender),
    ).pipe(
      Effect.map((admitted) => SidePanelConnectSession.trustOf(admitted)),
      // A sender the policy could not check is not trusted.
      Effect.orElseSucceed(() => SidePanelConnectSenderTrust.Untrusted),
    )
    return Effect.runPromise(checked)
  }

  private static trustOf(admitted: boolean): SidePanelConnectSenderTrust {
    switch (admitted) {
      case true:
        return SidePanelConnectSenderTrust.Trusted
      case false:
        return SidePanelConnectSenderTrust.Untrusted
    }
  }

  private message(received: SidePanelIncomingMessage): void {
    const { incoming, message } = received
    incoming.receive(message)
    switch (this.heldMatch(incoming)) {
      case SidePanelHeldMatch.Other:
        return
      case SidePanelHeldMatch.Held:
        this.report(incoming)
    }
  }

  private disconnected(incoming: SidePanelIncomingPort): void {
    // Reading lastError marks Chrome's disconnect reason as handled.
    void chrome.runtime.lastError
    incoming.closed()
    switch (this.heldMatch(incoming)) {
      case SidePanelHeldMatch.Other:
        return
      case SidePanelHeldMatch.Held:
        break
    }
    this.held = { kind: SidePanelConnectHoldKind.Free }
    this.end()
    this.request.onevent(SidePanelConnectSession.CLOSED)
  }

  private report(incoming: SidePanelIncomingPort): void {
    const reading = incoming.latest()
    switch (reading.kind) {
      case SidePanelConnectReadingKind.Silent:
        return
      case SidePanelConnectReadingKind.Step: {
        const stepped: SidePanelConnectEvent = {
          kind: SidePanelConnectEventKind.Step,
          step: reading.step,
        }
        this.request.onevent(stepped)
        return
      }
      case SidePanelConnectReadingKind.Undecodable:
        this.end()
        this.request.onevent(SidePanelConnectSession.PROTOCOL_FAILURE)
    }
  }

  private heldMatch(incoming: SidePanelIncomingPort): SidePanelHeldMatch {
    switch (this.held.kind) {
      case SidePanelConnectHoldKind.Free:
        return SidePanelHeldMatch.Other
      case SidePanelConnectHoldKind.Held:
        break
    }
    switch (this.held.incoming === incoming) {
      case true:
        return SidePanelHeldMatch.Held
      case false:
        return SidePanelHeldMatch.Other
    }
  }
}

export type SidePanelConnectOpenRequest = {
  readonly windowId: number
  readonly onevent: SidePanelConnectListener
}

enum SidePanelConnectCurrentKind {
  None = 'none',
  Open = 'open',
}

type SidePanelConnectCurrent =
  | { readonly kind: SidePanelConnectCurrentKind.None }
  | {
      readonly kind: SidePanelConnectCurrentKind.Open
      readonly session: SidePanelConnectSession
    }

/** The panel's one pending connect at a time. */
export class SidePanelConnectSessions {
  private current: SidePanelConnectCurrent = {
    kind: SidePanelConnectCurrentKind.None,
  }

  constructor(private readonly senderPolicy: SidePanelConnectSenderPolicy) {}

  /** Start listening for the page of a connect about to begin. */
  open(request: SidePanelConnectOpenRequest): void {
    this.end()
    const sessionRequest: SidePanelConnectSessionRequest = {
      ...request,
      senderPolicy: this.senderPolicy,
    }
    const session = new SidePanelConnectSession(sessionRequest)
    session.start()
    this.current = { kind: SidePanelConnectCurrentKind.Open, session }
  }

  tabOpened(tabId: number): void {
    switch (this.current.kind) {
      case SidePanelConnectCurrentKind.None:
        return
      case SidePanelConnectCurrentKind.Open:
        this.current.session.tabOpened(tabId)
    }
  }

  end(): void {
    switch (this.current.kind) {
      case SidePanelConnectCurrentKind.None:
        return
      case SidePanelConnectCurrentKind.Open:
        this.current.session.end()
        this.current = { kind: SidePanelConnectCurrentKind.None }
    }
  }
}
