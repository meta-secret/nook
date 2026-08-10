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
  decodeWebsiteLoginOptions,
  type AuthenticationWorkflowSnapshot,
  AuthenticationWorkflowSnapshotResponseKind,
  type AuthenticationWorkflowSnapshotResponseWire,
  AuthenticatorBackupAttachResponseKind,
  type AuthenticatorBackupAttachResponseWire,
  AuthenticatorCodeResponseKind,
  type AuthenticatorCodeResponseWire,
  AuthenticatorEnrollmentConfirmResponseKind,
  type AuthenticatorEnrollmentConfirmResponseWire,
  AuthenticatorEnrollmentStageResponseKind,
  type AuthenticatorEnrollmentStageResponseWire,
  AuthenticatorOptionsResponseKind,
  type AuthenticatorOptionsResponseWire,
  type AuthenticatorEnrollmentPreview,
  AuthenticatorPreviewResponseKind,
  type AuthenticatorPreviewResponseWire,
  GeneratedPasswordResponseKind,
  type GeneratedPasswordResponseWire,
  LoginPickerOpenResponseKind,
  type LoginPickerOpenResponseWire,
  type WebsiteLoginAccountOption,
  WebsiteLoginOptionsKind,
  type WebsiteLoginOptionsWireValue,
  type WebsiteAuthenticatorOption as CompanionWebsiteAuthenticatorOption,
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

export type WebsiteLoginOptions =
  | {
      kind: WebsiteLoginOptionsKind.Ready
      accounts: WebsiteLoginAccountOption[]
    }
  | { kind: WebsiteLoginOptionsKind.Locked }
  | { kind: WebsiteLoginOptionsKind.Unavailable }
  | { kind: WebsiteLoginOptionsKind.Rejected; reason: string }

export type LoginPickerOpenResponse =
  | { kind: LoginPickerOpenResponseKind.Failed }
  | {
      kind: LoginPickerOpenResponseKind.Ready
      requestId: string
      expiresAt: number
    }
  | { kind: LoginPickerOpenResponseKind.Locked }
  | { kind: LoginPickerOpenResponseKind.Unavailable }

export type AuthenticationWorkflowSnapshotResponse =
  | {
      kind: AuthenticationWorkflowSnapshotResponseKind.Matched
      snapshot: AuthenticationWorkflowSnapshot
    }
  | { kind: AuthenticationWorkflowSnapshotResponseKind.NoMatch }
  | {
      kind: AuthenticationWorkflowSnapshotResponseKind.Rejected
      reason: string
    }

export type AuthenticatorPreviewResponse =
  | {
      kind: AuthenticatorPreviewResponseKind.Ready
      preview: AuthenticatorEnrollmentPreview
      vaultStoreId: string
    }
  | { kind: AuthenticatorPreviewResponseKind.Unavailable }
  | {
      kind: AuthenticatorPreviewResponseKind.Rejected
      reason: string
    }

export type AuthenticatorBackupAttachResponse =
  | { kind: AuthenticatorBackupAttachResponseKind.Completed }
  | {
      kind: AuthenticatorBackupAttachResponseKind.Rejected
      reason: string
    }

export type AuthenticatorCodeResponse =
  | { kind: AuthenticatorCodeResponseKind.Ready; code: string }
  | { kind: AuthenticatorCodeResponseKind.Rejected; reason: string }

export type AuthenticatorOptionsResponse =
  | {
      kind: AuthenticatorOptionsResponseKind.Ready
      accounts: CompanionWebsiteAuthenticatorOption[]
    }
  | { kind: AuthenticatorOptionsResponseKind.Locked }
  | { kind: AuthenticatorOptionsResponseKind.Unavailable }
  | { kind: AuthenticatorOptionsResponseKind.Rejected; reason: string }

export type AuthenticatorEnrollmentStageResponse =
  | {
      kind: AuthenticatorEnrollmentStageResponseKind.Staged
      stageId: string
    }
  | {
      kind: AuthenticatorEnrollmentStageResponseKind.Rejected
      reason: string
    }

export type AuthenticatorEnrollmentConfirmResponse =
  | {
      kind: AuthenticatorEnrollmentConfirmResponseKind.Completed
      secretId: string
    }
  | {
      kind: AuthenticatorEnrollmentConfirmResponseKind.Rejected
      reason: string
    }

export type GeneratedPasswordResponse =
  | { kind: GeneratedPasswordResponseKind.Generated; password: string }
  | { kind: GeneratedPasswordResponseKind.Rejected; reason: string }

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
      response: decodeWebsiteLoginOptions(responseWire) as WebsiteLoginOptions,
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
      response: decodeLoginPickerOpenResponse(
        responseWire,
      ) as LoginPickerOpenResponse,
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
      response: decodeAuthenticationWorkflowSnapshotResponse(
        responseWire,
      ) as AuthenticationWorkflowSnapshotResponse,
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
      response: decodeAuthenticatorPreviewResponse(
        responseWire,
      ) as AuthenticatorPreviewResponse,
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
      response: decodeAuthenticatorBackupAttachResponse(
        responseWire,
      ) as AuthenticatorBackupAttachResponse,
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
      response: decodeAuthenticatorCodeResponse(
        responseWire,
      ) as AuthenticatorCodeResponse,
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
      response: decodeAuthenticatorOptionsResponse(
        responseWire,
      ) as AuthenticatorOptionsResponse,
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
      response: decodeAuthenticatorEnrollmentStageResponse(
        responseWire,
      ) as AuthenticatorEnrollmentStageResponse,
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
      response: decodeAuthenticatorEnrollmentConfirmResponse(
        responseWire,
      ) as AuthenticatorEnrollmentConfirmResponse,
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
      response: decodeGeneratedPasswordResponse(
        responseWire,
      ) as GeneratedPasswordResponse,
    }
  } catch {
    return unavailable()
  }
}

export function sendRuntimeMessageWithoutResponse(message: object): void {
  void sendRuntimeMessage(message)
}
