import { Schema } from 'effect'
import { ExtensionSidePanelSignalSchema } from '../../../../nook-web-shared/src/extension/side-panel-signal-message'
import {
  SiteSidePanelOpenKind,
  type SiteSidePanelOpenResponse,
} from '../../lib/site-side-panel-messages'
import type { ExternalCompanionMessage } from './external-companion-routing'

/** The part of `chrome.sidePanel` a site page's open request needs. */
export type SiteSidePanelPort = {
  open(options: chrome.sidePanel.OpenOptions): Promise<void>
}

type SiteSidePanelOpenRequest = {
  readonly sender: chrome.runtime.MessageSender
}

/**
 * Shows the Nook side panel in the window of the site tab that asked. Chrome
 * admits `sidePanel.open` only while the page's click is a current user
 * gesture, so the call happens synchronously, before any await.
 */
export class SiteSidePanelOpening {
  private static readonly opened: SiteSidePanelOpenResponse = {
    kind: SiteSidePanelOpenKind.Opened,
  }
  private static readonly failed: SiteSidePanelOpenResponse = {
    kind: SiteSidePanelOpenKind.Failed,
  }

  constructor(private readonly sidePanel: SiteSidePanelPort) {}

  open({
    sender,
  }: SiteSidePanelOpenRequest): Promise<SiteSidePanelOpenResponse> {
    const windowId = sender.tab?.windowId
    if (
      typeof windowId !== 'number' ||
      !Number.isInteger(windowId) ||
      windowId < 0
    ) {
      return Promise.resolve(SiteSidePanelOpening.failed)
    }
    const options: chrome.sidePanel.OpenOptions = { windowId }
    return this.sidePanel.open(options).then(
      () => SiteSidePanelOpening.opened,
      () => SiteSidePanelOpening.failed,
    )
  }
}

/** The answer to the vault's open-side-panel signal, in the `{ ok }` shape
 * of the other replies on the vault-to-extension channel. */
export type ExternalSidePanelResponse =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'side-panel-failed' }

type ExternalSidePanelSignalRequest = {
  readonly message: ExternalCompanionMessage
  readonly sender: chrome.runtime.MessageSender
  readonly respond: (response: ExternalSidePanelResponse) => void
}

/**
 * The vault page's signal to show the side panel. It is handled in the
 * external listener itself, before the router's first await, because the
 * browser opens the panel only while the vault click's gesture is current.
 * The browser delivers external messages only from the manifest's Simple
 * Vault match, and the signal reveals nothing: the panel keeps its own lock.
 */
export class ExternalSidePanelSignal {
  private static readonly opened: ExternalSidePanelResponse = { ok: true }
  private static readonly failed: ExternalSidePanelResponse = {
    ok: false,
    reason: 'side-panel-failed',
  }

  constructor(private readonly opening: SiteSidePanelOpening) {}

  /** Whether the message was the signal; the panel is then opening. */
  handled(request: ExternalSidePanelSignalRequest): boolean {
    if (!Schema.is(ExtensionSidePanelSignalSchema)(request.message)) {
      return false
    }
    const opening: SiteSidePanelOpenRequest = { sender: request.sender }
    void this.opening.open(opening).then((answer) => {
      switch (answer.kind) {
        case SiteSidePanelOpenKind.Opened:
          request.respond(ExternalSidePanelSignal.opened)
          return
        case SiteSidePanelOpenKind.Failed:
          request.respond(ExternalSidePanelSignal.failed)
      }
    })
    return true
  }
}
