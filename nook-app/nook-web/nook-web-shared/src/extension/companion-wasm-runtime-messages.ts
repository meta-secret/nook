/* eslint-disable @typescript-eslint/no-restricted-types, no-restricted-syntax -- This dedicated untrusted-input decoder narrows browser transport values immediately. */
import { Schema } from "effect";
import {
  GoogleLoginContinuationMessageType,
  type GoogleLoginSessionMessage,
  type GoogleLoginSessionResponse,
} from "./google-login-continuation-messages";
import type {
  AuthenticationLoginChecklistProjection,
  AuthenticationLoginChecklistPresentation,
  AuthenticationAuthenticatorSetupBatch,
  AuthenticationAuthenticatorSetupObservation,
  AuthenticationObservationBindingToken,
  AuthenticationPageObservationFactsBatch,
  AuthenticationPilotPresentationCapability,
  AuthenticationUsernameEvidence,
  FocusedCredentialOpportunity,
  FocusedCredentialSelection,
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
  AuthenticationWorkflowActivity,
  ApprovedAuthenticationWorkflowDecision,
  AuthenticationBackupCodeExtractionRequest,
  AuthenticationBackupCodeExtraction,
  AuthenticationNavigationPathRequest,
  AuthenticationNavigationPathProjection,
  AuthenticatorPickerOpenResponse,
  AuthenticationOutcomeResponse,
  AuthenticatorPreviewResponse,
  AuthenticatorBackupAttachResponse,
  AuthenticatorCodeResponse,
  AuthenticatorEnrollmentStageResponse,
  AuthenticatorEnrollmentConfirmResponse,
  AuthenticatorOptionsResponse,
  GeneratedPasswordResponse,
  WebsiteLoginSaveActionResponse,
  WebsiteLoginSaveOfferResponse,
  AuthenticationImplicitSubmitActuationObservation,
  LoginSaveOutcomeObservation,
  LoginSaveOutcomeDecision,
} from "./nook-companion-wasm/nook_companion_wasm.js";

export enum CompanionWasmSessionMessageType {
  ClassifyLoginSaveOutcome = "nook:extension-session-classify-login-save-outcome",
  ProjectAuthenticationLoginChecklist = "nook:extension-session-project-authentication-login-checklist",
  ClassifyFocusedCredentialField = "nook:extension-session-classify-focused-credential-field",
  RevalidateFocusedCredentialField = "nook:extension-session-revalidate-focused-credential-field",
  GetAuthenticationActivityProgress = "nook:extension-session-get-authentication-activity-progress",
  ExtractAuthenticationBackupCodeCandidates = "nook:extension-session-extract-authentication-backup-code-candidates",
  ProjectAuthenticationNavigationPath = "nook:extension-session-project-authentication-navigation-path",
  AuthenticationAuthenticatorSetupObservation = "nook:extension-session-authentication-authenticator-setup-observation",
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
  AuthenticationContainerIdentity = "authentication-container-identity",
  LoginAdvance = "login-advance",
  ManualCheckpoint = "manual-checkpoint",
  PasskeyControl = "passkey-control",
  EmailVerificationBody = "email-verification-body",
  OneTimeCodeAutoSubmitSignal = "one-time-code-auto-submit-signal",
}

export enum CompanionWasmContentResponseKind {
  LoginSaveOffer = "login-save-offer",
  LoginSaveAction = "login-save-action",
  AuthenticationOutcome = "authentication-outcome",
  AuthenticatorPreview = "authenticator-preview",
  AuthenticatorBackupAttach = "authenticator-backup-attach",
  AuthenticatorCode = "authenticator-code",
  AuthenticatorEnrollmentStage = "authenticator-enrollment-stage",
  AuthenticatorEnrollmentConfirm = "authenticator-enrollment-confirm",
  AuthenticatorPickerOpen = "authenticator-picker-open",
  GeneratedPassword = "generated-password",
  AuthenticatorOptions = "authenticator-options",
  LoginOptions = "login-options",
  LoginPickerOpen = "login-picker-open",
  LoginSavePending = "login-save-pending",
}

export enum AuthenticationEnrollmentWorkflowMatchResponseKind {
  NoMatch = "no-match",
  Rejected = "rejected",
  Matched = "matched",
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
  | { readonly type: CompanionWasmSessionMessageType.ClassifyLoginSaveOutcome; readonly payload: LoginSaveOutcomeObservation }
  | GoogleLoginSessionMessage
  | {
      readonly type: CompanionWasmSessionMessageType.ProjectAuthenticationLoginChecklist;
      readonly payload: AuthenticationLoginChecklistProjection;
    }
  | {
      readonly type: CompanionWasmSessionMessageType.ClassifyFocusedCredentialField;
      readonly payload: {
        readonly observation: CompanionWasmPageInputFieldObservation;
      };
    }
  | {
      readonly type: CompanionWasmSessionMessageType.RevalidateFocusedCredentialField;
      readonly payload: {
        readonly observation: CompanionWasmPageInputFieldObservation;
        readonly opportunity: FocusedCredentialOpportunity;
      };
    }
  | {
      readonly type: CompanionWasmSessionMessageType.GetAuthenticationActivityProgress;
      readonly payload: { readonly activity: AuthenticationWorkflowActivity };
    }
  | {
      readonly type: CompanionWasmSessionMessageType.ExtractAuthenticationBackupCodeCandidates;
      readonly payload: AuthenticationBackupCodeExtractionRequest;
    }
  | {
      readonly type: CompanionWasmSessionMessageType.ProjectAuthenticationNavigationPath;
      readonly payload: AuthenticationNavigationPathRequest;
    }
  | {
      readonly type: CompanionWasmSessionMessageType.AuthenticationAuthenticatorSetupObservation;
      readonly payload: AuthenticationAuthenticatorSetupBatch;
    }
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

export type CompanionWasmAuthenticatorSetupResponse = {
  readonly authenticatorSetupObservation: AuthenticationAuthenticatorSetupObservation;
};

const authenticatorSetupObservationSchema = Schema.Literals([
  "present",
  "absent",
]);
const companionWasmAuthenticatorSetupResponseFields: {
  readonly authenticatorSetupObservation: typeof authenticatorSetupObservationSchema;
} = {
  authenticatorSetupObservation: authenticatorSetupObservationSchema,
};
export const CompanionWasmAuthenticatorSetupResponseDecoder: Schema.Codec<CompanionWasmAuthenticatorSetupResponse> =
  Schema.Struct(companionWasmAuthenticatorSetupResponseFields);

const backupCodeArraySchema = Schema.mutable(Schema.Array(Schema.String));
const backupCodeExtractionFields: {
  readonly codes: typeof backupCodeArraySchema;
} = {
  codes: backupCodeArraySchema,
};
export const CompanionWasmBackupCodeExtractionDecoder: Schema.Codec<AuthenticationBackupCodeExtraction> =
  Schema.Struct(backupCodeExtractionFields);

const authenticationNavigationObservationSchema = Schema.Literals([
  "Authentication",
  "Unrelated",
]);
const authenticationNavigationPathFields: {
  readonly observation: typeof authenticationNavigationObservationSchema;
} = {
  observation: authenticationNavigationObservationSchema,
};
export const CompanionWasmNavigationPathDecoder: Schema.Codec<AuthenticationNavigationPathProjection> =
  Schema.Struct(authenticationNavigationPathFields);

const activityProgressFields: {
  readonly currentStep: typeof Schema.Number;
  readonly totalSteps: typeof Schema.Number;
} = {
  currentStep: Schema.Number,
  totalSteps: Schema.Number,
};
const activityProgressSchema = Schema.Struct(activityProgressFields);
const activityProgressResponseFields: {
  readonly activityProgress: typeof activityProgressSchema;
} = {
  activityProgress: activityProgressSchema,
};
export const CompanionWasmActivityProgressDecoder: Schema.Codec<{
  readonly activityProgress: AuthenticationDisplayProgress;
}> = Schema.Struct(activityProgressResponseFields);

export type CompanionWasmFocusedRecognitionResponse =
  | { readonly focusedOpportunity: FocusedCredentialOpportunity.Unavailable }
  | {
      readonly focusedOpportunity: Exclude<
        FocusedCredentialOpportunity,
        FocusedCredentialOpportunity.Unavailable
      >;
      readonly focusedSelection: FocusedCredentialSelection;
    };

export type CompanionWasmSessionResponse =
  | GoogleLoginSessionResponse
  | LoginSaveOutcomeDecision
  | AuthenticationLoginChecklistPresentation
  | CompanionWasmFocusedRecognitionResponse
  | { readonly activityProgress: AuthenticationDisplayProgress }
  | AuthenticationBackupCodeExtraction
  | AuthenticationNavigationPathProjection
  | AuthenticatorPickerOpenResponse
  | AuthenticationOutcomeResponse
  | AuthenticatorPreviewResponse
  | AuthenticatorBackupAttachResponse
  | AuthenticatorCodeResponse
  | AuthenticatorEnrollmentStageResponse
  | AuthenticatorEnrollmentConfirmResponse
  | AuthenticatorOptionsResponse
  | GeneratedPasswordResponse
  | WebsiteLoginSaveActionResponse
  | WebsiteLoginSaveOfferResponse
  | CompanionWasmAuthenticatorSetupResponse
  | AuthenticationPilotPresentationCapability
  | PasswordWorkflowActivityPresentation
  | AuthenticationObservationBindingToken
  | AuthenticationWorkflowMatch
  | AuthenticationEnrollmentWorkflowMatchResponse
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

export type AuthenticationEnrollmentWorkflowMatchResponse =
  | { readonly kind: AuthenticationEnrollmentWorkflowMatchResponseKind.NoMatch }
  | {
      readonly kind: AuthenticationEnrollmentWorkflowMatchResponseKind.Rejected;
    }
  | {
      readonly kind: AuthenticationEnrollmentWorkflowMatchResponseKind.Matched;
      readonly snapshot: AuthenticationWorkflowSnapshot;
      readonly pilotCapability: AuthenticationPilotPresentationCapability;
    };

export type CompanionWasmRuntimeMessage = CompanionWasmSessionMessage & {
  readonly origin: string;
};

export const companionWasmSessionMessageTypes: readonly string[] = [
  ...Object.values(CompanionWasmSessionMessageType),
  ...Object.values(GoogleLoginContinuationMessageType),
];

export function isCompanionWasmSessionMessageType(
  type: string,
): type is
  CompanionWasmSessionMessageType | GoogleLoginContinuationMessageType {
  return companionWasmSessionMessageTypes.includes(type);
}
