import { companionWasmReady } from '../../../../nook-web-shared/src/extension/companion-ready'
import {
  decodeWebsiteLoginOptionsJson,
  type WebsiteLoginOptions,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  type LoginPickerOpenResponse,
  LoginPickerOpenResponseStatus,
} from './workflow-ui'

export enum RuntimeMessageDeliveryKind {
  Delivered = 'delivered',
  Unavailable = 'unavailable',
}

export type RuntimeMessageDelivery<Response> =
  | { kind: RuntimeMessageDeliveryKind.Delivered; response: Response }
  | { kind: RuntimeMessageDeliveryKind.Unavailable }

export type GeneratedPasswordResponse =
  { ok: true; password: string } | { ok: false; reason: string }

function isLoginPickerOpenResponseStatus(
  status: string,
): status is LoginPickerOpenResponseStatus {
  switch (status) {
    case LoginPickerOpenResponseStatus.Ready:
    case LoginPickerOpenResponseStatus.Locked:
    case LoginPickerOpenResponseStatus.Unavailable:
      return true
    default:
      return false
  }
}

export function sendRuntimeMessage<Response>(
  message: object,
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
    const serialized = JSON.stringify(delivery.response)
    if (typeof serialized !== 'string') return unavailable()
    return {
      kind: RuntimeMessageDeliveryKind.Delivered,
      response: decodeWebsiteLoginOptionsJson(serialized),
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
  const response = delivery.response
  if (!response || typeof response !== 'object' || !('ok' in response)) {
    return unavailable()
  }
  if (response.ok === false) {
    return {
      kind: RuntimeMessageDeliveryKind.Delivered,
      response: { ok: false },
    }
  }
  if (
    response.ok !== true ||
    !('status' in response) ||
    typeof response.status !== 'string' ||
    !isLoginPickerOpenResponseStatus(response.status)
  ) {
    return unavailable()
  }
  if (
    'requestId' in response &&
    'expiresAt' in response &&
    typeof response.requestId === 'string' &&
    typeof response.expiresAt === 'number' &&
    Number.isFinite(response.expiresAt)
  ) {
    return {
      kind: RuntimeMessageDeliveryKind.Delivered,
      response: {
        ok: true,
        status: response.status,
        requestId: response.requestId,
        expiresAt: response.expiresAt,
      },
    }
  }
  return {
    kind: RuntimeMessageDeliveryKind.Delivered,
    response: {
      ok: true,
      status: response.status,
    },
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
