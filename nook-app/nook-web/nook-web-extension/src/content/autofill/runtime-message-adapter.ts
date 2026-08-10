import { companionWasmReady } from '../../../../nook-web-shared/src/extension/companion-ready'
import {
  decodeLoginPickerOpenResponse,
  decodeWebsiteLoginOptions,
  type LoginPickerOpenResponse,
  type LoginPickerOpenResponseWire,
  type WebsiteLoginOptions,
  type WebsiteLoginOptionsWireValue,
  type AuthenticationOutcomeDecision,
  validateCompanionAuthenticationOutcomeDecision,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type { AuthenticationOutcomeResponse } from '../../lib/outcome-evidence-messages'

export enum RuntimeMessageDeliveryKind {
  Delivered = 'delivered',
  Unavailable = 'unavailable',
}

export type RuntimeMessageDelivery<Response> =
  | { kind: RuntimeMessageDeliveryKind.Delivered; response: Response }
  | { kind: RuntimeMessageDeliveryKind.Unavailable }

export type GeneratedPasswordResponse =
  { ok: true; password: string } | { ok: false; reason: string }

function sendRuntimeMessage(
  message: unknown,
): Promise<RuntimeMessageDelivery<unknown>> {
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
        response,
      }
      resolve(delivered)
    })
  })
}

export type RuntimeMessageResponseDecoder<Response extends object> = (
  response: object,
) => response is Response

export type DecodedRuntimeMessageArgs<Response extends object> = {
  message: unknown
  decode: RuntimeMessageResponseDecoder<Response>
}

export async function sendDecodedRuntimeMessage<Response extends object>({
  message,
  decode,
}: DecodedRuntimeMessageArgs<Response>): Promise<
  RuntimeMessageDelivery<Response>
> {
  const delivery = await sendRuntimeMessage(message)
  if (
    delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
    !delivery.response ||
    typeof delivery.response !== 'object'
  ) {
    return unavailable()
  }
  return decode(delivery.response)
    ? {
        kind: RuntimeMessageDeliveryKind.Delivered,
        response: delivery.response,
      }
    : unavailable()
}

function unavailable<Response>(): RuntimeMessageDelivery<Response> {
  return { kind: RuntimeMessageDeliveryKind.Unavailable }
}

export async function sendLoginOptionsRuntimeMessage(
  message: object,
): Promise<RuntimeMessageDelivery<WebsiteLoginOptions>> {
  const delivery = await sendRuntimeMessage(message)
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
  const delivery = await sendRuntimeMessage(message)
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

export async function sendAuthenticationOutcomeRuntimeMessage(
  message: object,
): Promise<RuntimeMessageDelivery<AuthenticationOutcomeResponse>> {
  const delivery = await sendRuntimeMessage(message)
  if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
    return unavailable()
  }
  const { response } = delivery
  if (
    !response ||
    typeof response !== 'object' ||
    !('ok' in response) ||
    response.ok !== true ||
    !('verdict' in response) ||
    !response.verdict ||
    typeof response.verdict !== 'object'
  ) {
    return unavailable()
  }
  try {
    await companionWasmReady
    const verdict = validateCompanionAuthenticationOutcomeDecision(
      response.verdict as AuthenticationOutcomeDecision,
    )
    return {
      kind: RuntimeMessageDeliveryKind.Delivered,
      response: { ok: true, verdict },
    }
  } catch {
    return unavailable()
  }
}

export async function sendGeneratePasswordRuntimeMessage(
  message: object,
): Promise<RuntimeMessageDelivery<GeneratedPasswordResponse>> {
  const delivery = await sendRuntimeMessage(message)
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
  void sendRuntimeMessage(message)
}
