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
 * pending, the panel listens for those ports:
 *
 * - The trusted Simple Vault origin rule (ExternalSenderTrustPolicy) must
 *   admit the sender, and the sender's tab must be in this panel's window.
 *   A policy that cannot be evaluated ends the connect visibly.
 * - Until the service worker names the connect tab, such ports are held as
 *   candidates and nothing acts on them. A candidate that closes or sends an
 *   undecodable message meanwhile is dropped; the connect goes on.
 * - When the tab id arrives, only the candidate from that tab is admitted
 *   (its latest step applies) and the others are disconnected. Later ports
 *   are admitted only from that tab, one at a time.
 *
 * Every other port is disconnected at once. Steps carry no authority: the
 * grant import keeps its own validation. Once admitted, an undecodable
 * message ends the link as a protocol failure, and a closed port or connect
 * tab ends it too; nothing reconnects.
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
  /** The origin rule could not be evaluated for a page's port. */
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
  /** A trusted port of the window, held until the tab id arrives. */
  Candidate = 'candidate',
  Rejected = 'rejected',
}

/** An admitted or candidate port names the tab it came from. */
export type SidePanelConnectAdmission =
  | {
      readonly kind: SidePanelConnectAdmissionKind.Admitted
      readonly tab: chrome.tabs.Tab
    }
  | {
      readonly kind: SidePanelConnectAdmissionKind.Candidate
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
  readonly hold: SidePanelConnectHoldKind
  readonly sender: chrome.runtime.MessageSender
}

type SidePanelConnectKnownTabRequest = {
  readonly tabId: number
  readonly hold: SidePanelConnectHoldKind
  readonly senderTab: chrome.tabs.Tab
}

enum SidePanelConnectTabMatch {
  Same = 'same',
  Other = 'other',
}

type SidePanelConnectTabMatchRequest = {
  readonly tabId: number
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
    const { trust, pending, sender } = request
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
    switch (sender.kind) {
      case SidePanelConnectSenderKind.Absent:
        return SidePanelConnectAdmissionRule.REJECTED
      case SidePanelConnectSenderKind.Present:
        break
    }
    const fromTab: SidePanelConnectTabAdmissionRequest = {
      windowId: request.windowId,
      tab: request.tab,
      hold: request.hold,
      sender: sender.sender,
    }
    return SidePanelConnectAdmissionRule.fromTab(fromTab)
  }

  /** A port from no tab or from another window is rejected; before the tab
   * id is known a port of the window is only a candidate. */
  private static fromTab(
    request: SidePanelConnectTabAdmissionRequest,
  ): SidePanelConnectAdmission {
    const { windowId, tab, hold, sender } = request
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
    switch (tab.kind) {
      case SidePanelConnectTabKind.Pending:
        return { kind: SidePanelConnectAdmissionKind.Candidate, tab: senderTab }
      case SidePanelConnectTabKind.Known: {
        const known: SidePanelConnectKnownTabRequest = {
          tabId: tab.tabId,
          hold,
          senderTab,
        }
        return SidePanelConnectAdmissionRule.fromKnownTab(known)
      }
    }
  }

  /** Once the tab id is known: only that tab, and only one port. */
  private static fromKnownTab(
    request: SidePanelConnectKnownTabRequest,
  ): SidePanelConnectAdmission {
    const { tabId, hold, senderTab } = request
    switch (hold) {
      case SidePanelConnectHoldKind.Held:
        return SidePanelConnectAdmissionRule.REJECTED
      case SidePanelConnectHoldKind.Free:
        break
    }
    const match: SidePanelConnectTabMatchRequest = { tabId, sender: senderTab }
    switch (SidePanelConnectAdmissionRule.tabMatch(match)) {
      case SidePanelConnectTabMatch.Same:
        return { kind: SidePanelConnectAdmissionKind.Admitted, tab: senderTab }
      case SidePanelConnectTabMatch.Other:
        return SidePanelConnectAdmissionRule.REJECTED
    }
  }

  static tabMatch(
    request: SidePanelConnectTabMatchRequest,
  ): SidePanelConnectTabMatch {
    switch (request.sender.id === request.tabId) {
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
 * is missed while its sender is checked or it waits as a candidate. */
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

/** A port the panel holds, with the tab it came from. */
type SidePanelHeldEntry = {
  readonly incoming: SidePanelIncomingPort
  readonly tab: chrome.tabs.Tab
}

type SidePanelHeldPort =
  | { readonly kind: SidePanelConnectHoldKind.Free }
  | ({ readonly kind: SidePanelConnectHoldKind.Held } & SidePanelHeldEntry)

type SidePanelCandidateMeeting = {
  readonly candidate: SidePanelHeldEntry
  readonly tabId: number
}

type SidePanelIncomingMessage = {
  readonly incoming: SidePanelIncomingPort
  readonly message: BrowserRuntimeMessageValue
}

enum SidePanelSenderCheckKind {
  Checked = 'checked',
  /** The policy threw or rejected instead of answering. */
  Failed = 'failed',
}

type SidePanelSenderCheck =
  | {
      readonly kind: SidePanelSenderCheckKind.Checked
      readonly trust: SidePanelConnectSenderTrust
    }
  | { readonly kind: SidePanelSenderCheckKind.Failed }

enum SidePanelPortRole {
  Admitted = 'admitted',
  Candidate = 'candidate',
  Other = 'other',
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

  private pending = SidePanelConnectPendingKind.Pending
  private tab: SidePanelConnectTab = { kind: SidePanelConnectTabKind.Pending }
  private held: SidePanelHeldPort = { kind: SidePanelConnectHoldKind.Free }
  /** Trusted ports of the window that arrived before the tab id. */
  private candidates: SidePanelHeldEntry[] = []
  /** Tabs of any window that closed before the tab id arrived. */
  private readonly removedEarly = new Set<number>()

  constructor(private readonly request: SidePanelConnectSessionRequest) {}

  start(): void {
    chrome.runtime.onConnectExternal.addListener(this.connected)
    chrome.tabs.onRemoved.addListener(this.removed)
  }

  /** The service worker named the connect tab: its candidate is admitted
   * and every other candidate is dropped. */
  tabOpened(tabId: number): void {
    this.tab = { kind: SidePanelConnectTabKind.Known, tabId }
    switch (this.removedEarly.has(tabId)) {
      case true:
        // The connect tab is gone already: the card returns.
        this.end()
        this.request.onevent(SidePanelConnectSession.CLOSED)
        return
      case false:
        break
    }
    const waiting = this.candidates
    this.candidates = []
    for (const candidate of waiting) {
      const meeting: SidePanelCandidateMeeting = { candidate, tabId }
      this.decide(meeting)
    }
  }

  /** Stop listening and close every held port. */
  end(): void {
    this.pending = SidePanelConnectPendingKind.None
    chrome.runtime.onConnectExternal.removeListener(this.connected)
    chrome.tabs.onRemoved.removeListener(this.removed)
    for (const candidate of this.candidates) candidate.incoming.disconnect()
    this.candidates = []
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
        this.removedEarly.add(tabId)
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
    const check = await this.check(incoming)
    switch (check.kind) {
      case SidePanelSenderCheckKind.Failed:
        incoming.disconnect()
        switch (this.pending) {
          case SidePanelConnectPendingKind.None:
            return
          case SidePanelConnectPendingKind.Pending:
            break
        }
        this.end()
        this.request.onevent(SidePanelConnectSession.SENDER_CHECK_FAILURE)
        return
      case SidePanelSenderCheckKind.Checked:
        break
    }
    // A port that closed while its sender was checked is never admitted.
    switch (incoming.linked()) {
      case SidePanelConnectPortLink.Closed:
        return
      case SidePanelConnectPortLink.Open:
        break
    }
    const admission: SidePanelConnectAdmissionRequest = {
      trust: check.trust,
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
      case SidePanelConnectAdmissionKind.Candidate: {
        const candidate: SidePanelHeldEntry = { incoming, tab: admitted.tab }
        this.candidates.push(candidate)
        this.dropUndecodableCandidate(incoming)
        return
      }
      case SidePanelConnectAdmissionKind.Admitted: {
        const entry: SidePanelHeldEntry = { incoming, tab: admitted.tab }
        this.hold(entry)
      }
    }
  }

  /** A candidate meets the known tab id. */
  private decide(meeting: SidePanelCandidateMeeting): void {
    const { candidate, tabId } = meeting
    const match: SidePanelConnectTabMatchRequest = {
      tabId,
      sender: candidate.tab,
    }
    switch (SidePanelConnectAdmissionRule.tabMatch(match)) {
      case SidePanelConnectTabMatch.Other:
        candidate.incoming.disconnect()
        return
      case SidePanelConnectTabMatch.Same:
        break
    }
    switch (this.held.kind) {
      case SidePanelConnectHoldKind.Held:
        candidate.incoming.disconnect()
        return
      case SidePanelConnectHoldKind.Free:
        this.hold(candidate)
    }
  }

  private hold(entry: SidePanelHeldEntry): void {
    this.held = { kind: SidePanelConnectHoldKind.Held, ...entry }
    this.report(entry.incoming)
  }

  private check(
    incoming: SidePanelIncomingPort,
  ): Promise<SidePanelSenderCheck> {
    const sender = incoming.sender()
    const untrusted: SidePanelSenderCheck = {
      kind: SidePanelSenderCheckKind.Checked,
      trust: SidePanelConnectSenderTrust.Untrusted,
    }
    switch (sender.kind) {
      case SidePanelConnectSenderKind.Absent:
        return Promise.resolve(untrusted)
      case SidePanelConnectSenderKind.Present:
        break
    }
    const failed: SidePanelSenderCheck = {
      kind: SidePanelSenderCheckKind.Failed,
    }
    // A false answer rejects this port quietly; a policy that could not
    // answer ends the connect, so the card never waits on it.
    const checked = Effect.tryPromise(() =>
      this.request.senderPolicy.admits(sender.sender),
    ).pipe(
      Effect.map((admitted) => SidePanelConnectSession.checked(admitted)),
      Effect.catch(() => Effect.succeed(failed)),
    )
    return Effect.runPromise(checked)
  }

  private static checked(admitted: boolean): SidePanelSenderCheck {
    switch (admitted) {
      case true:
        return {
          kind: SidePanelSenderCheckKind.Checked,
          trust: SidePanelConnectSenderTrust.Trusted,
        }
      case false:
        return {
          kind: SidePanelSenderCheckKind.Checked,
          trust: SidePanelConnectSenderTrust.Untrusted,
        }
    }
  }

  private message(received: SidePanelIncomingMessage): void {
    const { incoming, message } = received
    incoming.receive(message)
    switch (this.role(incoming)) {
      case SidePanelPortRole.Admitted:
        this.report(incoming)
        return
      case SidePanelPortRole.Candidate:
        this.dropUndecodableCandidate(incoming)
        return
      case SidePanelPortRole.Other:
        return
    }
  }

  /** A candidate that broke the protocol before the tab id is dropped. */
  private dropUndecodableCandidate(incoming: SidePanelIncomingPort): void {
    switch (incoming.latest().kind) {
      case SidePanelConnectReadingKind.Undecodable:
        incoming.disconnect()
        this.forgetCandidate(incoming)
        return
      case SidePanelConnectReadingKind.Silent:
      case SidePanelConnectReadingKind.Step:
        return
    }
  }

  private disconnected(incoming: SidePanelIncomingPort): void {
    // Reading lastError marks Chrome's disconnect reason as handled.
    void chrome.runtime.lastError
    incoming.closed()
    switch (this.role(incoming)) {
      case SidePanelPortRole.Candidate:
        this.forgetCandidate(incoming)
        return
      case SidePanelPortRole.Other:
        return
      case SidePanelPortRole.Admitted:
        break
    }
    this.held = { kind: SidePanelConnectHoldKind.Free }
    this.end()
    this.request.onevent(SidePanelConnectSession.CLOSED)
  }

  private forgetCandidate(incoming: SidePanelIncomingPort): void {
    this.candidates = this.candidates.filter(
      (candidate) => candidate.incoming !== incoming,
    )
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

  private role(incoming: SidePanelIncomingPort): SidePanelPortRole {
    switch (this.held.kind) {
      case SidePanelConnectHoldKind.Held:
        switch (this.held.incoming === incoming) {
          case true:
            return SidePanelPortRole.Admitted
          case false:
            break
        }
        break
      case SidePanelConnectHoldKind.Free:
        break
    }
    const candidate = this.candidates.some(
      (waiting) => waiting.incoming === incoming,
    )
    switch (candidate) {
      case true:
        return SidePanelPortRole.Candidate
      case false:
        return SidePanelPortRole.Other
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
