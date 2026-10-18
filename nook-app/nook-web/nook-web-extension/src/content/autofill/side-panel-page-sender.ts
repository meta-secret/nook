/** Whether a side-panel page request reached this document from the worker. */
export enum SidePanelPageSenderAdmission {
  /** This extension's runtime message, received by the top document. */
  OwnTopDocument = 'own-top-document',
  OtherContext = 'other-context',
}

/**
 * The service worker sends side-panel page requests to frame 0 only. A
 * request from another sender, or one a subframe receives, is not admitted.
 */
export class SidePanelPageSender {
  constructor(private readonly sender: chrome.runtime.MessageSender) {}

  admission(): SidePanelPageSenderAdmission {
    const ownTopDocument =
      this.sender.id === chrome.runtime.id && window === window.top
    switch (ownTopDocument) {
      case true:
        return SidePanelPageSenderAdmission.OwnTopDocument
      case false:
        return SidePanelPageSenderAdmission.OtherContext
    }
  }
}
