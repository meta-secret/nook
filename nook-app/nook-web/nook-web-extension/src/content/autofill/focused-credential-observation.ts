import { FocusedCredentialOpportunity } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  CompanionWasmSessionMessageType,
  type CompanionWasmRuntimeMessage,
  type CompanionWasmSessionResponse,
  type CompanionWasmFocusedRecognitionResponse,
} from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import { passwordFieldDiscovery } from '../../../../nook-web-shared/src/extension/password-forms'
import {
  FocusedCredentialTargetKind,
  type FocusedCredentialTarget,
} from './focused-credential-target'

type RetainedFocusedCredentialTarget = Extract<
  FocusedCredentialTarget,
  { kind: FocusedCredentialTargetKind.Retained }
>

/** Projects the retained DOM field onto the generated Rust semantic policy boundary. */
export class FocusedCredentialObservation {
  constructor(readonly target: RetainedFocusedCredentialTarget) {}

  get classificationRequest(): CompanionWasmRuntimeMessage {
    return {
      type: CompanionWasmSessionMessageType.ClassifyFocusedCredentialField,
      origin: this.target.origin,
      payload: {
        observation: passwordFieldDiscovery.focusedFieldObservation(
          this.target.input,
        ),
      },
    }
  }

  revalidationRequest(
    opportunity: FocusedCredentialOpportunity,
  ): CompanionWasmRuntimeMessage {
    return {
      type: CompanionWasmSessionMessageType.RevalidateFocusedCredentialField,
      origin: this.target.origin,
      payload: {
        observation: passwordFieldDiscovery.focusedFieldObservation(
          this.target.input,
        ),
        opportunity,
      },
    }
  }

  static recognition(
    response: CompanionWasmSessionResponse,
  ): CompanionWasmFocusedRecognitionResponse {
    switch (true) {
      case typeof response === 'object' && 'focusedOpportunity' in response:
        return response
      case true:
        return { focusedOpportunity: FocusedCredentialOpportunity.Unavailable }
    }
    return { focusedOpportunity: FocusedCredentialOpportunity.Unavailable }
  }
}
