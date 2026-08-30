import type { AuthenticationPageObservationFacts } from "./nook-companion-wasm/nook_companion_wasm.js";
import {
  authenticationFactStringsAreTransportable,
  MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT,
} from "./password-form-submission-controls";
import {
  authenticationPageObservationFacts,
  PasswordFormScopeKind,
  summarizeAuthenticationWorkflowForms,
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
    const fields = facts.fields;
    return authenticationContext &&
      authenticationFactStringsAreTransportable([
        authenticationContext.sourceOrigin,
        authenticationContext.formIdentity,
        authenticationContext.destinationIdentity,
      ]) &&
      [
        fields.usernameFieldCount,
        fields.currentPasswordFieldCount,
        fields.newPasswordFieldCount,
        fields.genericPasswordFieldCount,
        fields.oneTimeCodeFieldCount,
        fields.currentPasswordFieldCount +
          fields.newPasswordFieldCount +
          fields.genericPasswordFieldCount,
      ].every((count) => count <= MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT)
      ? [{ observation, facts }]
      : [];
  });
}

type LiveApprovedAuthenticationWorkflowRequest = {
  approved: ClassifiedAuthenticationWorkflowObservation;
  authenticatorSetupHint: boolean;
  backupCodesHint: boolean;
};

function authenticationWorkflowScopesMatch(
  left: PasswordFormObservation,
  right: PasswordFormObservation,
): boolean {
  if (left.formScope.kind !== right.formScope.kind) return false;
  if (left.formScope.kind === PasswordFormScopeKind.Owned) {
    return (
      right.formScope.kind === PasswordFormScopeKind.Owned &&
      left.formScope.owner === right.formScope.owner
    );
  }
  return left.root === right.root;
}

function approvedAuthenticationContextMatches(
  live: AuthenticationPageObservationFacts,
  approved: AuthenticationPageObservationFacts,
): boolean {
  const liveContext = live.ceremony.authenticationContext;
  const approvedContext = approved.ceremony.authenticationContext;
  if (!liveContext || !approvedContext) return false;
  return (
    liveContext.sourceOrigin === approvedContext.sourceOrigin &&
    liveContext.formIdentity === approvedContext.formIdentity &&
    liveContext.destinationIdentity === approvedContext.destinationIdentity
  );
}

export function liveApprovedAuthenticationWorkflow({
  approved,
  authenticatorSetupHint,
  backupCodesHint,
}: LiveApprovedAuthenticationWorkflowRequest): boolean {
  const classifiedRequest: ClassifiedAuthenticationWorkflowRequest = {
    workflowForms: summarizeAuthenticationWorkflowForms(),
    authenticatorSetupHint,
    backupCodesHint,
  };
  return classifiedAuthenticationWorkflowObservations(classifiedRequest).some(
    (candidate) =>
      authenticationWorkflowScopesMatch(
        candidate.observation,
        approved.observation,
      ) &&
      approvedAuthenticationContextMatches(candidate.facts, approved.facts),
  );
}
