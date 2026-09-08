import type {
  AuthenticationPageObservationFacts,
  AuthenticationUsernameEvidence,
} from "./nook-companion-wasm/nook_companion_wasm.js";

type FieldFacts = AuthenticationPageObservationFacts["fields"];
type CeremonyFacts = AuthenticationPageObservationFacts["ceremony"];
type AuthenticatorFacts = AuthenticationPageObservationFacts["authenticator"];
type AuthenticationPageObservationSummary = Pick<
  FieldFacts,
  | "usernameFieldCount"
  | "currentPasswordFieldCount"
  | "newPasswordFieldCount"
  | "genericPasswordFieldCount"
  | "oneTimeCodeFieldCount"
> & { manualCheckpointPresent: boolean };

export type AuthenticationPageObservationFactsAssemblyRequest = {
  summary: AuthenticationPageObservationSummary;
  actionablePasswordFieldCount: FieldFacts["actionablePasswordFieldCount"];
  readonlyPasswordFieldCount: FieldFacts["readonlyPasswordFieldCount"];
  oneTimeCodeHandlerSignals: CeremonyFacts["oneTimeCodeHandlerSignals"];
  authenticationUsername: AuthenticationUsernameEvidence;
  sourceOrigin: string;
  formIdentity: string;
  destinationIdentity: string;
  implicitSubmissionMethod: CeremonyFacts["implicitSubmissionMethod"];
  implicitSubmissionAvailable: boolean;
  authenticatorSetupHint: boolean;
  backupCodesCopy: AuthenticatorFacts["backupCodesCopy"];
  passkeyControlPresent: boolean;
  detailedPasskeyControl: AuthenticatorFacts["detailedPasskeyControl"];
  credentialSubmission: AuthenticationPageObservationFacts["credentialSubmission"];
  detailedAdvanceControl: AuthenticationPageObservationFacts["detailedAdvanceControl"];
};

export function assembleAuthenticationPageObservationFacts(
  request: AuthenticationPageObservationFactsAssemblyRequest,
): AuthenticationPageObservationFacts {
  return {
    fields: {
      usernameFieldCount: request.summary.usernameFieldCount,
      currentPasswordFieldCount: request.summary.currentPasswordFieldCount,
      newPasswordFieldCount: request.summary.newPasswordFieldCount,
      genericPasswordFieldCount: request.summary.genericPasswordFieldCount,
      oneTimeCodeFieldCount: request.summary.oneTimeCodeFieldCount,
      actionablePasswordFieldCount: request.actionablePasswordFieldCount,
      readonlyPasswordFieldCount: request.readonlyPasswordFieldCount,
    },
    ceremony: {
      oneTimeCodeProgression: "advance-control-required",
      oneTimeCodeHandlerSignal: "",
      oneTimeCodeHandlerSignals: request.oneTimeCodeHandlerSignals,
      authenticationContext: {
        authenticationUsername: request.authenticationUsername,
        sourceOrigin: request.sourceOrigin,
        formIdentity: request.formIdentity,
        destinationIdentity: request.destinationIdentity,
      },
      manualCheckpoint: request.summary.manualCheckpointPresent
        ? "present"
        : "absent",
      implicitSubmissionMethod: request.implicitSubmissionMethod,
      advanceControl: request.implicitSubmissionAvailable
        ? "implicit-submission"
        : "absent",
    },
    authenticator: {
      authenticatorSetup: request.authenticatorSetupHint ? "present" : "absent",
      backupCodesCopy: request.backupCodesCopy,
      passkeyControl: request.passkeyControlPresent ? "present" : "absent",
      passkeyAccountAvailability: "unavailable",
      matchingPasskeyAccountCount: 0,
      detailedPasskeyControl: request.detailedPasskeyControl,
    },
    credentialDisclosureControl: { kind: "absent" },
    credentialSubmission: request.credentialSubmission,
    detailedAdvanceControl: request.detailedAdvanceControl,
  };
}
