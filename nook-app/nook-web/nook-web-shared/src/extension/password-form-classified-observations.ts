import {
  revalidate_approved_authentication_workflow,
  type AuthenticationPageObservationFacts,
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
}

export enum AuthenticationWorkflowScopeDisposition {
  Same = "same",
  Changed = "changed",
}

export enum LiveAuthenticationWorkflowDisposition {
  Current = "current",
  Changed = "changed",
}

export class AuthenticationWorkflowScopeComparison {
  constructor(private readonly request: AuthenticationWorkflowScopePair) {}
  get disposition(): AuthenticationWorkflowScopeDisposition {
    const { left, right } = this.request;
    if (left.formScope.kind !== right.formScope.kind)
      return AuthenticationWorkflowScopeDisposition.Changed;
    if (left.formScope.kind === PasswordFormScopeKind.Owned) {
      return right.formScope.kind === PasswordFormScopeKind.Owned &&
        left.formScope.owner === right.formScope.owner
        ? AuthenticationWorkflowScopeDisposition.Same
        : AuthenticationWorkflowScopeDisposition.Changed;
    }
    return left.root === right.root
      ? AuthenticationWorkflowScopeDisposition.Same
      : AuthenticationWorkflowScopeDisposition.Changed;
  }
}
export class LiveApprovedAuthenticationWorkflow {
  constructor(
    private readonly request: LiveApprovedAuthenticationWorkflowRequest,
  ) {}
  get disposition(): LiveAuthenticationWorkflowDisposition {
    const { approved, authenticatorSetupHint, backupCodesHint } = this.request;
    // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
    const liveCandidates = new AuthenticationWorkflowClassification({
      workflowForms:
        passwordFormInteraction.summarizeAuthenticationWorkflowForms(),
      authenticatorSetupHint,
      backupCodesHint,
    }).observations;
    // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
    const decision = revalidate_approved_authentication_workflow({
      approved: approved.facts,
      live: {
        observations: liveCandidates.map((candidate) => candidate.facts),
      },
    });
    if (decision.kind === "rejected")
      return LiveAuthenticationWorkflowDisposition.Changed;
    const selected = liveCandidates[decision.observationIndex];
    if (!selected) return LiveAuthenticationWorkflowDisposition.Changed;
    // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
    return new AuthenticationWorkflowScopeComparison({
      left: selected.observation,
      right: approved.observation,
    }).disposition === AuthenticationWorkflowScopeDisposition.Same
      ? LiveAuthenticationWorkflowDisposition.Current
      : LiveAuthenticationWorkflowDisposition.Changed;
  }
}
