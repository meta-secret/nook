import type { WebsiteAuthenticatorSelectedMessage } from '../../lib/authenticator-picker-messages'
import type { WebsiteAuthenticatorCanceledMessage } from '../../lib/authenticator-picker-messages'
import type { WebsiteLoginCanceledMessage } from '../../lib/login-picker-messages'
import type { WebsiteLoginSelectedMessage } from '../../lib/login-picker-messages'

export type AccountPickerPageMessage =
  | WebsiteAuthenticatorSelectedMessage
  | WebsiteAuthenticatorCanceledMessage
  | WebsiteLoginSelectedMessage
  | WebsiteLoginCanceledMessage

type AccountPickerPageResponse = { ok: true } | { ok: false; reason: string }

// Preserve Chrome's document targeting at this outgoing browser boundary.
type AccountPickerPageMessageDelivery = chrome.tabs.MessageSendOptions & {
  tabId: number
  frameId: number
  message: AccountPickerPageMessage
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
    message,
    ...options
  }: AccountPickerPageMessageDelivery): Promise<AccountPickerPageResponse> {
    return chrome.tabs.sendMessage(
      tabId,
      message,
      options,
    ) as Promise<AccountPickerPageResponse>
  }
}
