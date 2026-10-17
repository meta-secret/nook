import { SIDE_PANEL_PAGE_PATH } from '../../lib/side-panel-page-path'

export enum SidePanelSenderAdmission {
  Admitted = 'admitted',
  Forbidden = 'forbidden',
}

/**
 * Recognizes the side-panel document. Chrome reports its messages with only
 * this extension's id, its exact page URL and origin; any tab-hosted document,
 * including the panel page opened in a tab, carries a tab, frame and document
 * identity, and content scripts carry the page's URL. The page is not
 * web-accessible, so no website can frame it.
 */
export class SidePanelSender {
  constructor(private readonly sender: chrome.runtime.MessageSender) {}

  admission(): SidePanelSenderAdmission {
    const runtime = chrome.runtime
    const panelDocument =
      this.sender.id === runtime.id &&
      this.sender.url === runtime.getURL(SIDE_PANEL_PAGE_PATH) &&
      !('tab' in this.sender) &&
      !('frameId' in this.sender) &&
      !('documentId' in this.sender)
    switch (panelDocument) {
      case true:
        return SidePanelSenderAdmission.Admitted
      case false:
        return SidePanelSenderAdmission.Forbidden
    }
  }
}
