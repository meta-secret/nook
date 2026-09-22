import {
  revalidate_approved_authentication_workflow,
  type ApprovedAuthenticationWorkflowDecision,
  type AuthenticationPageObservationFacts,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import {
  CompanionWasmSessionMessageType,
  type CompanionWasmRuntimeMessage,
} from "./companion-wasm-runtime-messages";
import {
  CompanionWasmRuntimeDeliveryKind,
  sendCompanionWasmRuntimeMessage,
} from "./companion-wasm-runtime-transport";
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

type LiveAuthenticationWorkflowDecisionProjectionRequest = {
  readonly liveCandidates: ClassifiedAuthenticationWorkflowObservation[];
  readonly decision: ApprovedAuthenticationWorkflowDecision;
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
          ],
        ) &&
        authenticationSubmissionControls.authenticationDestinationFits(
          authenticationContext.destinationIdentity,
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
  private liveCandidates(): ClassifiedAuthenticationWorkflowObservation[] {
    const { authenticatorSetupHint, backupCodesHint } = this.request;
    const classificationRequest: ClassifiedAuthenticationWorkflowRequest = {
      workflowForms:
        passwordFormInteraction.summarizeAuthenticationWorkflowForms(),
      authenticatorSetupHint,
      backupCodesHint,
    };
    return new AuthenticationWorkflowClassification(classificationRequest)
      .observations;
  }

  private dispositionFromDecision({
    liveCandidates,
    decision,
  }: LiveAuthenticationWorkflowDecisionProjectionRequest): LiveAuthenticationWorkflowDisposition {
    const { approved } = this.request;
    if (decision.kind === "rejected")
      return LiveAuthenticationWorkflowDisposition.Changed;
    const selected = liveCandidates[decision.observationIndex];
    if (!selected) return LiveAuthenticationWorkflowDisposition.Changed;
    const scopeComparisonRequest: AuthenticationWorkflowScopePair = {
      left: selected.observation,
      right: approved.observation,
    };
    return new AuthenticationWorkflowScopeComparison(scopeComparisonRequest)
      .disposition === AuthenticationWorkflowScopeDisposition.Same
      ? LiveAuthenticationWorkflowDisposition.Current
      : LiveAuthenticationWorkflowDisposition.Changed;
  }

  get disposition(): LiveAuthenticationWorkflowDisposition {
    const { approved } = this.request;
    const liveCandidates = this.liveCandidates();
    const revalidationRequest: Parameters<
      typeof revalidate_approved_authentication_workflow
    >[0] = {
      approved: approved.facts,
      live: {
        observations: liveCandidates.map((candidate) => candidate.facts),
      },
    };
    const decision =
      revalidate_approved_authentication_workflow(revalidationRequest);
    const projectionRequest: LiveAuthenticationWorkflowDecisionProjectionRequest =
      { liveCandidates, decision };
    return this.dispositionFromDecision(projectionRequest);
  }

  async extensionDisposition(
    browser: typeof globalThis,
  ): Promise<LiveAuthenticationWorkflowDisposition> {
    if (!browser.chrome.runtime?.id) return this.disposition;
    const { approved } = this.request;
    const liveCandidates = this.liveCandidates();
    const runtimeMessage: CompanionWasmRuntimeMessage = {
      type: CompanionWasmSessionMessageType.RevalidateApprovedAuthenticationWorkflow,
      payload: {
        approved: approved.facts,
        live: {
          observations: liveCandidates.map((candidate) => candidate.facts),
        },
      },
      origin: browser.location.origin,
    };
    const delivery = await sendCompanionWasmRuntimeMessage(
      browser,
      runtimeMessage,
    );
    if (
      delivery.kind !== CompanionWasmRuntimeDeliveryKind.Delivered ||
      !delivery.response ||
      typeof delivery.response !== "object" ||
      !("revalidationDecision" in delivery.response)
    ) {
      return LiveAuthenticationWorkflowDisposition.Changed;
    }
    const projectionRequest: LiveAuthenticationWorkflowDecisionProjectionRequest =
      {
        liveCandidates,
        decision: delivery.response.revalidationDecision,
      };
    return this.dispositionFromDecision(projectionRequest);
  }
}
