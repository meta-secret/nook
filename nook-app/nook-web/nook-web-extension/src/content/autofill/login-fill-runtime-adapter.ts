import {
  isWebsiteLoginFillResponse,
  type WebsiteLoginFillResponse,
  type WebsiteLoginRevealMessage,
} from '../../lib/login-fill-messages'

export enum LoginFillDeliveryKind {
  Delivered = 'delivered',
  Unavailable = 'unavailable',
}

export type LoginFillDelivery =
  | {
      kind: LoginFillDeliveryKind.Delivered
      response: WebsiteLoginFillResponse
    }
  | { kind: LoginFillDeliveryKind.Unavailable }

export function sendLoginFillMessage(
  message: WebsiteLoginRevealMessage,
): Promise<LoginFillDelivery> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: unknown) => {
      if (
        chrome.runtime.lastError ||
        !response ||
        typeof response !== 'object' ||
        !isWebsiteLoginFillResponse(response)
      ) {
        const unavailable: LoginFillDelivery = {
          kind: LoginFillDeliveryKind.Unavailable,
        }
        resolve(unavailable)
        return
      }
      const delivered: LoginFillDelivery = {
        kind: LoginFillDeliveryKind.Delivered,
        response,
      }
      resolve(delivered)
    })
  })
}
