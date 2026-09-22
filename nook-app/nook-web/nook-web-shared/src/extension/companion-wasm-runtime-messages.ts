/* eslint-disable @typescript-eslint/no-restricted-types, no-restricted-syntax -- This dedicated untrusted-input decoder narrows browser transport values immediately. */
import type {
  AuthenticationObservationBindingToken,
  AuthenticationPageObservationFactsBatch,
  AuthenticationPilotPresentationCapability,
  AuthenticationUsernameEvidence,
  AuthenticationWorkflowMatch,
  AuthenticationWorkflowSnapshot,
  AuthenticationRecoveryCopyEvidence,
  AuthenticationWorkflowRoutingResponse,
  LoginPickerOpenResponse,
  WebsiteLoginOptions,
  WebsiteLoginSavePendingResponse,
  PasswordWorkflowActivityPresentation,
  AuthenticationAdvanceControlObservation,
  AuthenticationControlTransportability,
  AuthenticationDetailedPasskeyControlCandidateObservation,
  AuthenticationPageObservationFacts,
  AuthenticationDisplayProgress,
  ApprovedAuthenticationWorkflowDecision,
  AuthenticationImplicitSubmitActuationObservation,
} from "./nook-companion-wasm/nook_companion_wasm.js";

export enum CompanionWasmSessionMessageType {
  AuthenticationWorkflowPilotPresentationCapability = "nook:extension-session-authentication-workflow-pilot-presentation-capability",
  PasswordWorkflowActivity = "nook:extension-session-project-password-workflow-activity",
  BindAuthenticationPageObservationFacts = "nook:extension-session-bind-authentication-page-observation-facts",
  AuthenticationPageObservationFactsMatchBinding = "nook:extension-session-authentication-page-observation-facts-match-binding",
  AuthenticationEnrollmentWorkflowMatch = "nook:extension-session-authentication-enrollment-workflow-match",
  HasLoginContext = "nook:extension-session-has-login-context",
  ClassifyPageInputField = "nook:extension-session-classify-page-input-field",
  ClassifyPageInputs = "nook:extension-session-classify-page-inputs",
  LooksLikeLoginAdvanceControlLabel = "nook:extension-session-looks-like-login-advance-control-label",
  LooksLikeManualCheckpointLabel = "nook:extension-session-looks-like-manual-checkpoint-label",
  LooksLikePasskeyControlLabel = "nook:extension-session-looks-like-passkey-control-label",
  LooksLikeEmailVerificationBody = "nook:extension-session-looks-like-email-verification-body",
  LooksLikeOneTimeCodeAutoSubmitSignal = "nook:extension-session-looks-like-one-time-code-auto-submit-signal",
  AuthenticationRecoveryCopyEvidence = "nook:extension-session-authentication-recovery-copy-evidence",
  IsNookVaultAppUrl = "nook:extension-session-is-nook-vault-app-url",
  DecodeAuthenticationWorkflowRuntimeResponse = "nook:extension-session-decode-authentication-workflow-runtime-response",
  DecodeContentRuntimeResponse = "nook:extension-session-decode-content-runtime-response",
  EvaluateAuthenticationPolicies = "nook:extension-session-evaluate-authentication-policies",
  RevalidateApprovedAuthenticationWorkflow = "nook:extension-session-revalidate-approved-authentication-workflow",
}

export enum CompanionWasmLabelKind {
  LoginAdvance = "login-advance",
  ManualCheckpoint = "manual-checkpoint",
  PasskeyControl = "passkey-control",
  EmailVerificationBody = "email-verification-body",
  OneTimeCodeAutoSubmitSignal = "one-time-code-auto-submit-signal",
}

export enum CompanionWasmContentResponseKind {
  LoginOptions = "login-options",
  LoginPickerOpen = "login-picker-open",
  LoginSavePending = "login-save-pending",
}

export type CompanionWasmLoginContextObservation = {
  readonly formIdentity: string;
  readonly ancestorIdentities: readonly string[];
  readonly advanceControlLabel: string;
  readonly pathContext: string;
};

export type CompanionWasmPageInputFieldObservation = {
  readonly inputType: string;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly autocompleteTokens: readonly string[];
  readonly identityText: string;
  readonly loginContext: boolean;
};

export type CompanionWasmPageInputFieldRequest = {
  readonly index: number;
  readonly observation: CompanionWasmPageInputFieldObservation;
  readonly loginContextObservation: CompanionWasmLoginContextObservation;
};

export type CompanionWasmLabelRequest = {
  readonly kind: CompanionWasmLabelKind;
  readonly value: string;
};

export type CompanionWasmSessionMessage =
  | {
      readonly type: CompanionWasmSessionMessageType.AuthenticationWorkflowPilotPresentationCapability;
      readonly payload: { readonly snapshot: AuthenticationWorkflowSnapshot };
    }
  | {
      readonly type: CompanionWasmSessionMessageType.PasswordWorkflowActivity;
      readonly payload: {
        readonly currentPasswordFieldCount: number;
        readonly newPasswordFieldCount: number;
      };
    }
  | {
      readonly type: CompanionWasmSessionMessageType.BindAuthenticationPageObservationFacts;
      readonly payload: {
        readonly facts: AuthenticationPageObservationFactsBatch;
      };
    }
  | {
      readonly type: CompanionWasmSessionMessageType.AuthenticationPageObservationFactsMatchBinding;
      readonly payload: {
        readonly binding: AuthenticationObservationBindingToken;
        readonly facts: AuthenticationPageObservationFactsBatch;
      };
    }
  | {
      readonly type: CompanionWasmSessionMessageType.AuthenticationEnrollmentWorkflowMatch;
      readonly payload: {
        readonly authenticatorSetupHint: boolean;
        readonly backupCodesCopy: string;
        readonly manualCheckpointPresent: boolean;
      };
    }
  | {
      readonly type: CompanionWasmSessionMessageType.HasLoginContext;
      readonly payload: {
        readonly observation: CompanionWasmLoginContextObservation;
      };
    }
  | {
      readonly type: CompanionWasmSessionMessageType.ClassifyPageInputField;
      readonly payload: {
        readonly observation: CompanionWasmPageInputFieldObservation;
      };
    }
  | {
      readonly type: CompanionWasmSessionMessageType.ClassifyPageInputs;
      readonly payload: {
        readonly fields: readonly CompanionWasmPageInputFieldRequest[];
        readonly labels: readonly CompanionWasmLabelRequest[];
      };
    }
  | {
      readonly type: CompanionWasmSessionMessageType.LooksLikeLoginAdvanceControlLabel;
      readonly payload: { readonly label: string };
    }
  | {
      readonly type: CompanionWasmSessionMessageType.LooksLikeManualCheckpointLabel;
      readonly payload: { readonly label: string };
    }
  | {
      readonly type: CompanionWasmSessionMessageType.LooksLikePasskeyControlLabel;
      readonly payload: { readonly label: string };
    }
  | {
      readonly type: CompanionWasmSessionMessageType.LooksLikeEmailVerificationBody;
      readonly payload: { readonly body: string };
    }
  | {
      readonly type: CompanionWasmSessionMessageType.LooksLikeOneTimeCodeAutoSubmitSignal;
      readonly payload: { readonly signal: string };
    }
  | {
      readonly type: CompanionWasmSessionMessageType.AuthenticationRecoveryCopyEvidence;
      readonly payload: { readonly texts: readonly string[] };
    }
  | {
      readonly type: CompanionWasmSessionMessageType.IsNookVaultAppUrl;
      readonly payload: {
        readonly candidateUrl: string;
        readonly baseUrl: string;
      };
    }
  | {
      readonly type: CompanionWasmSessionMessageType.EvaluateAuthenticationPolicies;
      readonly payload: {
        readonly transportability: readonly AuthenticationControlTransportability[];
        readonly advanceControls: readonly AuthenticationAdvanceControlObservation[];
        readonly passwordDisclosureControls: readonly AuthenticationAdvanceControlObservation[];
        readonly passkeyCandidates: readonly AuthenticationDetailedPasskeyControlCandidateObservation[];
        readonly pageFacts: readonly AuthenticationPageObservationFacts[];
        readonly implicitSubmissions: readonly AuthenticationImplicitSubmitActuationObservation[];
      };
    }
  | {
      readonly type: CompanionWasmSessionMessageType.RevalidateApprovedAuthenticationWorkflow;
      readonly payload: {
        readonly approved: AuthenticationPageObservationFacts;
        readonly live: AuthenticationPageObservationFactsBatch;
      };
    }
  | {
      readonly type: CompanionWasmSessionMessageType.DecodeAuthenticationWorkflowRuntimeResponse;
      readonly payload: { readonly response: unknown };
    }
  | {
      readonly type: CompanionWasmSessionMessageType.DecodeContentRuntimeResponse;
      readonly payload: {
        readonly kind: CompanionWasmContentResponseKind;
        readonly response: unknown;
      };
    };

export type CompanionWasmSessionResponse =
  | AuthenticationPilotPresentationCapability
  | PasswordWorkflowActivityPresentation
  | AuthenticationObservationBindingToken
  | AuthenticationWorkflowMatch
  | AuthenticationRecoveryCopyEvidence
  | AuthenticationWorkflowRoutingResponse
  | LoginPickerOpenResponse
  | WebsiteLoginOptions
  | WebsiteLoginSavePendingResponse
  | boolean
  | {
      readonly revalidationDecision: ApprovedAuthenticationWorkflowDecision;
    }
  | {
      readonly transportability: readonly boolean[];
      readonly advanceControls: readonly boolean[];
      readonly passwordDisclosureControls: readonly boolean[];
      readonly passkeyCandidates: readonly boolean[];
      readonly pageFactsPriorities: readonly number[];
      readonly pageFactsAdmissibility: readonly boolean[];
      readonly activityProgress: readonly AuthenticationDisplayProgress[];
      readonly implicitSubmissions: readonly boolean[];
    }
  | {
      readonly authenticationUsernameEvidence: AuthenticationUsernameEvidence;
      readonly looksLikeUsernameField: boolean;
      readonly looksLikeOneTimeCodeField: boolean;
    }
  | {
      readonly fields: readonly {
        readonly index: number;
        readonly loginContext: boolean;
        readonly authenticationUsernameEvidence: AuthenticationUsernameEvidence;
        readonly looksLikeUsernameField: boolean;
        readonly looksLikeOneTimeCodeField: boolean;
      }[];
      readonly strongestAuthenticationUsernameEvidence: AuthenticationUsernameEvidence;
      readonly labels: readonly {
        readonly kind: CompanionWasmLabelRequest["kind"];
        readonly value: string;
        readonly matches: boolean;
      }[];
    };

export type CompanionWasmRuntimeMessage = CompanionWasmSessionMessage & {
  readonly origin: string;
};

export const companionWasmSessionMessageTypes: readonly string[] = [
  ...Object.values(CompanionWasmSessionMessageType),
];

export function isCompanionWasmSessionMessageType(
  type: string,
): type is CompanionWasmSessionMessageType {
  return companionWasmSessionMessageTypes.includes(type);
}
