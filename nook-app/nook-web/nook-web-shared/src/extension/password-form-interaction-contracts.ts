import type {
  AuthenticationAdvanceControlObservation,
  AuthenticationUsernameEvidence,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import type {
  PasskeyControlCandidate,
  PasswordFormScope,
} from "./password-form-fields";
import type {
  FormSubmissionApproval,
  LoginAdvanceControl,
  PageControlSubmissionMethod,
  PasswordFormScopeQuery,
} from "./password-form-submission-controls";
import type { OwnedAuthenticationControlRequest } from "./password-form-implicit-actuation";

export type PasswordFormSummary = {
  passwordFieldCount: number;
  currentPasswordFieldCount: number;
  newPasswordFieldCount: number;
  genericPasswordFieldCount: number;
  usernameFieldCount: number;
  oneTimeCodeFieldCount: number;
  manualCheckpointPresent: boolean;
  passkeyControlPresent: boolean;
  formCount: number;
  observedAt: number;
};

export type PasswordFormObservation = {
  root: ParentNode;
  formScope: PasswordFormScope;
  summary: PasswordFormSummary;
};

export type AuthenticationObservationFactsRequest = {
  observation: PasswordFormObservation;
  authenticatorSetupHint: boolean;
  backupCodesHint?: boolean;
  backupCodesCopy?: string;
};

export type SemanticSubmitControlPair = [
  LoginAdvanceControl,
  LoginAdvanceControl,
];

export type PageControlObservationRequest = {
  observation: PasswordFormObservation;
  control: HTMLElement;
  authenticationUsername: AuthenticationUsernameEvidence;
  semanticSubmitControlCount: number;
  explicitlyLocallyScoped?: boolean;
};

export type CompleteAuthenticationAdvanceControlObservation =
  AuthenticationAdvanceControlObservation & {
    readonly submissionMethod: PageControlSubmissionMethod;
  };

export type PasskeyCandidateSafetyRequest = {
  candidate: PasskeyControlCandidate;
  observation: PasswordFormObservation;
};

export type LoginFormSubmissionRequest = PasswordFormScopeQuery & {
  submissionApproval?: FormSubmissionApproval;
};

export type OwnedAdvanceControlRequest =
  OwnedAuthenticationControlRequest<LoginFormSubmissionRequest>;
