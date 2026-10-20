import { Effect } from 'effect'
import {
  DeviceProtectionStatus,
  extensionWasmRuntime,
  type ExtensionSessionDeviceWire,
} from '../lib/nook-wasm'
import {
  IdentityKeyCancelOutcome,
  type DeviceProtectionUnlock,
} from '../popup/device-protection-ceremony'
import { ExternalSenderTrustPolicy } from '../background/service-worker/routing-trust'
import {
  SidePanelConnectActivity,
  SidePanelConnectFailure,
  SidePanelConnectFollowUp,
  SidePanelConnectKind,
  SidePanelConnectStep,
  SidePanelConnects,
  type SidePanelConnect,
} from './side-panel-connect-state'
import {
  SidePanelConnectSessions,
  type SidePanelConnectEvent,
} from './side-panel-connect-port'
import {
  SidePanelWindowKind,
  type SidePanelPairing,
  type SidePanelRuntime,
  type SidePanelWindow,
} from './side-panel-runtime'

/** Which key the unlocked view can connect the next identity with. */
export enum SidePanelConnectingDeviceKind {
  /** The panel is not unlocked: nothing connects. */
  NotUnlocked = 'not-unlocked',
  /** Unlocked, but the session holds no active key. */
  Locked = 'locked',
  Active = 'active',
}

export type SidePanelConnectingDevice =
  | { readonly kind: SidePanelConnectingDeviceKind.NotUnlocked }
  | { readonly kind: SidePanelConnectingDeviceKind.Locked }
  | {
      readonly kind: SidePanelConnectingDeviceKind.Active
      readonly device: ExtensionSessionDeviceWire
    }

/** What the connect flow needs from the panel around it. */
export interface SidePanelConnectFlowHost {
  connectingDevice(): SidePanelConnectingDevice
  panelWindow(): SidePanelWindow
  /** The name the connect page shows for this browser's key. */
  deviceLabel(): string
  /** Show a fresh passkey or PIN ceremony for the next identity's key. */
  restartCeremony(): void
  /** The next identity's key unlocked: show the panel unlocked with it. */
  identityUnlocked(device: ExtensionSessionDeviceWire): void
  /** The identity was approved: read the paired vaults again. */
  readVaults(): void
  clearAlert(): void
  /** Bringing the Nook tab to the front failed. */
  focusFailed(): void
}

export type SidePanelConnectFlowRequest = {
  readonly host: SidePanelConnectFlowHost
  readonly runtime: SidePanelRuntime
}

/**
 * Connecting an identity from the panel: Rust picks the connecting key (or
 * stages a new one, set up in place), the service worker opens or reuses
 * the one Nook tab, and the panel follows the steps that tab reports.
 */
export class SidePanelConnectFlow {
  connect = $state<SidePanelConnect>({ kind: SidePanelConnectKind.Idle })

  /** The connect page's port, admitted by the Simple Vault origin rule. */
  private readonly sessions = new SidePanelConnectSessions(
    ExternalSenderTrustPolicy,
  )

  constructor(private readonly request: SidePanelConnectFlowRequest) {}

  /** Drop a running connect: the card returns. */
  stop(): void {
    this.sessions.end()
    this.connect = { kind: SidePanelConnectKind.Idle }
  }

  /** The card's close button: a starting connect keeps it. */
  close(): void {
    switch (this.connect.kind) {
      case SidePanelConnectKind.Starting:
      case SidePanelConnectKind.IdentityKey:
        return
      case SidePanelConnectKind.Idle:
      case SidePanelConnectKind.InTab:
      case SidePanelConnectKind.Failed:
        this.stop()
    }
  }

  /** Rust decides whether the unlocked key connects the next identity or
   * a new key is set up for it first, as each identity has its own. */
  async start(): Promise<void> {
    switch (SidePanelConnects.activity(this.connect)) {
      case SidePanelConnectActivity.Busy:
        return
      case SidePanelConnectActivity.Ready:
        break
    }
    const connecting = this.request.host.connectingDevice()
    switch (connecting.kind) {
      case SidePanelConnectingDeviceKind.NotUnlocked:
        return
      case SidePanelConnectingDeviceKind.Locked:
        this.failed()
        return
      case SidePanelConnectingDeviceKind.Active:
        break
    }
    this.connect = { kind: SidePanelConnectKind.Starting }
    const label = this.request.host.deviceLabel()
    const begun = await Effect.runPromise(
      Effect.result(
        Effect.tryPromise(() =>
          extensionWasmRuntime.beginIdentityConnection(label),
        ),
      ),
    )
    switch (begun._tag) {
      case 'Failure':
        this.failed()
        return
      case 'Success':
        break
    }
    switch (SidePanelConnects.step(begun.success)) {
      case SidePanelConnectStep.Pair:
        await this.pair(connecting.device)
        return
      case SidePanelConnectStep.SetUpKey:
        this.connect = SidePanelConnects.identityKey()
        this.request.host.restartCeremony()
    }
  }

  async focusTab(): Promise<void> {
    switch (this.connect.kind) {
      case SidePanelConnectKind.InTab:
        break
      case SidePanelConnectKind.Idle:
      case SidePanelConnectKind.Starting:
      case SidePanelConnectKind.IdentityKey:
      case SidePanelConnectKind.Failed:
        return
    }
    this.request.host.clearAlert()
    const focused = await Effect.runPromise(
      Effect.result(this.request.runtime.focusTab(this.connect.tabId)),
    )
    switch (focused._tag) {
      case 'Success':
        return
      case 'Failure':
        this.request.host.focusFailed()
    }
  }

  /** The new identity's ceremony moved to PIN setup. */
  identityKeyStatus(next: DeviceProtectionStatus): void {
    switch (this.connect.kind) {
      case SidePanelConnectKind.IdentityKey:
        this.connect = { ...this.connect, status: next }
        return
      case SidePanelConnectKind.Idle:
      case SidePanelConnectKind.Starting:
      case SidePanelConnectKind.InTab:
      case SidePanelConnectKind.Failed:
        return
    }
  }

  /** The person did not set up the new identity's key: drop it and end
   * the connect. */
  async cancelIdentityKey(): Promise<IdentityKeyCancelOutcome> {
    const cancelled = await Effect.runPromise(
      Effect.result(
        Effect.tryPromise(() =>
          extensionWasmRuntime.cancelIdentityConnection(),
        ),
      ),
    )
    switch (cancelled._tag) {
      case 'Failure':
        return IdentityKeyCancelOutcome.Failed
      case 'Success':
        this.connect = { kind: SidePanelConnectKind.Idle }
        return IdentityKeyCancelOutcome.Cancelled
    }
  }

  /** The new identity's key exists and is the unlocked one: open the
   * connect page for it. */
  identityKeyUnlocked(unlock: DeviceProtectionUnlock): void {
    switch (this.connect.kind) {
      case SidePanelConnectKind.IdentityKey:
        break
      case SidePanelConnectKind.Idle:
      case SidePanelConnectKind.Starting:
      case SidePanelConnectKind.InTab:
      case SidePanelConnectKind.Failed:
        return
    }
    this.request.host.identityUnlocked(unlock.device)
    void this.pair(unlock.device)
  }

  private failed(): void {
    this.sessions.end()
    this.connect = {
      kind: SidePanelConnectKind.Failed,
      failure: SidePanelConnectFailure.Start,
    }
  }

  /** Read without the narrowing an earlier assignment left. */
  private kind(): SidePanelConnectKind {
    return this.connect.kind
  }

  /** Open or reuse the one Nook tab of this window on the connect route,
   * then follow the steps its page reports; the panel stays. */
  private async pair(device: ExtensionSessionDeviceWire): Promise<void> {
    this.connect = { kind: SidePanelConnectKind.Starting }
    const panelWindow = this.request.host.panelWindow()
    switch (panelWindow.kind) {
      case SidePanelWindowKind.Known:
        break
      case SidePanelWindowKind.Resolving:
      case SidePanelWindowKind.Unknown:
        this.failed()
        return
    }
    const windowId = panelWindow.id
    // Named before the tab opens, so the page's port is known whenever it
    // arrives. The id only matches that port and grants nothing.
    const connectId = crypto.randomUUID()
    const listening: Parameters<typeof this.sessions.open>[0] = {
      connectId,
      windowId,
      onevent: (event) => this.follow(event),
    }
    this.sessions.open(listening)
    const pairing: SidePanelPairing = {
      device,
      deviceLabel: this.request.host.deviceLabel(),
      windowId,
      connectId,
    }
    const opened = await Effect.runPromise(
      Effect.result(this.request.runtime.beginPairing(pairing)),
    )
    // Page events may have moved the connect while the reply was awaited.
    switch (this.kind()) {
      case SidePanelConnectKind.Starting:
        break
      // The tab closed or the page failed before its id arrived.
      case SidePanelConnectKind.Idle:
      case SidePanelConnectKind.IdentityKey:
      case SidePanelConnectKind.InTab:
      case SidePanelConnectKind.Failed:
        return
    }
    switch (opened._tag) {
      case 'Success':
        this.connect = SidePanelConnects.inTab(opened.success)
        this.sessions.tabOpened(opened.success)
        return
      case 'Failure':
        this.failed()
    }
  }

  /** A step, a closed tab or a failure from the Nook tab. */
  private follow(event: SidePanelConnectEvent): void {
    const request: Parameters<typeof SidePanelConnects.advance>[0] = {
      connect: this.connect,
      event,
    }
    const advance = SidePanelConnects.advance(request)
    this.connect = advance.connect
    switch (advance.followUp) {
      case SidePanelConnectFollowUp.None:
        return
      case SidePanelConnectFollowUp.ReadVaults:
        // Approved: the new identity shows at once.
        this.sessions.end()
        this.request.host.readVaults()
    }
  }
}
