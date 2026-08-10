import { companionWasmReady } from '../../../../nook-web-shared/src/extension/companion-ready'
import {
  decodeLoginPickerOpenResponse,
  decodeWebsiteLoginOptions,
  type LoginPickerOpenResponse,
  type LoginPickerOpenResponseWire,
  type WebsiteLoginOptions,
  type WebsiteLoginOptionsWireValue,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export enum RuntimeMessageDeliveryKind {
  Delivered = 'delivered',
  Unavailable = 'unavailable',
}

export type RuntimeMessageDelivery<Response> =
  | { kind: RuntimeMessageDeliveryKind.Delivered; response: Response }
  | { kind: RuntimeMessageDeliveryKind.Unavailable }

export type GeneratedPasswordResponse =
  { ok: true; password: string } | { ok: false; reason: string }

export function sendRuntimeMessage<Response>(
  message: unknown,
): Promise<RuntimeMessageDelivery<Response>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: unknown) => {
      if (chrome.runtime.lastError) {
        const unavailable: Parameters<typeof resolve>[0] = {
          kind: RuntimeMessageDeliveryKind.Unavailable,
        }
        resolve(unavailable)
        return
      }
      const delivered: Parameters<typeof resolve>[0] = {
        kind: RuntimeMessageDeliveryKind.Delivered,
        response: response as Response,
      }
      resolve(delivered)
    })
  })
}

function unavailable<Response>(): RuntimeMessageDelivery<Response> {
  return { kind: RuntimeMessageDeliveryKind.Unavailable }
}

export async function sendLoginOptionsRuntimeMessage(
  message: object,
): Promise<RuntimeMessageDelivery<WebsiteLoginOptions>> {
  const delivery = await sendRuntimeMessage<unknown>(message)
  if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
    return unavailable()
  }
  try {
    await companionWasmReady
    const responseWire = delivery.response as WebsiteLoginOptionsWireValue
    return {
      kind: RuntimeMessageDeliveryKind.Delivered,
      response: decodeWebsiteLoginOptions(responseWire),
    }
  } catch {
    return unavailable()
  }
}

export async function sendLoginPickerOpenRuntimeMessage(
  message: object,
): Promise<RuntimeMessageDelivery<LoginPickerOpenResponse>> {
  const delivery = await sendRuntimeMessage<unknown>(message)
  if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
    return unavailable()
  }
  try {
    await companionWasmReady
    const responseWire = delivery.response as LoginPickerOpenResponseWire
    return {
      kind: RuntimeMessageDeliveryKind.Delivered,
      response: decodeLoginPickerOpenResponse(responseWire),
    }
  } catch {
    return unavailable()
  }
}

export async function sendGeneratePasswordRuntimeMessage(
  message: object,
): Promise<RuntimeMessageDelivery<GeneratedPasswordResponse>> {
  const delivery = await sendRuntimeMessage<unknown>(message)
  if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
    return unavailable()
  }
  const response = delivery.response
  if (!response || typeof response !== 'object' || !('ok' in response)) {
    return unavailable()
  }
  if (
    response.ok === true &&
    'password' in response &&
    typeof response.password === 'string'
  ) {
    return {
      kind: RuntimeMessageDeliveryKind.Delivered,
      response: { ok: true, password: response.password },
    }
  }
  if (response.ok === false) {
    const reason =
      'reason' in response && typeof response.reason === 'string'
        ? response.reason
        : 'password-generation-failed'
    return {
      kind: RuntimeMessageDeliveryKind.Delivered,
      response: { ok: false, reason },
    }
  }
  return unavailable()
}

export function sendRuntimeMessageWithoutResponse(message: object): void {
  void sendRuntimeMessage<unknown>(message)
}
