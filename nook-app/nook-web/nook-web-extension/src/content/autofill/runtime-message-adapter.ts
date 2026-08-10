import { companionWasmReady } from '../../../../nook-web-shared/src/extension/companion-ready'
import {
  decodeLoginPickerOpenResponse,
  decodeAuthenticationWorkflowSnapshotResponse,
  decodeAuthenticatorBackupAttachResponse,
  decodeAuthenticatorCodeResponse,
  decodeAuthenticatorEnrollmentConfirmResponse,
  decodeAuthenticatorEnrollmentStageResponse,
  decodeAuthenticatorOptionsResponse,
  decodeAuthenticatorPreviewResponse,
  decodeGeneratedPasswordResponse,
  decodeWebsiteLoginSaveActionResponse,
  decodeWebsiteLoginSaveOfferResponse,
  decodeWebsiteLoginSavePendingResponse,
  decodeWebsiteLoginOptions,
  type AuthenticationWorkflowSnapshotResponse,
  type AuthenticationWorkflowSnapshotResponseWire,
  type AuthenticatorBackupAttachResponse,
  type AuthenticatorBackupAttachResponseWire,
  type AuthenticatorCodeResponse,
  type AuthenticatorCodeResponseWire,
  type AuthenticatorEnrollmentConfirmResponse,
  type AuthenticatorEnrollmentConfirmResponseWire,
  type AuthenticatorEnrollmentStageResponse,
  type AuthenticatorEnrollmentStageResponseWire,
  type AuthenticatorOptionsResponse,
  type AuthenticatorOptionsResponseWire,
  type AuthenticatorPreviewResponse,
  type AuthenticatorPreviewResponseWire,
  type GeneratedPasswordResponse,
  type GeneratedPasswordResponseWire,
  type LoginPickerOpenResponse,
  type LoginPickerOpenResponseWire,
  type WebsiteLoginOptions,
  type WebsiteLoginOptionsWireValue,
  type WebsiteLoginSaveOfferResponse,
  type WebsiteLoginSaveActionResponse,
  type WebsiteLoginSavePendingResponse,
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

export type {
  AuthenticationWorkflowSnapshotResponse,
  AuthenticatorBackupAttachResponse,
  AuthenticatorCodeResponse,
  AuthenticatorEnrollmentConfirmResponse,
  AuthenticatorEnrollmentStageResponse,
  AuthenticatorOptionsResponse,
  AuthenticatorPreviewResponse,
  GeneratedPasswordResponse,
  LoginPickerOpenResponse,
  WebsiteLoginOptions,
  WebsiteLoginSaveActionResponse,
  WebsiteLoginSaveOfferResponse,
  WebsiteLoginSavePendingResponse,
}

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

export async function sendLoginSaveOfferRuntimeMessage(
  message: object,
): Promise<RuntimeMessageDelivery<WebsiteLoginSaveOfferResponse>> {
  const delivery = await sendRuntimeMessage(message)
  if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
    return unavailable()
  }
  try {
    await companionWasmReady
    const response = delivery.response as WebsiteLoginSaveOfferResponse
    return {
      kind: RuntimeMessageDeliveryKind.Delivered,
      response: decodeWebsiteLoginSaveOfferResponse(response),
    }
  } catch {
    return unavailable()
  }
}

export async function sendLoginSavePendingRuntimeMessage(
  message: object,
): Promise<RuntimeMessageDelivery<WebsiteLoginSavePendingResponse>> {
  const delivery = await sendRuntimeMessage(message)
  if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
    return unavailable()
  }
  try {
    await companionWasmReady
    const response = delivery.response as WebsiteLoginSavePendingResponse
    return {
      kind: RuntimeMessageDeliveryKind.Delivered,
      response: decodeWebsiteLoginSavePendingResponse(response),
    }
  } catch {
    return unavailable()
  }
}

export async function sendLoginSaveActionRuntimeMessage(
  message: object,
): Promise<RuntimeMessageDelivery<WebsiteLoginSaveActionResponse>> {
  const delivery = await sendRuntimeMessage(message)
  if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
    return unavailable()
  }
  try {
    await companionWasmReady
    const response = delivery.response as WebsiteLoginSaveActionResponse
    return {
      kind: RuntimeMessageDeliveryKind.Delivered,
      response: decodeWebsiteLoginSaveActionResponse(response),
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

export async function sendAuthenticationWorkflowSnapshotRuntimeMessage(
  message: object,
): Promise<RuntimeMessageDelivery<AuthenticationWorkflowSnapshotResponse>> {
  const delivery = await sendRuntimeMessage(message)
  if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
    return unavailable()
  }
  try {
    await companionWasmReady
    const responseWire =
      delivery.response as AuthenticationWorkflowSnapshotResponseWire
    return {
      kind: RuntimeMessageDeliveryKind.Delivered,
      response: decodeAuthenticationWorkflowSnapshotResponse(responseWire),
    }
  } catch {
    return unavailable()
  }
}

export async function sendAuthenticatorPreviewRuntimeMessage(
  message: object,
): Promise<RuntimeMessageDelivery<AuthenticatorPreviewResponse>> {
  const delivery = await sendRuntimeMessage(message)
  if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
    return unavailable()
  }
  try {
    await companionWasmReady
    const responseWire = delivery.response as AuthenticatorPreviewResponseWire
    return {
      kind: RuntimeMessageDeliveryKind.Delivered,
      response: decodeAuthenticatorPreviewResponse(responseWire),
    }
  } catch {
    return unavailable()
  }
}

export async function sendAuthenticatorBackupAttachRuntimeMessage(
  message: object,
): Promise<RuntimeMessageDelivery<AuthenticatorBackupAttachResponse>> {
  const delivery = await sendRuntimeMessage(message)
  if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
    return unavailable()
  }
  try {
    await companionWasmReady
    const responseWire =
      delivery.response as AuthenticatorBackupAttachResponseWire
    return {
      kind: RuntimeMessageDeliveryKind.Delivered,
      response: decodeAuthenticatorBackupAttachResponse(responseWire),
    }
  } catch {
    return unavailable()
  }
}

export async function sendAuthenticatorCodeRuntimeMessage(
  message: object,
): Promise<RuntimeMessageDelivery<AuthenticatorCodeResponse>> {
  const delivery = await sendRuntimeMessage(message)
  if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
    return unavailable()
  }
  try {
    await companionWasmReady
    const responseWire = delivery.response as AuthenticatorCodeResponseWire
    return {
      kind: RuntimeMessageDeliveryKind.Delivered,
      response: decodeAuthenticatorCodeResponse(responseWire),
    }
  } catch {
    return unavailable()
  }
}

export async function sendAuthenticatorOptionsRuntimeMessage(
  message: object,
): Promise<RuntimeMessageDelivery<AuthenticatorOptionsResponse>> {
  const delivery = await sendRuntimeMessage(message)
  if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
    return unavailable()
  }
  try {
    await companionWasmReady
    const responseWire = delivery.response as AuthenticatorOptionsResponseWire
    return {
      kind: RuntimeMessageDeliveryKind.Delivered,
      response: decodeAuthenticatorOptionsResponse(responseWire),
    }
  } catch {
    return unavailable()
  }
}

export async function sendAuthenticatorEnrollmentStageRuntimeMessage(
  message: object,
): Promise<RuntimeMessageDelivery<AuthenticatorEnrollmentStageResponse>> {
  const delivery = await sendRuntimeMessage(message)
  if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
    return unavailable()
  }
  try {
    await companionWasmReady
    const responseWire =
      delivery.response as AuthenticatorEnrollmentStageResponseWire
    return {
      kind: RuntimeMessageDeliveryKind.Delivered,
      response: decodeAuthenticatorEnrollmentStageResponse(responseWire),
    }
  } catch {
    return unavailable()
  }
}

export async function sendAuthenticatorEnrollmentConfirmRuntimeMessage(
  message: object,
): Promise<RuntimeMessageDelivery<AuthenticatorEnrollmentConfirmResponse>> {
  const delivery = await sendRuntimeMessage(message)
  if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
    return unavailable()
  }
  try {
    await companionWasmReady
    const responseWire =
      delivery.response as AuthenticatorEnrollmentConfirmResponseWire
    return {
      kind: RuntimeMessageDeliveryKind.Delivered,
      response: decodeAuthenticatorEnrollmentConfirmResponse(responseWire),
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
  try {
    await companionWasmReady
    const responseWire = delivery.response as GeneratedPasswordResponseWire
    return {
      kind: RuntimeMessageDeliveryKind.Delivered,
      response: decodeGeneratedPasswordResponse(responseWire),
    }
  } catch {
    return unavailable()
  }
}

export function sendRuntimeMessageWithoutResponse(message: object): void {
  void sendRuntimeMessage(message)
}
