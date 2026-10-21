import {
  SiteSidePanelOpenKind,
  type SiteSidePanelOpenResponse,
} from '../../lib/site-side-panel-messages'

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
