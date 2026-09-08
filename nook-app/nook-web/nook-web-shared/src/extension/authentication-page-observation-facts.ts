import type {
  AuthenticationPageObservationFacts,
  AuthenticationUsernameEvidence,
} from "./nook-companion-wasm/nook_companion_wasm.js";

type AuthenticationFieldFacts = AuthenticationPageObservationFacts["fields"];
type AuthenticationCeremonyFacts =
  AuthenticationPageObservationFacts["ceremony"];
type AuthenticationAuthenticatorFacts =
  AuthenticationPageObservationFacts["authenticator"];
type AuthenticationPageObservationSummary = Pick<
  AuthenticationFieldFacts,
  | "usernameFieldCount"
  | "currentPasswordFieldCount"
  | "newPasswordFieldCount"
  | "genericPasswordFieldCount"
  | "oneTimeCodeFieldCount"
>;

export type AuthenticationPageObservationFactsAssemblyRequest = {
  summary: AuthenticationPageObservationSummary;
  actionablePasswordFieldCount: AuthenticationFieldFacts["actionablePasswordFieldCount"];
  readonlyPasswordFieldCount: AuthenticationFieldFacts["readonlyPasswordFieldCount"];
  oneTimeCodeHandlerSignals: AuthenticationCeremonyFacts["oneTimeCodeHandlerSignals"];
  authenticationUsername: AuthenticationUsernameEvidence;
  sourceOrigin: string;
  formIdentity: string;
  destinationIdentity: string;
  manualCheckpoint: AuthenticationCeremonyFacts["manualCheckpoint"];
  implicitSubmissionMethod: AuthenticationCeremonyFacts["implicitSubmissionMethod"];
  advanceControl: AuthenticationCeremonyFacts["advanceControl"];
  authenticatorSetup: AuthenticationAuthenticatorFacts["authenticatorSetup"];
  backupCodesCopy: AuthenticationAuthenticatorFacts["backupCodesCopy"];
  passkeyControl: AuthenticationAuthenticatorFacts["passkeyControl"];
  detailedPasskeyControl: AuthenticationAuthenticatorFacts["detailedPasskeyControl"];
  credentialSubmission: AuthenticationPageObservationFacts["credentialSubmission"];
  detailedAdvanceControl: AuthenticationPageObservationFacts["detailedAdvanceControl"];
};

export class AuthenticationPageObservationFactsAssembler {
  public constructor(
    private readonly request: AuthenticationPageObservationFactsAssemblyRequest,
  ) {}

  public assemble(): AuthenticationPageObservationFacts {
    const { request } = this;
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
        manualCheckpoint: request.manualCheckpoint,
        implicitSubmissionMethod: request.implicitSubmissionMethod,
        advanceControl: request.advanceControl,
      },
      authenticator: {
        authenticatorSetup: request.authenticatorSetup,
        backupCodesCopy: request.backupCodesCopy,
        passkeyControl: request.passkeyControl,
        passkeyAccountAvailability: "unavailable",
        matchingPasskeyAccountCount: 0,
        detailedPasskeyControl: request.detailedPasskeyControl,
      },
      credentialDisclosureControl: { kind: "absent" },
      credentialSubmission: request.credentialSubmission,
      detailedAdvanceControl: request.detailedAdvanceControl,
    };
  }
}
