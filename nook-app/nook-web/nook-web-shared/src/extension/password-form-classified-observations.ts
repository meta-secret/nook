import type { AuthenticationPageObservationFacts } from "./nook-companion-wasm/nook_companion_wasm.js";
import { authenticationFactStringsAreTransportable } from "./password-form-submission-controls";
import {
  authenticationPageObservationFacts,
  type PasswordFormObservation,
} from "./password-forms";

export type ClassifiedAuthenticationWorkflowObservation = {
  observation: PasswordFormObservation;
  facts: AuthenticationPageObservationFacts;
};

type ClassifiedAuthenticationWorkflowRequest = {
  workflowForms: PasswordFormObservation[];
  authenticatorSetupHint: boolean;
  backupCodesHint: boolean;
};

export function classifiedAuthenticationWorkflowObservations({
  workflowForms,
  authenticatorSetupHint,
  backupCodesHint,
}: ClassifiedAuthenticationWorkflowRequest): ClassifiedAuthenticationWorkflowObservation[] {
  return workflowForms.flatMap((observation) => {
    const factsRequest: Parameters<
      typeof authenticationPageObservationFacts
    >[0] = {
      observation,
      authenticatorSetupHint,
      backupCodesHint,
    };
    const facts = authenticationPageObservationFacts(factsRequest);
    const authenticationContext = facts.ceremony.authenticationContext;
    return authenticationContext &&
      authenticationFactStringsAreTransportable([
        authenticationContext.sourceOrigin,
        authenticationContext.formIdentity,
        authenticationContext.destinationIdentity,
      ])
      ? [{ observation, facts }]
      : [];
  });
}
