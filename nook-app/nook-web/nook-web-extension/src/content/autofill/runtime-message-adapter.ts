import { companionWasmReadiness } from './companion-wasm-readiness'
import {
  CompanionWasmSessionMessageType,
  type CompanionWasmRuntimeMessage,
  type CompanionWasmSessionMessage,
  type CompanionWasmSessionResponse,
} from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'

import type { GeneratePasswordRequest } from '../../../../nook-web-shared/src/extension/runtime-messages'

import { type AuthenticationWorkflowSnapshotMessage } from '../../lib/auth-workflow-messages'

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
  decode_authenticator_picker_open_response,
  decode_authentication_outcome_response,
  decode_authenticator_backup_attach_response,
  decode_authenticator_code_response,
  decode_authenticator_enrollment_confirm_response,
  decode_authenticator_enrollment_stage_response,
  decode_authenticator_options_response,
  decode_authenticator_preview_response,
  decode_generated_password_response,
  decode_website_login_save_action_response,
  decode_website_login_save_offer_response,
  type AuthenticationWorkflowRoutingResponse,
  type AuthenticationWorkflowSelectedFacts,
  type AuthenticationWorkflowSnapshotResponse,
  type AuthenticatorBackupAttachResponse,
  type AuthenticatorCodeResponse,
  type AuthenticatorEnrollmentConfirmResponse,
  type AuthenticatorEnrollmentStageResponse,
  type AuthenticatorOptionsResponse,
  type AuthenticatorPickerOpenResponse,
  type AuthenticatorPreviewResponse,
  type GeneratedPasswordResponse,
  type LoginPickerOpenResponse,
  type WebsiteLoginOptions,
  type WebsiteLoginSaveOfferResponse,
  type WebsiteLoginSaveActionResponse,
  type WebsiteLoginSavePendingResponse,
  type AuthenticationOutcomeResponse,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export enum RuntimeMessageDeliveryKind {
  Delivered = 'delivered',
  Unavailable = 'unavailable',
}

export type RuntimeMessageDelivery<Response> =
  | { kind: RuntimeMessageDeliveryKind.Delivered; response: Response }
  | { kind: RuntimeMessageDeliveryKind.Unavailable }

type RuntimeMessageResponse =
  | AuthenticationOutcomeResponse
  | AuthenticationWorkflowRoutingResponse
  | AuthenticationWorkflowSnapshotResponse
  | AuthenticatorBackupAttachResponse
  | AuthenticatorCodeResponse
  | AuthenticatorEnrollmentConfirmResponse
  | AuthenticatorEnrollmentStageResponse
  | AuthenticatorOptionsResponse
  | AuthenticatorPickerOpenResponse
  | AuthenticatorPreviewResponse
  | GeneratedPasswordResponse
  | LoginPickerOpenResponse
  | WebsiteLoginOptions
  | WebsiteLoginSaveActionResponse
  | WebsiteLoginSaveOfferResponse
  | WebsiteLoginSavePendingResponse
  | CompanionWasmSessionResponse

export type AuthenticationWorkflowSnapshotRuntimeResponse = {
  verdict: AuthenticationWorkflowSnapshotResponse
  loginMatches: AuthenticationWorkflowRoutingResponse['loginMatches']
  selectedFacts: AuthenticationWorkflowSelectedFacts
  pilotCapability: 'hidden' | 'propose-action'
  factsBindingToken: string | false
  savedLoginActionAvailable: boolean
}

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
  | CompanionWasmSessionMessage

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

export type RuntimeMessageResponseDecoder<Response> = (
  response: unknown,
) => Response

export type DecodedRuntimeMessageArgs<Response> = {
  message: ExtensionRuntimeRequest
  decode: RuntimeMessageResponseDecoder<Response>
}

/** Owns this browser host’s resources and interaction lifecycle. */
class AuthenticationRuntimeTransport {
  constructor(private readonly browser: typeof globalThis) {}

  private sendRuntimeMessage(
    message: ExtensionRuntimeRequest,
  ): Promise<RuntimeMessageDelivery<RuntimeMessageResponse>> {
    return new Promise((resolve) => {
      this.browser.chrome.runtime.sendMessage(
        message,
        (response: RuntimeMessageResponse) => {
          if (this.browser.chrome.runtime.lastError) {
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
        },
      )
    })
  }

  async sendDecodedRuntimeMessage<Response>({
    message,
    decode,
  }: DecodedRuntimeMessageArgs<Response>): Promise<
    RuntimeMessageDelivery<Response>
  > {
    const delivery = await this.sendRuntimeMessage(message)
    if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
      return this.unavailable()
    }
    try {
      const response = decode(delivery.response)
      return {
        kind: RuntimeMessageDeliveryKind.Delivered,
        response,
      }
    } catch {
      return this.unavailable()
    }
  }

  async sendCompanionWasmRuntimeMessage(
    message: CompanionWasmSessionMessage,
  ): Promise<RuntimeMessageDelivery<CompanionWasmSessionResponse>> {
    const runtimeMessage: CompanionWasmRuntimeMessage = {
      ...message,
      origin: this.browser.location?.origin ?? '',
    }
    const delivery = await this.sendRuntimeMessage(runtimeMessage)
    if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
      return this.unavailable()
    }
    if (
      !delivery.response ||
      typeof delivery.response !== 'object' ||
      !('ok' in delivery.response) ||
      delivery.response.ok !== true ||
      !('result' in delivery.response)
    ) {
      return this.unavailable()
    }
    return {
      kind: RuntimeMessageDeliveryKind.Delivered,
      response: delivery.response.result as CompanionWasmSessionResponse,
    }
  }

  private unavailable<Response>(): RuntimeMessageDelivery<Response> {
    return { kind: RuntimeMessageDeliveryKind.Unavailable }
  }

  async sendLoginOptionsRuntimeMessage(
    message: WebsiteLoginOptionsMessage,
  ): Promise<RuntimeMessageDelivery<WebsiteLoginOptions>> {
    const delivery = await this.sendRuntimeMessage(message)
    if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
      return this.unavailable()
    }
    const decoded = await this.sendCompanionWasmRuntimeMessage({
      type: CompanionWasmSessionMessageType.DecodeContentRuntimeResponse,
      payload: { kind: 'login-options', response: delivery.response },
    })
    return decoded.kind === RuntimeMessageDeliveryKind.Delivered
      ? {
          kind: RuntimeMessageDeliveryKind.Delivered,
          response: decoded.response as WebsiteLoginOptions,
        }
      : this.unavailable()
  }

  async sendLoginSaveOfferRuntimeMessage(
    message: WebsiteLoginSaveOfferMessage,
  ): Promise<RuntimeMessageDelivery<WebsiteLoginSaveOfferResponse>> {
    const delivery = await this.sendRuntimeMessage(message)
    if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
      return this.unavailable()
    }
    try {
      await companionWasmReadiness.wait()
      return {
        kind: RuntimeMessageDeliveryKind.Delivered,
        response: decode_website_login_save_offer_response(delivery.response),
      }
    } catch {
      return this.unavailable()
    }
  }

  async sendLoginSavePendingRuntimeMessage(
    message: WebsiteLoginSavePendingMessage,
  ): Promise<RuntimeMessageDelivery<WebsiteLoginSavePendingResponse>> {
    const delivery = await this.sendRuntimeMessage(message)
    if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
      return this.unavailable()
    }
    const decoded = await this.sendCompanionWasmRuntimeMessage({
      type: CompanionWasmSessionMessageType.DecodeContentRuntimeResponse,
      payload: { kind: 'login-save-pending', response: delivery.response },
    })
    return decoded.kind === RuntimeMessageDeliveryKind.Delivered
      ? {
          kind: RuntimeMessageDeliveryKind.Delivered,
          response: decoded.response as WebsiteLoginSavePendingResponse,
        }
      : this.unavailable()
  }

  async sendLoginSaveActionRuntimeMessage(
    message: WebsiteLoginSaveCommitMessage | WebsiteLoginSaveDismissMessage,
  ): Promise<RuntimeMessageDelivery<WebsiteLoginSaveActionResponse>> {
    const delivery = await this.sendRuntimeMessage(message)
    if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
      return this.unavailable()
    }
    try {
      await companionWasmReadiness.wait()
      return {
        kind: RuntimeMessageDeliveryKind.Delivered,
        response: decode_website_login_save_action_response(delivery.response),
      }
    } catch {
      return this.unavailable()
    }
  }

  async sendLoginPickerOpenRuntimeMessage(
    message: WebsiteLoginPickerOpenMessage,
  ): Promise<RuntimeMessageDelivery<LoginPickerOpenResponse>> {
    const delivery = await this.sendRuntimeMessage(message)
    if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
      return this.unavailable()
    }
    const decoded = await this.sendCompanionWasmRuntimeMessage({
      type: CompanionWasmSessionMessageType.DecodeContentRuntimeResponse,
      payload: { kind: 'login-picker-open', response: delivery.response },
    })
    return decoded.kind === RuntimeMessageDeliveryKind.Delivered
      ? {
          kind: RuntimeMessageDeliveryKind.Delivered,
          response: decoded.response as LoginPickerOpenResponse,
        }
      : this.unavailable()
  }

  async sendAuthenticatorPickerOpenRuntimeMessage(
    message: WebsiteAuthenticatorPickerOpenMessage,
  ): Promise<RuntimeMessageDelivery<AuthenticatorPickerOpenResponse>> {
    const delivery = await this.sendRuntimeMessage(message)
    if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
      return this.unavailable()
    }
    try {
      await companionWasmReadiness.wait()
      return {
        kind: RuntimeMessageDeliveryKind.Delivered,
        response: decode_authenticator_picker_open_response(delivery.response),
      }
    } catch {
      return this.unavailable()
    }
  }

  async sendAuthenticationWorkflowSnapshotRuntimeMessage(
    message: AuthenticationWorkflowSnapshotMessage,
  ): Promise<
    RuntimeMessageDelivery<AuthenticationWorkflowSnapshotRuntimeResponse>
  > {
    const delivery = await this.sendRuntimeMessage(message)
    if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
      return this.unavailable()
    }
    const decoded = await this.sendCompanionWasmRuntimeMessage({
      type: CompanionWasmSessionMessageType.DecodeAuthenticationWorkflowRuntimeResponse,
      payload: { response: delivery.response },
    })
    if (decoded.kind === RuntimeMessageDeliveryKind.Delivered) {
      const rawResponse = delivery.response
      const pilotCapability =
        rawResponse &&
        typeof rawResponse === 'object' &&
        'pilotCapability' in rawResponse &&
        rawResponse.pilotCapability === 'propose-action'
          ? 'propose-action'
          : 'hidden'
      const factsBindingToken =
        rawResponse &&
        typeof rawResponse === 'object' &&
        'factsBindingToken' in rawResponse &&
        typeof rawResponse.factsBindingToken === 'string'
          ? rawResponse.factsBindingToken
          : false
      const savedLoginActionAvailable = Boolean(
        rawResponse &&
        typeof rawResponse === 'object' &&
        'savedLoginActionAvailable' in rawResponse &&
        rawResponse.savedLoginActionAvailable === true,
      )
      const runtimeResponse =
        decoded.response as unknown as AuthenticationWorkflowRoutingResponse
      const { workflow: verdict, loginMatches, selectedFacts } = runtimeResponse
      return {
        kind: RuntimeMessageDeliveryKind.Delivered,
        response: {
          verdict,
          loginMatches,
          selectedFacts,
          pilotCapability,
          factsBindingToken,
          savedLoginActionAvailable,
        },
      }
    }
    return this.unavailable()
  }

  async sendAuthenticatorPreviewRuntimeMessage(
    message: WebsiteAuthenticatorEnrollPreviewMessage,
  ): Promise<RuntimeMessageDelivery<AuthenticatorPreviewResponse>> {
    const delivery = await this.sendRuntimeMessage(message)
    if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
      return this.unavailable()
    }
    try {
      await companionWasmReadiness.wait()
      return {
        kind: RuntimeMessageDeliveryKind.Delivered,
        response: decode_authenticator_preview_response(delivery.response),
      }
    } catch {
      return this.unavailable()
    }
  }

  async sendAuthenticatorBackupAttachRuntimeMessage(
    message: WebsiteAuthenticatorBackupAttachMessage,
  ): Promise<RuntimeMessageDelivery<AuthenticatorBackupAttachResponse>> {
    const delivery = await this.sendRuntimeMessage(message)
    if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
      return this.unavailable()
    }
    try {
      await companionWasmReadiness.wait()
      return {
        kind: RuntimeMessageDeliveryKind.Delivered,
        response: decode_authenticator_backup_attach_response(
          delivery.response,
        ),
      }
    } catch {
      return this.unavailable()
    }
  }

  async sendAuthenticatorCodeRuntimeMessage(
    message:
      WebsiteAuthenticatorEnrollCodeMessage | WebsiteAuthenticatorFillMessage,
  ): Promise<RuntimeMessageDelivery<AuthenticatorCodeResponse>> {
    const delivery = await this.sendRuntimeMessage(message)
    if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
      return this.unavailable()
    }
    try {
      await companionWasmReadiness.wait()
      return {
        kind: RuntimeMessageDeliveryKind.Delivered,
        response: decode_authenticator_code_response(delivery.response),
      }
    } catch {
      return this.unavailable()
    }
  }

  async sendAuthenticatorOptionsRuntimeMessage(
    message: WebsiteAuthenticatorOptionsMessage,
  ): Promise<RuntimeMessageDelivery<AuthenticatorOptionsResponse>> {
    const delivery = await this.sendRuntimeMessage(message)
    if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
      return this.unavailable()
    }
    try {
      await companionWasmReadiness.wait()
      return {
        kind: RuntimeMessageDeliveryKind.Delivered,
        response: decode_authenticator_options_response(delivery.response),
      }
    } catch {
      return this.unavailable()
    }
  }

  async sendAuthenticatorEnrollmentStageRuntimeMessage(
    message: WebsiteAuthenticatorEnrollStageMessage,
  ): Promise<RuntimeMessageDelivery<AuthenticatorEnrollmentStageResponse>> {
    const delivery = await this.sendRuntimeMessage(message)
    if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
      return this.unavailable()
    }
    try {
      await companionWasmReadiness.wait()
      return {
        kind: RuntimeMessageDeliveryKind.Delivered,
        response: decode_authenticator_enrollment_stage_response(
          delivery.response,
        ),
      }
    } catch {
      return this.unavailable()
    }
  }

  async sendAuthenticatorEnrollmentConfirmRuntimeMessage(
    message: WebsiteAuthenticatorEnrollConfirmMessage,
  ): Promise<RuntimeMessageDelivery<AuthenticatorEnrollmentConfirmResponse>> {
    const delivery = await this.sendRuntimeMessage(message)
    if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
      return this.unavailable()
    }
    try {
      await companionWasmReadiness.wait()
      return {
        kind: RuntimeMessageDeliveryKind.Delivered,
        response: decode_authenticator_enrollment_confirm_response(
          delivery.response,
        ),
      }
    } catch {
      return this.unavailable()
    }
  }

  async sendAuthenticationOutcomeRuntimeMessage(
    message: AuthenticationOutcomeClassifyMessage,
  ): Promise<RuntimeMessageDelivery<AuthenticationOutcomeResponse>> {
    const delivery = await this.sendRuntimeMessage(message)
    if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
      return this.unavailable()
    }
    try {
      await companionWasmReadiness.wait()
      return {
        kind: RuntimeMessageDeliveryKind.Delivered,
        response: decode_authentication_outcome_response(delivery.response),
      }
    } catch {
      return this.unavailable()
    }
  }

  async sendGeneratePasswordRuntimeMessage(
    message: GeneratePasswordRequest,
  ): Promise<RuntimeMessageDelivery<GeneratedPasswordResponse>> {
    const delivery = await this.sendRuntimeMessage(message)
    if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
      return this.unavailable()
    }
    try {
      await companionWasmReadiness.wait()
      return {
        kind: RuntimeMessageDeliveryKind.Delivered,
        response: decode_generated_password_response(delivery.response),
      }
    } catch {
      return this.unavailable()
    }
  }

  sendRuntimeMessageWithoutResponse(message: ExtensionRuntimeRequest): void {
    void this.sendRuntimeMessage(message)
  }
}

export const authenticationRuntimeTransport =
  new AuthenticationRuntimeTransport(globalThis)
