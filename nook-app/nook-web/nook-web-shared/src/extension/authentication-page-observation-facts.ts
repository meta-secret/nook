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
>;

export type AuthenticationPageObservationFactsAssemblyRequest = {
  summary: AuthenticationPageObservationSummary;
  actionablePasswordFieldCount: FieldFacts["actionablePasswordFieldCount"];
  readonlyPasswordFieldCount: FieldFacts["readonlyPasswordFieldCount"];
  oneTimeCodeHandlerSignals: CeremonyFacts["oneTimeCodeHandlerSignals"];
  authenticationUsername: AuthenticationUsernameEvidence;
  sourceOrigin: string;
  formIdentity: string;
  destinationIdentity: string;
  manualCheckpoint: CeremonyFacts["manualCheckpoint"];
  implicitSubmissionMethod: CeremonyFacts["implicitSubmissionMethod"];
  advanceControl: CeremonyFacts["advanceControl"];
  authenticatorSetup: AuthenticatorFacts["authenticatorSetup"];
  backupCodesCopy: AuthenticatorFacts["backupCodesCopy"];
  passkeyControl: AuthenticatorFacts["passkeyControl"];
  detailedPasskeyControl: AuthenticatorFacts["detailedPasskeyControl"];
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
