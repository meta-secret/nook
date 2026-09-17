import {
  type WebsiteLoginFillResponse,
  type WebsiteLoginRevealMessage,
  WebsiteLoginOptionsMessage as WebsiteLoginOptionsMessageSchema,
} from '../../lib/login-fill-messages'
import {
  ConcreteDecoderResultKind,
  runConcreteDecoder,
} from '../../lib/concrete-decoder'

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
        if (this.browser.chrome.runtime.lastError) {
          const unavailable: LoginFillDelivery = {
            kind: LoginFillDeliveryKind.Unavailable,
          }
          resolve(unavailable)
          return
        }
        const decoded = runConcreteDecoder(
          WebsiteLoginOptionsMessageSchema.decodeWebsiteLoginFillResponse,
          response,
        )
        if (decoded.kind === ConcreteDecoderResultKind.Rejected) {
          const unavailable: LoginFillDelivery = {
            kind: LoginFillDeliveryKind.Unavailable,
          }
          resolve(unavailable)
          return
        }
        const delivered: LoginFillDelivery = {
          kind: LoginFillDeliveryKind.Delivered,
          response: decoded.value,
        }
        resolve(delivered)
      })
    })
  }
}

export const loginFillRuntimeTransport = new LoginFillRuntimeTransport(
  globalThis,
)
