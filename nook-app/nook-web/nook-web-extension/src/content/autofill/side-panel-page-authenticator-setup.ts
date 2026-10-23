import type { BrowserRuntimeMessageValue } from '../../lib/browser-runtime-message'
import {
  SidePanelAuthenticatorSetupMessageType,
  SidePanelAuthenticatorSetupMessages,
  SidePanelPageAddAuthenticatorReplyKind,
  type SidePanelPageAddAuthenticatorReply,
  type SidePanelPageChangedMessage,
} from '../../lib/side-panel-authenticator-setup'
import type { AuthenticationAuthenticatorSetupObservation } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  SidePanelPageSender,
  SidePanelPageSenderAdmission,
} from './side-panel-page-sender'
import { authenticationRuntimeTransport } from './runtime-message-adapter'

/** Starts the page widget's consented Add 2FA ceremony, if it offers one. */
export interface SidePanelEnrollmentStarter {
  startFromSidePanel(): Promise<boolean>
}

export enum SidePanelPageAddAuthenticatorReception {
  Ignored = 'ignored',
  Responding = 'responding',
}

export interface SidePanelPageAddAuthenticatorDelivery {
  readonly message: BrowserRuntimeMessageValue
  readonly sender: chrome.runtime.MessageSender
  readonly sendResponse: (reply: SidePanelPageAddAuthenticatorReply) => void
}

/**
 * Answers the worker's Add 2FA trigger in the top document. It starts the
 * enrollment the page widget offers, so the QR code or setup key is read only
 * by that ceremony and saved only after the user confirms in the widget. The
 * reply carries no secret.
 */
export class SidePanelPageAddAuthenticatorReceiver {
  constructor(private readonly starter: SidePanelEnrollmentStarter) {}

  receive(
    delivery: SidePanelPageAddAuthenticatorDelivery,
  ): SidePanelPageAddAuthenticatorReception {
    switch (
      SidePanelAuthenticatorSetupMessages.matchesPageAdd(delivery.message)._tag
    ) {
      case 'Failure':
        return SidePanelPageAddAuthenticatorReception.Ignored
      case 'Success':
        break
    }
    switch (new SidePanelPageSender(delivery.sender).admission()) {
      case SidePanelPageSenderAdmission.OtherContext:
        return SidePanelPageAddAuthenticatorReception.Ignored
      case SidePanelPageSenderAdmission.OwnTopDocument:
        break
    }
    const decoded = SidePanelAuthenticatorSetupMessages.decodePageAdd(
      delivery.message,
    )
    switch (decoded._tag) {
      case 'Failure':
        return this.answer(delivery)(
          SidePanelPageAddAuthenticatorReplyKind.NoSetup,
        )
      case 'Success':
        break
    }
    switch (decoded.success.payload.origin === location.origin) {
      case false:
        return this.answer(delivery)(
          SidePanelPageAddAuthenticatorReplyKind.TabChanged,
        )
      case true:
        break
    }
    void this.starter
      .startFromSidePanel()
      .then((started) =>
        started
          ? SidePanelPageAddAuthenticatorReplyKind.Started
          : SidePanelPageAddAuthenticatorReplyKind.NoSetup,
      )
      .catch(() => SidePanelPageAddAuthenticatorReplyKind.NoSetup)
      .then(this.answer(delivery))
    return SidePanelPageAddAuthenticatorReception.Responding
  }

  /** Answers one admitted trigger; the reply names only its kind. */
  private answer(
    delivery: SidePanelPageAddAuthenticatorDelivery,
  ): (
    kind: SidePanelPageAddAuthenticatorReplyKind,
  ) => SidePanelPageAddAuthenticatorReception {
    return (kind) => {
      const reply: SidePanelPageAddAuthenticatorReply = { kind }
      delivery.sendResponse(reply)
      return SidePanelPageAddAuthenticatorReception.Responding
    }
  }
}

/**
 * Tells an open side panel to list the page again when the page starts or
 * stops showing an authenticator setup, as when a settings page opens its
 * setup dialog after load. The notice carries no page content.
 */
class SidePanelPageChangeNotice {
  private last: AuthenticationAuthenticatorSetupObservation = 'absent'
  private static readonly message: SidePanelPageChangedMessage = {
    type: SidePanelAuthenticatorSetupMessageType.PageChanged,
  }

  observe(setup: AuthenticationAuthenticatorSetupObservation): void {
    if (setup === this.last || window !== window.top) return
    this.last = setup
    authenticationRuntimeTransport.sendRuntimeMessageWithoutResponse(
      SidePanelPageChangeNotice.message,
    )
  }
}

export const sidePanelPageChangeNotice = new SidePanelPageChangeNotice()
