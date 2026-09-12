type AccountPickerPageMessageDelivery = {
  tabId: number
  frameId: number
  // eslint-disable-next-line @typescript-eslint/no-restricted-types -- Foreign browser data is narrowed at this adapter boundary.
  message: unknown
}

type AccountPickerPageSenderMatch = {
  tabId: number
  frameId: number
  sender: chrome.runtime.MessageSender
}

/** Owns the browser page and frame identity used by account-picker messages. */
export class AccountPickerPageTarget {
  static senderFrameId(sender: chrome.runtime.MessageSender): number {
    return typeof sender.frameId === 'number' &&
      Number.isInteger(sender.frameId) &&
      sender.frameId >= 0
      ? sender.frameId
      : 0
  }

  static matchesSender({
    tabId,
    frameId,
    sender,
  }: AccountPickerPageSenderMatch): boolean {
    return (
      !!sender.tab &&
      'id' in sender.tab &&
      sender.tab.id === tabId &&
      AccountPickerPageTarget.senderFrameId(sender) === frameId
    )
  }

  static send({
    tabId,
    frameId,
    message,
    // eslint-disable-next-line @typescript-eslint/no-restricted-types -- Foreign browser data is narrowed at this adapter boundary.
  }: AccountPickerPageMessageDelivery): Promise<unknown> {
    const options: chrome.tabs.MessageSendOptions = { frameId }
    return chrome.tabs.sendMessage(tabId, message, options)
  }
}
