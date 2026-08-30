import {
  classify_companion_authentication_workflow_facts,
  companion_authentication_workflow_match_kind,
  CompanionAuthenticationWorkflowMatchKind,
  authentication_passkey_control_evidence_is_safe,
  type AuthenticationPageObservationFacts,
} from "./nook-companion-wasm/nook_companion_wasm.js";
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

type AuthenticationWorkflowScopePair = {
  left: PasswordFormObservation;
  right: PasswordFormObservation;
};

type ApprovedAuthenticationFactsPair = {
  live: AuthenticationPageObservationFacts;
  approved: AuthenticationPageObservationFacts;
};

export function authenticationWorkflowScopesMatch({
  left,
  right,
}: AuthenticationWorkflowScopePair): boolean {
  if (left.formScope.kind !== right.formScope.kind) return false;
  if (left.formScope.kind === PasswordFormScopeKind.Owned) {
    return (
      right.formScope.kind === PasswordFormScopeKind.Owned &&
      left.formScope.owner === right.formScope.owner
    );
  }
  return left.root === right.root;
}

function approvedAuthenticationContextMatches({
  live,
  approved,
}: ApprovedAuthenticationFactsPair): boolean {
  const liveContext = live.ceremony.authenticationContext;
  const approvedContext = approved.ceremony.authenticationContext;
  if (!liveContext || !approvedContext) return false;
  return (
    liveContext.sourceOrigin === approvedContext.sourceOrigin &&
    liveContext.formIdentity === approvedContext.formIdentity &&
    liveContext.destinationIdentity === approvedContext.destinationIdentity &&
    live.fields.usernameFieldCount === approved.fields.usernameFieldCount &&
    live.fields.currentPasswordFieldCount ===
      approved.fields.currentPasswordFieldCount &&
    live.fields.newPasswordFieldCount ===
      approved.fields.newPasswordFieldCount &&
    live.fields.genericPasswordFieldCount ===
      approved.fields.genericPasswordFieldCount &&
    live.fields.oneTimeCodeFieldCount === approved.fields.oneTimeCodeFieldCount
  );
}

function approvedFieldSemanticsMatch(
  request: ApprovedAuthenticationFactsPair,
): boolean {
  return approvedAuthenticationContextMatches(request);
}

function rustWorkflowSemantics(
  facts: AuthenticationPageObservationFacts,
): string {
  const workflowMatchRequest: Parameters<
    typeof classify_companion_authentication_workflow_facts
  >[0] = {
    observations: [facts],
  };
  const workflowMatch =
    classify_companion_authentication_workflow_facts(workflowMatchRequest);
  const matchKind = companion_authentication_workflow_match_kind(workflowMatch);
  if (
    matchKind !== CompanionAuthenticationWorkflowMatchKind.Matched ||
    !("snapshot" in workflowMatch)
  ) {
    return String(matchKind);
  }
  return `${matchKind}:${workflowMatch.snapshot.kind}:${workflowMatch.snapshot.action}`;
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
  const liveCandidates =
    classifiedAuthenticationWorkflowObservations(classifiedRequest);
  const approvedPasskeyEvidence =
    approved.facts.authenticator.detailedPasskeyControl;
  const approvedPasskeyEvidenceIsSafe = approvedPasskeyEvidence
    ? authentication_passkey_control_evidence_is_safe(approvedPasskeyEvidence)
    : false;
  if (
    !approvedPasskeyEvidenceIsSafe &&
    liveCandidates.some((candidate) => {
      const passkeyEvidence =
        candidate.facts.authenticator.detailedPasskeyControl;
      return passkeyEvidence
        ? authentication_passkey_control_evidence_is_safe(passkeyEvidence)
        : false;
    })
  ) {
    return false;
  }
  const live = liveCandidates.map((candidate) => {
    const passkeyEvidence =
      candidate.facts.authenticator.detailedPasskeyControl;
    const matchingPasskeyAccountCount =
      passkeyEvidence &&
      authentication_passkey_control_evidence_is_safe(passkeyEvidence)
        ? approved.facts.authenticator.matchingPasskeyAccountCount
        : 0;
    return {
      ...candidate,
      facts: {
        ...candidate.facts,
        authenticator: {
          ...candidate.facts.authenticator,
          matchingPasskeyAccountCount,
        },
      },
    };
  });
  const batchRequest: Parameters<
    typeof classify_companion_authentication_workflow_facts
  >[0] = {
    observations: live.map((candidate) => candidate.facts),
  };
  const batchMatch =
    classify_companion_authentication_workflow_facts(batchRequest);
  const matchKind = companion_authentication_workflow_match_kind(batchMatch);
  if (
    matchKind !== CompanionAuthenticationWorkflowMatchKind.Matched ||
    !("snapshot" in batchMatch)
  ) {
    return false;
  }
  const selected = live[batchMatch.snapshot.observationIndex];
  if (!selected) return false;
  const scopePair: AuthenticationWorkflowScopePair = {
    left: selected.observation,
    right: approved.observation,
  };
  const factsPair: ApprovedAuthenticationFactsPair = {
    live: selected.facts,
    approved: approved.facts,
  };
  return (
    authenticationWorkflowScopesMatch(scopePair) &&
    approvedAuthenticationContextMatches(factsPair) &&
    approvedFieldSemanticsMatch(factsPair) &&
    rustWorkflowSemantics(selected.facts) ===
      rustWorkflowSemantics(approved.facts)
  );
}
