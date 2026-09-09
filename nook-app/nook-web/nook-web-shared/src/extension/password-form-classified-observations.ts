import {
  authentication_page_observation_facts_match_binding,
  bind_authentication_page_observation_facts,
  classify_companion_authentication_workflow_facts,
  companion_authentication_workflow_match_kind,
  CompanionAuthenticationWorkflowMatchKind,
  authentication_passkey_control_evidence_is_safe,
  type AuthenticationPageObservationFacts,
  type AuthenticationPageObservationFactsBatch,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import {
  MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT,
  authenticationSubmissionControls,
} from "./password-form-submission-controls";
import {
  PasswordFormScopeKind,
  type PasswordFormObservation,
  passwordFormInteraction,
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

export class AuthenticationWorkflowClassification {
  constructor(
    private readonly request: ClassifiedAuthenticationWorkflowRequest,
  ) {}
  get observations(): ClassifiedAuthenticationWorkflowObservation[] {
    const { workflowForms, authenticatorSetupHint, backupCodesHint } =
      this.request;
    return workflowForms.flatMap((observation) => {
      const factsRequest: Parameters<
        typeof passwordFormInteraction.authenticationPageObservationFacts
      >[0] = {
        observation,
        authenticatorSetupHint,
        backupCodesCopy: backupCodesHint ? "Save backup codes" : "",
      };
      const facts =
        passwordFormInteraction.authenticationPageObservationFacts(
          factsRequest,
        );
      const authenticationContext = facts.ceremony.authenticationContext;
      const fields = facts.fields;
      return authenticationContext &&
        authenticationSubmissionControls.authenticationFactStringsAreTransportable(
          [
            authenticationContext.sourceOrigin,
            authenticationContext.formIdentity,
            authenticationContext.destinationIdentity,
          ],
        ) &&
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
  static approvedAuthenticationContextMatches({
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
      live.fields.oneTimeCodeFieldCount ===
        approved.fields.oneTimeCodeFieldCount
    );
  }
  static approvedFieldSemanticsMatch(
    request: ApprovedAuthenticationFactsPair,
  ): boolean {
    return AuthenticationWorkflowClassification.approvedAuthenticationContextMatches(
      request,
    );
  }
  static rustBoundAuthenticationFactsMatch({
    live,
    approved,
  }: ApprovedAuthenticationFactsPair): boolean {
    const approvedBatch: AuthenticationPageObservationFactsBatch = {
      observations: [approved],
    };
    const liveBatch: AuthenticationPageObservationFactsBatch = {
      observations: [live],
    };
    try {
      const binding = bind_authentication_page_observation_facts(approvedBatch);
      return authentication_page_observation_facts_match_binding(
        binding,
        liveBatch,
      );
    } catch {
      return false;
    }
  }
  static rustWorkflowSemantics(
    facts: AuthenticationPageObservationFacts,
  ): string {
    const workflowMatchRequest: Parameters<
      typeof classify_companion_authentication_workflow_facts
    >[0] = {
      observations: [facts],
    };
    const workflowMatch =
      classify_companion_authentication_workflow_facts(workflowMatchRequest);
    const matchKind =
      companion_authentication_workflow_match_kind(workflowMatch);
    if (
      matchKind !== CompanionAuthenticationWorkflowMatchKind.Matched ||
      !("snapshot" in workflowMatch)
    ) {
      return String(matchKind);
    }
    return `${matchKind}:${workflowMatch.snapshot.kind}:${workflowMatch.snapshot.action}`;
  }
}
export class AuthenticationWorkflowScopeComparison {
  constructor(private readonly request: AuthenticationWorkflowScopePair) {}
  get matches(): boolean {
    const { left, right } = this.request;
    if (left.formScope.kind !== right.formScope.kind) return false;
    if (left.formScope.kind === PasswordFormScopeKind.Owned) {
      return (
        right.formScope.kind === PasswordFormScopeKind.Owned &&
        left.formScope.owner === right.formScope.owner
      );
    }
    return left.root === right.root;
  }
}
export class LiveApprovedAuthenticationWorkflow {
  constructor(
    private readonly request: LiveApprovedAuthenticationWorkflowRequest,
  ) {}
  get observation(): boolean {
    const { approved, authenticatorSetupHint, backupCodesHint } = this.request;
    const classifiedRequest: ClassifiedAuthenticationWorkflowRequest = {
      workflowForms:
        passwordFormInteraction.summarizeAuthenticationWorkflowForms(),
      authenticatorSetupHint,
      backupCodesHint,
    };
    const liveCandidates = new AuthenticationWorkflowClassification(
      classifiedRequest,
    ).observations;
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
      const passkeyAccountAvailability =
        approved.facts.authenticator.passkeyAccountAvailability;
      return {
        ...candidate,
        facts: {
          ...candidate.facts,
          authenticator: {
            ...candidate.facts.authenticator,
            passkeyAccountAvailability,
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
      new AuthenticationWorkflowScopeComparison(scopePair).matches &&
      AuthenticationWorkflowClassification.rustBoundAuthenticationFactsMatch(
        factsPair,
      ) &&
      AuthenticationWorkflowClassification.approvedAuthenticationContextMatches(
        factsPair,
      ) &&
      AuthenticationWorkflowClassification.approvedFieldSemanticsMatch(
        factsPair,
      ) &&
      AuthenticationWorkflowClassification.rustWorkflowSemantics(
        selected.facts,
      ) ===
        AuthenticationWorkflowClassification.rustWorkflowSemantics(
          approved.facts,
        )
    );
  }
}
