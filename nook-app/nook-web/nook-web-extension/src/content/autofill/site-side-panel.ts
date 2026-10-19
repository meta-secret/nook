import {
  SiteSidePanelOpenMessageType,
  type SiteSidePanelOpenMessage,
} from '../../lib/site-side-panel-messages'
import { authenticationRuntimeTransport } from './runtime-message-adapter'

/**
 * Shows the Nook side panel beside this site, where the user unlocks Nook and
 * then fills a login. Chrome opens it only during a click on the page, so
 * callers ask from a click handler or right after a click's lookup.
 */
export class SiteSidePanel {
  private static readonly message: SiteSidePanelOpenMessage = {
    type: SiteSidePanelOpenMessageType.NookSiteSidePanelOpen,
  }

  static open(): void {
    authenticationRuntimeTransport.sendRuntimeMessageWithoutResponse(
      SiteSidePanel.message,
    )
  }
}
