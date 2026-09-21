import type {
  AuthenticationObservationBindingToken,
  AuthenticationPageObservationFactsBatch,
  AuthenticationPilotPresentationCapability,
  AuthenticationUsernameEvidence,
  AuthenticationWorkflowMatch,
  AuthenticationWorkflowSnapshot,
  PasswordWorkflowActivityPresentation,
} from './nook-companion-wasm/nook_companion_wasm.js'

export enum CompanionWasmSessionMessageType {
  AuthenticationWorkflowPilotPresentationCapability =
    'nook:extension-session-authentication-workflow-pilot-presentation-capability',
  PasswordWorkflowActivity =
    'nook:extension-session-project-password-workflow-activity',
  BindAuthenticationPageObservationFacts =
    'nook:extension-session-bind-authentication-page-observation-facts',
  AuthenticationPageObservationFactsMatchBinding =
    'nook:extension-session-authentication-page-observation-facts-match-binding',
  AuthenticationEnrollmentWorkflowMatch =
    'nook:extension-session-authentication-enrollment-workflow-match',
  HasLoginContext = 'nook:extension-session-has-login-context',
  ClassifyPageInputField = 'nook:extension-session-classify-page-input-field',
  ClassifyPageInputs = 'nook:extension-session-classify-page-inputs',
  LooksLikeLoginAdvanceControlLabel =
    'nook:extension-session-looks-like-login-advance-control-label',
  LooksLikeManualCheckpointLabel =
    'nook:extension-session-looks-like-manual-checkpoint-label',
  LooksLikePasskeyControlLabel =
    'nook:extension-session-looks-like-passkey-control-label',
  LooksLikeEmailVerificationBody =
    'nook:extension-session-looks-like-email-verification-body',
  LooksLikeOneTimeCodeAutoSubmitSignal =
    'nook:extension-session-looks-like-one-time-code-auto-submit-signal',
}

export type CompanionWasmLoginContextObservation = {
  readonly formIdentity: string
  readonly ancestorIdentities: readonly string[]
  readonly advanceControlLabel: string
  readonly pathContext: string
}

export type CompanionWasmPageInputFieldObservation = {
  readonly inputType: string
  readonly disabled: boolean
  readonly readOnly: boolean
  readonly autocompleteTokens: readonly string[]
  readonly identityText: string
  readonly loginContext: boolean
}

export type CompanionWasmPageInputFieldRequest = {
  readonly index: number
  readonly observation: CompanionWasmPageInputFieldObservation
  readonly loginContextObservation: CompanionWasmLoginContextObservation
}

export type CompanionWasmLabelRequest = {
  readonly kind:
    | 'login-advance'
    | 'manual-checkpoint'
    | 'passkey-control'
    | 'email-verification-body'
    | 'one-time-code-auto-submit-signal'
  readonly value: string
}

export type CompanionWasmSessionMessage =
  | {
      readonly type: CompanionWasmSessionMessageType.AuthenticationWorkflowPilotPresentationCapability
      readonly payload: { readonly snapshot: AuthenticationWorkflowSnapshot }
    }
  | {
      readonly type: CompanionWasmSessionMessageType.PasswordWorkflowActivity
      readonly payload: {
        readonly currentPasswordFieldCount: number
        readonly newPasswordFieldCount: number
      }
    }
  | {
      readonly type: CompanionWasmSessionMessageType.BindAuthenticationPageObservationFacts
      readonly payload: { readonly facts: AuthenticationPageObservationFactsBatch }
    }
  | {
      readonly type: CompanionWasmSessionMessageType.AuthenticationPageObservationFactsMatchBinding
      readonly payload: {
        readonly binding: AuthenticationObservationBindingToken
        readonly facts: AuthenticationPageObservationFactsBatch
      }
    }
  | {
      readonly type: CompanionWasmSessionMessageType.AuthenticationEnrollmentWorkflowMatch
      readonly payload: {
        readonly authenticatorSetupHint: boolean
        readonly backupCodesCopy: string
        readonly manualCheckpointPresent: boolean
      }
    }
  | {
      readonly type: CompanionWasmSessionMessageType.HasLoginContext
      readonly payload: { readonly observation: CompanionWasmLoginContextObservation }
    }
  | {
      readonly type: CompanionWasmSessionMessageType.ClassifyPageInputField
      readonly payload: { readonly observation: CompanionWasmPageInputFieldObservation }
    }
  | {
      readonly type: CompanionWasmSessionMessageType.ClassifyPageInputs
      readonly payload: {
        readonly fields: readonly CompanionWasmPageInputFieldRequest[]
        readonly labels: readonly CompanionWasmLabelRequest[]
      }
    }
  | {
      readonly type: CompanionWasmSessionMessageType.LooksLikeLoginAdvanceControlLabel
      readonly payload: { readonly label: string }
    }
  | {
      readonly type: CompanionWasmSessionMessageType.LooksLikeManualCheckpointLabel
      readonly payload: { readonly label: string }
    }
  | {
      readonly type: CompanionWasmSessionMessageType.LooksLikePasskeyControlLabel
      readonly payload: { readonly label: string }
    }
  | {
      readonly type: CompanionWasmSessionMessageType.LooksLikeEmailVerificationBody
      readonly payload: { readonly body: string }
    }
  | {
      readonly type: CompanionWasmSessionMessageType.LooksLikeOneTimeCodeAutoSubmitSignal
      readonly payload: { readonly signal: string }
    }

export type CompanionWasmSessionResponse =
  | AuthenticationPilotPresentationCapability
  | PasswordWorkflowActivityPresentation
  | AuthenticationObservationBindingToken
  | AuthenticationWorkflowMatch
  | boolean
  | {
      readonly authenticationUsernameEvidence: AuthenticationUsernameEvidence
      readonly looksLikeUsernameField: boolean
      readonly looksLikeOneTimeCodeField: boolean
    }
  | {
      readonly fields: readonly {
        readonly index: number
        readonly loginContext: boolean
        readonly authenticationUsernameEvidence: AuthenticationUsernameEvidence
        readonly looksLikeUsernameField: boolean
        readonly looksLikeOneTimeCodeField: boolean
      }[]
      readonly strongestAuthenticationUsernameEvidence: AuthenticationUsernameEvidence
      readonly labels: readonly {
        readonly kind: CompanionWasmLabelRequest['kind']
        readonly value: string
        readonly matches: boolean
      }[]
    }

export type CompanionWasmRuntimeMessage = CompanionWasmSessionMessage & {
  readonly origin: string
}

export const companionWasmSessionMessageTypes: readonly string[] = [
  ...Object.values(CompanionWasmSessionMessageType),
]

export function isCompanionWasmSessionMessageType(
  type: string,
): type is CompanionWasmSessionMessageType {
  return companionWasmSessionMessageTypes.includes(type)
}
