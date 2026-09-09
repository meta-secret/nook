import {
  type WebsiteLoginFillResponse,
  type WebsiteLoginRevealMessage,
  WebsiteLoginOptionsMessage as WebsiteLoginOptionsMessageSchema,
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

/** Owns this browser host’s resources and interaction lifecycle. */
class LoginFillRuntimeTransport {
  constructor(private readonly browser: typeof globalThis) {}

  sendLoginFillMessage(
    message: WebsiteLoginRevealMessage,
  ): Promise<LoginFillDelivery> {
    return new Promise((resolve) => {
      this.browser.chrome.runtime.sendMessage(message, (response: unknown) => {
        if (
          this.browser.chrome.runtime.lastError ||
          !response ||
          typeof response !== 'object' ||
          !WebsiteLoginOptionsMessageSchema.isWebsiteLoginFillResponse(response)
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
}

export const loginFillRuntimeTransport = new LoginFillRuntimeTransport(
  globalThis,
)
