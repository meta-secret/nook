import { Effect } from 'effect'
import {
  ExtensionConnectSteps,
  type ExtensionConnectStep,
} from '../../../nook-web-shared/src/extension/extension-connect-progress'
import type { BrowserRuntimeMessageValue } from '../lib/browser-runtime-message'

/**
 * The side panel's live link to the Nook tab it opened for a connect. The
 * panel names each connect with a fresh random id before it asks the
 * service worker for the tab; the connect URL carries that id and the page
 * opens its runtime port under it. Chrome hands an external
 * `runtime.connect` to every listening extension document, so the panel of
 * each window sees each page's port. While a connect is pending, the panel
 * admits one port:
 *
 * - its name is this connect's id;
 * - its sender's tab is in this panel's window, and the trusted Simple
 *   Vault origin rule (ExternalSenderTrustPolicy) admits the sender. A
 *   policy that cannot be evaluated ends the connect visibly;
 * - no port is admitted yet.
 *
 * Every other port is disconnected at once. The id only matches a port to
 * its connect and grants nothing; steps carry no authority, and the grant
 * import keeps its own validation. Once admitted, an undecodable message
 * ends the link as a protocol failure, and a closed port ends it too. The
 * connect tab closing ends it as well, also before its page connected;
 * nothing reconnects.
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
  /** The origin rule could not be evaluated for the page's port. */
  SenderCheckFailure = 'sender-check-failure',
}

export type SidePanelConnectEvent =
  | {
      readonly kind: SidePanelConnectEventKind.Step
      readonly step: ExtensionConnectStep
    }
  | { readonly kind: SidePanelConnectEventKind.Closed }
  | { readonly kind: SidePanelConnectEventKind.ProtocolFailure }
  | { readonly kind: SidePanelConnectEventKind.SenderCheckFailure }

export type SidePanelConnectListener = (event: SidePanelConnectEvent) => void

export type SidePanelConnectSessionRequest = {
  /** This connect's id: the name its page's port carries. */
  readonly connectId: string
  /** The window this panel is docked in. */
  readonly windowId: number
  readonly senderPolicy: SidePanelConnectSenderPolicy
  readonly onevent: SidePanelConnectListener
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

/** The connect's page port: the latest step it sent, read as it arrives so
 * nothing is missed while its sender is checked. */
class SidePanelIncomingPort {
  private reading: SidePanelConnectReading = {
    kind: SidePanelConnectReadingKind.Silent,
  }
  private link = SidePanelConnectPortLink.Open

  constructor(readonly port: chrome.runtime.Port) {}

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

enum SidePanelSenderCheckKind {
  Admitted = 'admitted',
  Rejected = 'rejected',
  /** The policy threw or rejected instead of answering. */
  Failed = 'failed',
}

enum SidePanelConnectPageKind {
  /** No port is admitted yet. */
  Waiting = 'waiting',
  Admitted = 'admitted',
  /** The connect ended; nothing is admitted again. */
  Ended = 'ended',
}

type SidePanelConnectPage =
  | { readonly kind: SidePanelConnectPageKind.Waiting }
  | {
      readonly kind: SidePanelConnectPageKind.Admitted
      readonly incoming: SidePanelIncomingPort
    }
  | { readonly kind: SidePanelConnectPageKind.Ended }

enum SidePanelConnectTabKind {
  /** The service worker has not named the connect tab yet. */
  Pending = 'pending',
  Known = 'known',
}

type SidePanelConnectTab =
  | { readonly kind: SidePanelConnectTabKind.Pending }
  | { readonly kind: SidePanelConnectTabKind.Known; readonly tabId: number }

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
  private static readonly SENDER_CHECK_FAILURE: SidePanelConnectEvent = {
    kind: SidePanelConnectEventKind.SenderCheckFailure,
  }

  private page: SidePanelConnectPage = {
    kind: SidePanelConnectPageKind.Waiting,
  }
  private tab: SidePanelConnectTab = { kind: SidePanelConnectTabKind.Pending }

  constructor(private readonly request: SidePanelConnectSessionRequest) {}

  start(): void {
    chrome.runtime.onConnectExternal.addListener(this.connected)
    chrome.tabs.onRemoved.addListener(this.removed)
  }

  /** The service worker named the connect tab. The panel's connect state
   * waits for it, so an admitted page's latest step applies again. */
  tabOpened(tabId: number): void {
    this.tab = { kind: SidePanelConnectTabKind.Known, tabId }
    switch (this.page.kind) {
      case SidePanelConnectPageKind.Admitted:
        this.report(this.page.incoming)
        return
      case SidePanelConnectPageKind.Waiting:
      case SidePanelConnectPageKind.Ended:
        return
    }
  }

  /** Stop listening and close the admitted port. */
  end(): void {
    const { page } = this
    this.page = { kind: SidePanelConnectPageKind.Ended }
    chrome.runtime.onConnectExternal.removeListener(this.connected)
    chrome.tabs.onRemoved.removeListener(this.removed)
    switch (page.kind) {
      case SidePanelConnectPageKind.Admitted:
        page.incoming.disconnect()
        return
      case SidePanelConnectPageKind.Waiting:
      case SidePanelConnectPageKind.Ended:
        return
    }
  }

  private readonly connected = (port: chrome.runtime.Port): void => {
    switch (port.name === this.request.connectId) {
      case false:
        port.disconnect()
        return
      case true:
        break
    }
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
    const check = await this.check(incoming.port)
    switch (check) {
      case SidePanelSenderCheckKind.Failed:
        incoming.disconnect()
        switch (this.page.kind) {
          case SidePanelConnectPageKind.Ended:
            return
          case SidePanelConnectPageKind.Waiting:
          case SidePanelConnectPageKind.Admitted:
            break
        }
        this.end()
        this.request.onevent(SidePanelConnectSession.SENDER_CHECK_FAILURE)
        return
      case SidePanelSenderCheckKind.Rejected:
        incoming.disconnect()
        return
      case SidePanelSenderCheckKind.Admitted:
        break
    }
    // A port that closed while its sender was checked is never admitted.
    switch (incoming.linked()) {
      case SidePanelConnectPortLink.Closed:
        return
      case SidePanelConnectPortLink.Open:
        break
    }
    switch (this.page.kind) {
      case SidePanelConnectPageKind.Admitted:
      case SidePanelConnectPageKind.Ended:
        incoming.disconnect()
        return
      case SidePanelConnectPageKind.Waiting:
        break
    }
    this.page = { kind: SidePanelConnectPageKind.Admitted, incoming }
    this.report(incoming)
  }

  /** A port from no tab or from another window is rejected without asking
   * the policy; a false answer rejects it quietly, and a policy that could
   * not answer ends the connect, so the card never waits on it. */
  private check(port: chrome.runtime.Port): Promise<SidePanelSenderCheckKind> {
    const { sender } = port
    // Chrome sets the sender on every port an onConnectExternal listener
    // receives; its absence still rejects.
    switch (typeof sender) {
      case 'object':
        break
      case 'undefined':
      case 'string':
      case 'number':
      case 'bigint':
      case 'boolean':
      case 'symbol':
      case 'function':
        return Promise.resolve(SidePanelSenderCheckKind.Rejected)
    }
    switch (sender.tab?.windowId === this.request.windowId) {
      case false:
        return Promise.resolve(SidePanelSenderCheckKind.Rejected)
      case true:
        break
    }
    const checked = Effect.tryPromise(() =>
      this.request.senderPolicy.admits(sender),
    ).pipe(
      Effect.map((admitted) => SidePanelConnectSession.checked(admitted)),
      Effect.catch(() => Effect.succeed(SidePanelSenderCheckKind.Failed)),
    )
    return Effect.runPromise(checked)
  }

  private static checked(admitted: boolean): SidePanelSenderCheckKind {
    switch (admitted) {
      case true:
        return SidePanelSenderCheckKind.Admitted
      case false:
        return SidePanelSenderCheckKind.Rejected
    }
  }

  private message(received: SidePanelIncomingMessage): void {
    const { incoming, message } = received
    incoming.receive(message)
    switch (this.admitted(incoming)) {
      case true:
        this.report(incoming)
        return
      case false:
        return
    }
  }

  private disconnected(incoming: SidePanelIncomingPort): void {
    // Reading lastError marks Chrome's disconnect reason as handled.
    void chrome.runtime.lastError
    incoming.closed()
    switch (this.admitted(incoming)) {
      case false:
        return
      case true:
        break
    }
    this.page = { kind: SidePanelConnectPageKind.Waiting }
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

  private admitted(incoming: SidePanelIncomingPort): boolean {
    switch (this.page.kind) {
      case SidePanelConnectPageKind.Admitted:
        return this.page.incoming === incoming
      case SidePanelConnectPageKind.Waiting:
      case SidePanelConnectPageKind.Ended:
        return false
    }
  }
}

export type SidePanelConnectOpenRequest = {
  readonly connectId: string
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
