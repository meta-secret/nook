import { companionWasmReady } from '../../../../nook-web-shared/src/extension/companion-ready'
import type { GeneratePasswordRequest } from '../../../../nook-web-shared/src/extension/runtime-messages'
import type { AuthenticationWorkflowSnapshotMessage } from '../../lib/auth-workflow-messages'
import type {
  AuthenticatorPickerCancelMessage,
  WebsiteAuthenticatorPickerOpenMessage,
} from '../../lib/authenticator-picker-messages'
import type {
  WebsiteAuthenticatorBackupAttachMessage,
  WebsiteAuthenticatorEnrollCodeMessage,
  WebsiteAuthenticatorEnrollConfirmMessage,
  WebsiteAuthenticatorEnrollDismissMessage,
  WebsiteAuthenticatorEnrollPreviewMessage,
  WebsiteAuthenticatorEnrollStageMessage,
} from '../../lib/enrollment-messages'
import type {
  WebsiteAuthenticatorFillMessage,
  WebsiteAuthenticatorOptionsMessage,
  WebsiteLoginOptionsMessage,
} from '../../lib/login-fill-messages'
import type {
  LoginPickerCancelMessage,
  WebsiteLoginPickerOpenMessage,
} from '../../lib/login-picker-messages'
import type {
  WebsiteLoginSaveCommitMessage,
  WebsiteLoginSaveDismissMessage,
  WebsiteLoginSaveOfferMessage,
  WebsiteLoginSavePendingMessage,
} from '../../lib/login-save-messages'
import type { AuthenticationOutcomeClassifyMessage } from '../../lib/outcome-evidence-messages'
import {
  decodeLoginPickerOpenResponse,
  decodeAuthenticatorPickerOpenResponse,
  decodeAuthenticationOutcomeResponse,
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
  type AuthenticatorPickerOpenResponse,
  type AuthenticatorPickerOpenResponseWire,
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
  type AuthenticationOutcomeResponse,
  type AuthenticationOutcomeResponseWire,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export enum RuntimeMessageDeliveryKind {
  Delivered = 'delivered',
  Unavailable = 'unavailable',
}

export type RuntimeMessageDelivery<Response> =
  | { kind: RuntimeMessageDeliveryKind.Delivered; response: Response }
  | { kind: RuntimeMessageDeliveryKind.Unavailable }

export type ExtensionRuntimeRequest =
  | AuthenticationOutcomeClassifyMessage
  | AuthenticationWorkflowSnapshotMessage
  | AuthenticatorPickerCancelMessage
  | GeneratePasswordRequest
  | WebsiteAuthenticatorBackupAttachMessage
  | WebsiteAuthenticatorEnrollCodeMessage
  | WebsiteAuthenticatorEnrollConfirmMessage
  | WebsiteAuthenticatorEnrollDismissMessage
  | WebsiteAuthenticatorEnrollPreviewMessage
  | WebsiteAuthenticatorEnrollStageMessage
  | WebsiteAuthenticatorPickerOpenMessage
  | WebsiteAuthenticatorFillMessage
  | WebsiteAuthenticatorOptionsMessage
  | WebsiteLoginOptionsMessage
  | LoginPickerCancelMessage
  | WebsiteLoginPickerOpenMessage
  | WebsiteLoginSaveCommitMessage
  | WebsiteLoginSaveDismissMessage
  | WebsiteLoginSaveOfferMessage
  | WebsiteLoginSavePendingMessage

export type {
  AuthenticationWorkflowSnapshotResponse,
  AuthenticatorBackupAttachResponse,
  AuthenticatorCodeResponse,
  AuthenticatorEnrollmentConfirmResponse,
  AuthenticatorEnrollmentStageResponse,
  AuthenticatorOptionsResponse,
  AuthenticatorPickerOpenResponse,
  AuthenticatorPreviewResponse,
  GeneratedPasswordResponse,
  LoginPickerOpenResponse,
  WebsiteLoginOptions,
  WebsiteLoginSaveActionResponse,
  WebsiteLoginSaveOfferResponse,
  WebsiteLoginSavePendingResponse,
  AuthenticationOutcomeResponse,
}

function sendRuntimeMessage(
  message: ExtensionRuntimeRequest,
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

export type RuntimeMessageResponseDecoder<Response> = (
  response: unknown,
) => response is Response

export type DecodedRuntimeMessageArgs<Response> = {
  message: ExtensionRuntimeRequest
  decode: RuntimeMessageResponseDecoder<Response>
}

export async function sendDecodedRuntimeMessage<Response>({
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
  message: WebsiteLoginOptionsMessage,
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
  message: WebsiteLoginSaveOfferMessage,
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
  message: WebsiteLoginSavePendingMessage,
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
  message: WebsiteLoginSaveCommitMessage | WebsiteLoginSaveDismissMessage,
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
  message: WebsiteLoginPickerOpenMessage,
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

export async function sendAuthenticatorPickerOpenRuntimeMessage(
  message: WebsiteAuthenticatorPickerOpenMessage,
): Promise<RuntimeMessageDelivery<AuthenticatorPickerOpenResponse>> {
  const delivery = await sendRuntimeMessage(message)
  if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
    return unavailable()
  }
  try {
    await companionWasmReady
    const responseWire =
      delivery.response as AuthenticatorPickerOpenResponseWire
    return {
      kind: RuntimeMessageDeliveryKind.Delivered,
      response: decodeAuthenticatorPickerOpenResponse(responseWire),
    }
  } catch {
    return unavailable()
  }
}

export async function sendAuthenticationWorkflowSnapshotRuntimeMessage(
  message: AuthenticationWorkflowSnapshotMessage,
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
  message: WebsiteAuthenticatorEnrollPreviewMessage,
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
  message: WebsiteAuthenticatorBackupAttachMessage,
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
  message:
    WebsiteAuthenticatorEnrollCodeMessage | WebsiteAuthenticatorFillMessage,
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
  message: WebsiteAuthenticatorOptionsMessage,
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
  message: WebsiteAuthenticatorEnrollStageMessage,
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
  message: WebsiteAuthenticatorEnrollConfirmMessage,
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
  message: AuthenticationOutcomeClassifyMessage,
): Promise<RuntimeMessageDelivery<AuthenticationOutcomeResponse>> {
  const delivery = await sendRuntimeMessage(message)
  if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
    return unavailable()
  }
  try {
    await companionWasmReady
    const responseWire = delivery.response as AuthenticationOutcomeResponseWire
    return {
      kind: RuntimeMessageDeliveryKind.Delivered,
      response: decodeAuthenticationOutcomeResponse(responseWire),
    }
  } catch {
    return unavailable()
  }
}

export async function sendGeneratePasswordRuntimeMessage(
  message: GeneratePasswordRequest,
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

export function sendRuntimeMessageWithoutResponse(
  message: ExtensionRuntimeRequest,
): void {
  void sendRuntimeMessage(message)
}
