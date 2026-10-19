import { Effect, Schema } from 'effect'
import {
  BeginExtensionPairingMessageType,
  OpenSimpleVaultMessageType,
} from '../../../nook-web-shared/src/extension/lifecycle-runtime-messages'
import type { BrowserRuntimeMessageValue } from '../lib/browser-runtime-message'
import { ExtensionSessionMessageType } from '../lib/extension-session-message-type'
import type { ExtensionSessionDeviceWire } from '../lib/nook-wasm'

/**
 * The side panel's own use of the browser: its requests to the service
 * worker and the changes it follows. The panel never listens to runtime
 * broadcasts (they can carry plaintext between other extension documents)
 * and never messages tabs; it re-reads state when its window's tabs or its
 * own visibility change.
 */

/** The key that connects the next identity, named for the connect page,
 * the panel's own window, where the Nook tab opens or is reused, and the
 * connect's id, the name of the page's port to the panel. */
export type SidePanelPairing = {
  readonly device: ExtensionSessionDeviceWire
  readonly deviceLabel: string
  readonly windowId: number
  readonly connectId: string
}

/** The panel's requests to the service worker: a closed set. */
type SidePanelServiceWorkerMessage =
  | { readonly type: OpenSimpleVaultMessageType.NookOpenSimpleVault }
  | { readonly type: typeof ExtensionSessionMessageType.Lock }
  | {
      readonly type: BeginExtensionPairingMessageType.NookBeginExtensionPairing
      readonly payload: ExtensionSessionDeviceWire & {
        readonly deviceLabel: string
        readonly windowId: number
        readonly connectId: string
      }
    }

const sidePanelRequestFailureFields: Readonly<Record<never, never>> = {}

/** The service worker did not do what the panel asked. */
export class SidePanelRequestFailure extends Schema.TaggedError<SidePanelRequestFailure>()(
  'SidePanelRequestFailure',
  sidePanelRequestFailureFields,
) {}

type SidePanelAcknowledgement = { readonly ok: true }
type SidePanelAcknowledgementFields = {
  readonly ok: Schema.Codec<true>
}
type SidePanelTabFocusAttempt = {
  readonly try: () => Promise<void>
  readonly catch: () => SidePanelRequestFailure
}

/** The service worker opened or reused the Nook tab. */
type SidePanelTabOpened = { readonly ok: true; readonly tabId: number }
type SidePanelTabOpenedFields = SidePanelAcknowledgementFields & {
  readonly tabId: Schema.Codec<number>
}

export enum SidePanelWindowKind {
  /** The browser has not answered yet. */
  Resolving = 'resolving',
  Known = 'known',
  /** The browser did not name the panel's window: nothing follows it. */
  Unknown = 'unknown',
}

/** The browser window this panel is docked in. */
export type SidePanelWindow =
  | { readonly kind: SidePanelWindowKind.Resolving }
  | { readonly kind: SidePanelWindowKind.Known; readonly id: number }
  | { readonly kind: SidePanelWindowKind.Unknown }

/** What changed around the panel; each change only triggers a re-read. */
export enum SidePanelChangeKind {
  /** Another tab became active in the panel's window. */
  TabActivated = 'tab-activated',
  /** The active tab of the panel's window navigated or finished loading. */
  TabNavigated = 'tab-navigated',
  /** The panel became visible again. */
  PanelShown = 'panel-shown',
  /** The panel took focus, as a click into it does: re-read state only, so
   * the list under the pointer stays put. */
  PanelFocused = 'panel-focused',
  /** The panel was hidden: drop what it showed about the page. */
  PanelHidden = 'panel-hidden',
}

export type SidePanelChangeListener = (change: SidePanelChangeKind) => void

/** Stop following; returned to the component's lifecycle cleanup. */
export type SidePanelRelease = () => void

type SidePanelFollowRequest = {
  readonly window: SidePanelWindow
  readonly onchange: SidePanelChangeListener
}

type TabUpdatedListener = Parameters<
  typeof chrome.tabs.onUpdated.addListener
>[0]
type TabUpdatedArguments = Parameters<TabUpdatedListener>

enum SidePanelTabUpdateKind {
  Navigated = 'navigated',
  Unrelated = 'unrelated',
}

enum SidePanelWindowMatch {
  Same = 'same',
  Other = 'other',
}

type SidePanelReplyResume = (
  effect: Effect.Effect<BrowserRuntimeMessageValue, SidePanelRequestFailure>,
) => void

/** Hands one service-worker reply back to the waiting request. */
class SidePanelReply {
  constructor(private readonly resume: SidePanelReplyResume) {}

  readonly receive = (reply: BrowserRuntimeMessageValue): void => {
    switch (Boolean(chrome.runtime.lastError)) {
      case true:
        this.resume(Effect.fail(new SidePanelRequestFailure()))
        return
      case false:
        this.resume(Effect.succeed(reply))
    }
  }
}

/** Follows the panel's window and visibility until released. */
class SidePanelFollower {
  constructor(private readonly request: SidePanelFollowRequest) {}

  private readonly activated = (info: chrome.tabs.OnActivatedInfo): void => {
    switch (this.windowMatch(info.windowId)) {
      case SidePanelWindowMatch.Same:
        this.request.onchange(SidePanelChangeKind.TabActivated)
        return
      case SidePanelWindowMatch.Other:
        return
    }
  }

  /** Chrome calls this with the tab id, the change and the tab. */
  private readonly updated = (...update: TabUpdatedArguments): void => {
    const [, change, tab] = update
    switch (this.windowMatch(tab.windowId)) {
      case SidePanelWindowMatch.Other:
        return
      case SidePanelWindowMatch.Same:
        break
    }
    switch (tab.active) {
      case false:
        return
      case true:
        break
    }
    switch (SidePanelFollower.updateKind(change)) {
      case SidePanelTabUpdateKind.Unrelated:
        return
      case SidePanelTabUpdateKind.Navigated:
        this.request.onchange(SidePanelChangeKind.TabNavigated)
    }
  }

  private readonly visibility = (): void => {
    switch (document.visibilityState) {
      case 'visible':
        this.request.onchange(SidePanelChangeKind.PanelShown)
        return
      case 'hidden':
        this.request.onchange(SidePanelChangeKind.PanelHidden)
    }
  }

  private readonly focused = (): void => {
    this.request.onchange(SidePanelChangeKind.PanelFocused)
  }

  start(): SidePanelRelease {
    document.addEventListener('visibilitychange', this.visibility)
    window.addEventListener('focus', this.focused)
    switch (this.request.window.kind) {
      case SidePanelWindowKind.Known:
        chrome.tabs.onActivated.addListener(this.activated)
        chrome.tabs.onUpdated.addListener(this.updated)
        break
      case SidePanelWindowKind.Resolving:
      case SidePanelWindowKind.Unknown:
        break
    }
    return () => this.stop()
  }

  private stop(): void {
    document.removeEventListener('visibilitychange', this.visibility)
    window.removeEventListener('focus', this.focused)
    chrome.tabs.onActivated.removeListener(this.activated)
    chrome.tabs.onUpdated.removeListener(this.updated)
  }

  private windowMatch(windowId: number): SidePanelWindowMatch {
    const { window: panelWindow } = this.request
    switch (panelWindow.kind) {
      case SidePanelWindowKind.Resolving:
      case SidePanelWindowKind.Unknown:
        return SidePanelWindowMatch.Other
      case SidePanelWindowKind.Known:
        break
    }
    switch (panelWindow.id === windowId) {
      case true:
        return SidePanelWindowMatch.Same
      case false:
        return SidePanelWindowMatch.Other
    }
  }

  /** A navigation or a finished load matters; title, favicon and audio
   * changes do not. Only the presence of a new URL is checked here; the
   * panel never reads, keeps or logs the tab's address. */
  private static updateKind(
    change: chrome.tabs.OnUpdatedInfo,
  ): SidePanelTabUpdateKind {
    switch ('url' in change) {
      case true:
        return SidePanelTabUpdateKind.Navigated
      case false:
        break
    }
    switch (change.status === 'complete') {
      case true:
        return SidePanelTabUpdateKind.Navigated
      case false:
        return SidePanelTabUpdateKind.Unrelated
    }
  }
}

/** The side panel's browser runtime. */
export class SidePanelRuntime {
  private static readonly ACKNOWLEDGEMENT_FIELDS: SidePanelAcknowledgementFields =
    { ok: Schema.Literal(true) }

  /** The service worker's reply to a request it carried out. */
  private static readonly ACKNOWLEDGEMENT = Schema.Struct(
    SidePanelRuntime.ACKNOWLEDGEMENT_FIELDS,
  ) satisfies Schema.Codec<SidePanelAcknowledgement>

  /** Open the web app in a tab; the panel stays as it is. */
  openVault(): Effect.Effect<void, SidePanelRequestFailure> {
    const message: SidePanelServiceWorkerMessage = {
      type: OpenSimpleVaultMessageType.NookOpenSimpleVault,
    }
    return this.send(message)
  }

  private static readonly TAB_OPENED_FIELDS: SidePanelTabOpenedFields = {
    ok: Schema.Literal(true),
    tabId: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }

  /** The service worker's reply to a begin-pairing request. */
  private static readonly TAB_OPENED = Schema.Struct(
    SidePanelRuntime.TAB_OPENED_FIELDS,
  ) satisfies Schema.Codec<SidePanelTabOpened>

  /** Open Nook's connect route in the one Nook tab of the panel's window,
   * reused when one is open; answers that tab's id. The panel stays. */
  beginPairing(
    pairing: SidePanelPairing,
  ): Effect.Effect<number, SidePanelRequestFailure> {
    const message: SidePanelServiceWorkerMessage = {
      type: BeginExtensionPairingMessageType.NookBeginExtensionPairing,
      payload: {
        deviceId: pairing.device.deviceId,
        devicePublicKey: pairing.device.devicePublicKey,
        deviceSigningPublicKey: pairing.device.deviceSigningPublicKey,
        deviceLabel: pairing.deviceLabel,
        windowId: pairing.windowId,
        connectId: pairing.connectId,
      },
    }
    return this.deliver(message).pipe(
      Effect.flatMap((reply) =>
        Schema.decodeUnknownEffect(SidePanelRuntime.TAB_OPENED)(reply),
      ),
      Effect.mapError(() => new SidePanelRequestFailure()),
      Effect.map((opened) => opened.tabId),
    )
  }

  /** Bring the Nook tab of the running connect to the front. */
  focusTab(tabId: number): Effect.Effect<void, SidePanelRequestFailure> {
    const active: chrome.tabs.UpdateProperties = { active: true }
    const focus: SidePanelTabFocusAttempt = {
      try: async () => {
        await chrome.tabs.update(tabId, active)
      },
      catch: () => new SidePanelRequestFailure(),
    }
    return Effect.tryPromise(focus)
  }

  lock(): Effect.Effect<void, SidePanelRequestFailure> {
    const message: SidePanelServiceWorkerMessage = {
      type: ExtensionSessionMessageType.Lock,
    }
    return this.send(message)
  }

  /** The window this panel is docked in, as the browser names it. */
  currentWindow(): Effect.Effect<SidePanelWindow> {
    const unknown: SidePanelWindow = { kind: SidePanelWindowKind.Unknown }
    return Effect.tryPromise(() => chrome.windows.getCurrent()).pipe(
      Effect.map((current) => SidePanelRuntime.panelWindow(current)),
      Effect.orElseSucceed(() => unknown),
    )
  }

  follow(request: SidePanelFollowRequest): SidePanelRelease {
    return new SidePanelFollower(request).start()
  }

  private send(
    message: SidePanelServiceWorkerMessage,
  ): Effect.Effect<void, SidePanelRequestFailure> {
    return this.deliver(message).pipe(
      Effect.flatMap((reply) => SidePanelRuntime.acknowledged(reply)),
    )
  }

  private deliver(
    message: SidePanelServiceWorkerMessage,
  ): Effect.Effect<BrowserRuntimeMessageValue, SidePanelRequestFailure> {
    return Effect.callback<BrowserRuntimeMessageValue, SidePanelRequestFailure>(
      (resume) => {
        chrome.runtime.sendMessage(message, new SidePanelReply(resume).receive)
      },
    )
  }

  private static acknowledged(
    reply: BrowserRuntimeMessageValue,
  ): Effect.Effect<void, SidePanelRequestFailure> {
    return Schema.decodeUnknownEffect(SidePanelRuntime.ACKNOWLEDGEMENT)(
      reply,
    ).pipe(
      Effect.mapError(() => new SidePanelRequestFailure()),
      Effect.asVoid,
    )
  }

  private static panelWindow(current: chrome.windows.Window): SidePanelWindow {
    const id = current.id
    switch (typeof id) {
      case 'number':
        return { kind: SidePanelWindowKind.Known, id }
      case 'undefined':
      case 'string':
      case 'bigint':
      case 'boolean':
      case 'symbol':
      case 'object':
      case 'function':
        return { kind: SidePanelWindowKind.Unknown }
    }
  }
}
