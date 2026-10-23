import { Effect } from 'effect'
import {
  AuthenticatorPickerRequests,
  SidePanelAuthenticatorPickerKind,
  SidePanelAuthenticatorPickerMessageType,
  SidePanelAuthenticatorPickerMessages,
  type SidePanelAuthenticatorPickerMessage,
} from '../lib/side-panel-authenticator-picker'
import type { BrowserRuntimeMessageValue } from '../lib/browser-runtime-message'
import { SidePanelWindowKind, type SidePanelWindow } from './side-panel-runtime'

export enum SidePanelPickerKind {
  /** No page in this window waits for a 2FA code: This site shows. */
  None = 'none',
  Pending = 'pending',
}

export type SidePanelPicker =
  | { readonly kind: SidePanelPickerKind.None }
  | { readonly kind: SidePanelPickerKind.Pending; readonly requestId: string }

/** The runtime the panel's picker state uses; its tests supply their own. */
export type SidePanelAuthenticatorPickerRuntime = {
  readonly send: (
    message: SidePanelAuthenticatorPickerMessage,
  ) => Promise<BrowserRuntimeMessageValue>
  /** Calls back whenever a stored Fill 2FA code request changes. */
  readonly follow: (onchange: () => void) => () => void
}

export const chromeAuthenticatorPickerRuntime: SidePanelAuthenticatorPickerRuntime =
  {
    send: (message) => chrome.runtime.sendMessage(message),
    follow: (onchange) => AuthenticatorPickerRequests.follow(onchange),
  }

export type SidePanelAuthenticatorPickerStateRequest = {
  readonly panelWindow: () => SidePanelWindow
  readonly runtime: SidePanelAuthenticatorPickerRuntime
}

/**
 * Whether a page in the panel's window waits for a 2FA code. The Nook
 * Pilot's Fill 2FA code stores a request and opens the panel; the panel asks
 * the worker for its window's newest request whenever stored requests
 * change, so the picker appears, follows a newer click, and leaves once the
 * code is filled or the request is dropped.
 */
export class SidePanelAuthenticatorPickerState {
  picker = $state<SidePanelPicker>({ kind: SidePanelPickerKind.None })
  private sequence = 0

  private readonly panelWindow: () => SidePanelWindow
  private readonly runtime: SidePanelAuthenticatorPickerRuntime

  constructor(request: SidePanelAuthenticatorPickerStateRequest) {
    this.panelWindow = request.panelWindow
    this.runtime = request.runtime
  }

  async refresh(): Promise<void> {
    const panelWindow = this.panelWindow()
    if (panelWindow.kind !== SidePanelWindowKind.Known) return
    const sequence = ++this.sequence
    const message: SidePanelAuthenticatorPickerMessage = {
      type: SidePanelAuthenticatorPickerMessageType.Pending,
      payload: { windowId: panelWindow.id },
    }
    const answer = await Effect.runPromise(
      Effect.result(
        Effect.tryPromise(() => this.runtime.send(message)).pipe(
          Effect.flatMap(SidePanelAuthenticatorPickerMessages.decodeAnswer),
        ),
      ),
    )
    if (sequence !== this.sequence) return
    this.picker =
      answer._tag === 'Success' &&
      answer.success.kind === SidePanelAuthenticatorPickerKind.Pending
        ? {
            kind: SidePanelPickerKind.Pending,
            requestId: answer.success.requestId,
          }
        : { kind: SidePanelPickerKind.None }
  }

  /** Asks again whenever a stored Fill 2FA code request changes. */
  listen(): () => void {
    return this.runtime.follow(() => void this.refresh())
  }

  /** The picker finished; This site shows until the next request. */
  close(): void {
    this.sequence += 1
    this.picker = { kind: SidePanelPickerKind.None }
  }
}
