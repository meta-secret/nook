import type {
  AuthenticationAuthenticatorSetupObservation,
  AuthenticationUsernameEvidence,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import type { PasswordFormScope } from "./password-form-fields";

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
  authenticatorSetupHint: AuthenticationAuthenticatorSetupObservation;
  backupCodesHint?: boolean;
  backupCodesCopy?: string;
};

export type PageControlObservationRequest = {
  observation: PasswordFormObservation;
  control: HTMLElement;
  authenticationUsername: AuthenticationUsernameEvidence;
  semanticSubmitControlCount: number;
  explicitlyLocallyScoped?: boolean;
};
