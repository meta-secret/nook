import {
  FocusedCredentialOpportunity,
  FocusedCredentialRevalidation,
  NookPageInputFieldObservation,
  classify_companion_focused_credential_field,
  parse_page_input_type,
  revalidate_companion_focused_credential_field,
  type FocusedCredentialRecognition,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  CompanionWasmSessionMessageType,
  type CompanionWasmSessionMessage,
  type CompanionWasmFocusedRecognitionResponse,
} from '../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'

type FocusedFieldRecognitionRequest = Extract<
  CompanionWasmSessionMessage,
  {
    type:
      | CompanionWasmSessionMessageType.ClassifyFocusedCredentialField
      | CompanionWasmSessionMessageType.RevalidateFocusedCredentialField
  }
>
type FocusedFieldRevalidation = {
  readonly field: NookPageInputFieldObservation
  readonly opportunity: FocusedCredentialOpportunity
}

/** Owns the generated field, recognition result, and consuming revalidation request. */
export class FocusedFieldRecognitionOperation {
  constructor(private readonly request: FocusedFieldRecognitionRequest) {}

  private recognition(
    field: NookPageInputFieldObservation,
  ): FocusedCredentialRecognition {
    switch (this.request.type) {
      case CompanionWasmSessionMessageType.ClassifyFocusedCredentialField:
        return classify_companion_focused_credential_field(field)
      case CompanionWasmSessionMessageType.RevalidateFocusedCredentialField: {
        const request: FocusedFieldRevalidation = {
          field,
          opportunity: this.request.payload.opportunity,
        }
        return this.revalidate(request)
      }
    }
  }

  private revalidate(
    observation: FocusedFieldRevalidation,
  ): FocusedCredentialRecognition {
    const request = new FocusedCredentialRevalidation(
      observation.field,
    ).with_opportunity(observation.opportunity)
    try {
      return revalidate_companion_focused_credential_field(request)
    } finally {
      request.free()
    }
  }

  private response(
    recognition: FocusedCredentialRecognition,
  ): CompanionWasmFocusedRecognitionResponse {
    try {
      const focusedOpportunity = recognition.opportunity
      switch (focusedOpportunity) {
        case FocusedCredentialOpportunity.Unavailable:
          return { focusedOpportunity }
        case FocusedCredentialOpportunity.Username:
        case FocusedCredentialOpportunity.CurrentPassword:
          return {
            focusedOpportunity,
            focusedSelection: recognition.credential_selection(),
          }
      }
    } finally {
      recognition.free()
    }
  }

  run(): CompanionWasmFocusedRecognitionResponse {
    const observation = this.request.payload.observation
    const field = new NookPageInputFieldObservation(
      parse_page_input_type(observation.inputType),
      observation.disabled,
      observation.readOnly,
      [...observation.autocompleteTokens],
      observation.identityText,
      observation.loginContext,
    )
    try {
      return this.response(this.recognition(field))
    } finally {
      field.free()
    }
  }
}
