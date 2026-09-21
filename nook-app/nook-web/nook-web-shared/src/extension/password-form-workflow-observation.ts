/* eslint-disable @typescript-eslint/no-restricted-types, nook-typed-api/no-raw-object-arguments, max-params -- DOM policy collection uses browser-owned object contracts and callback shapes at this boundary. */
import { PasswordFormSummaryObservation } from "./password-form-summary-observation";
import {
  PasswordAuthenticationWorkflowFormSummary,
  type PasswordAuthenticationWorkflowFormSummaryDependencies,
} from "./password-authentication-workflow-form-summary";
import {
  authentication_advance_control_is_safe,
  authentication_control_transportable,
  authentication_page_observation_facts_priority,
  authentication_passkey_control_candidate_is_safe,
  authentication_workflow_activity_progress,
  authentication_implicit_submit_actuation_is_safe,
  AuthenticationWorkflowActivity,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import type {
  AuthenticationAdvanceControlObservation,
  AuthenticationDetailedPasskeyControlCandidateObservation,
  AuthenticationDetailedPasskeyControlObservation,
  AuthenticationCredentialSubmissionObservation,
  AuthenticationPageObservationFacts,
  AuthenticationPasskeyControlObservation,
  AuthenticationUsernameEvidence,
  AuthenticationControlTransportability,
  AuthenticationDisplayProgress,
  AuthenticationImplicitSubmitActuationObservation,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import { CompanionWasmSessionMessageType } from "./companion-wasm-runtime-messages";
import {
  CompanionWasmRuntimeDeliveryKind,
  sendCompanionWasmRuntimeMessage,
} from "./companion-wasm-runtime-transport";
import {
  PasskeyControlLookupKind,
  PasswordFormScopeKind,
  passwordFieldDiscovery,
} from "./password-form-fields";
import type {
  ControlObservationAssociationRequest,
  LocalOwnedFormAdjacencyRequest,
  PasskeyControlLookup,
  PasswordFormScope,
} from "./password-form-fields";
import {
  authenticationAdvanceControlSelector,
  semanticSubmitControlSelector,
} from "./authentication-control-selectors";
import {
  AuthenticationSubmissionDestination,
  MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT,
  PageControlSubmissionMethod,
  PasswordFormQueryKind,
  type LoginAdvanceControl,
  type PasswordFormScopeQuery,
  authenticationSubmissionControls,
} from "./password-form-submission-controls";

const passkeyControlAbsent =
  "absent" satisfies AuthenticationPasskeyControlObservation;

const passkeyControlPresent =
  "present" satisfies AuthenticationPasskeyControlObservation;

const credentialSubmissionAbsent =
  "absent" satisfies AuthenticationCredentialSubmissionObservation["kind"];

const credentialSubmissionObserved =
  "observed" satisfies AuthenticationCredentialSubmissionObservation["kind"];

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
  authenticatorSetupHint: boolean;
  backupCodesHint?: boolean;
  backupCodesCopy?: string;
};

type SemanticSubmitControlPair = [LoginAdvanceControl, LoginAdvanceControl];

export type PageControlObservationRequest = {
  observation: PasswordFormObservation;
  control: HTMLElement;
  authenticationUsername: AuthenticationUsernameEvidence;
  semanticSubmitControlCount: number;
  explicitlyLocallyScoped?: boolean;
};

type CompleteAuthenticationAdvanceControlObservation =
  AuthenticationAdvanceControlObservation & {
    readonly submissionMethod: PageControlSubmissionMethod;
  };

type PasskeyCandidateSafetyRequest = {
  candidate: { control: HTMLElement; explicitlyMarked: boolean };
  observation: PasswordFormObservation;
};

function companionExtensionRuntimePresent(): boolean {
  return typeof chrome === "object" && Boolean(chrome.runtime?.id);
}

/** Owns this browser host’s resources and interaction lifecycle. */
export class PasswordFormWorkflowObservation extends PasswordFormSummaryObservation {
  private collectingPolicies:
    | {
        transportability: AuthenticationControlTransportability[];
        advanceControls: AuthenticationAdvanceControlObservation[];
        passkeyCandidates: AuthenticationDetailedPasskeyControlCandidateObservation[];
        pageFacts: AuthenticationPageObservationFacts[];
      }
    | false = false;
  private readonly transportabilityPolicies = new Map<string, boolean>();
  private readonly advanceControlPolicies = new Map<string, boolean>();
  private readonly passkeyCandidatePolicies = new Map<string, boolean>();
  private readonly pageFactsPriorities = new Map<string, number>();
  private readonly implicitSubmissionPolicies = new Map<string, boolean>();
  private readonly activityProgress = new Map<
    AuthenticationWorkflowActivity,
    AuthenticationDisplayProgress
  >();

  authenticationActivityProgress(
    activity: AuthenticationWorkflowActivity,
  ): AuthenticationDisplayProgress | false {
    const cached = this.activityProgress.get(activity);
    if (cached) return cached;
    return companionExtensionRuntimePresent()
      ? false
      : authentication_workflow_activity_progress(activity);
  }

  private policyKey(request: object): string {
    return JSON.stringify(request);
  }

  private collectOrReadBooleanPolicy<Request extends object>(
    request: Request,
    collection: Request[] | false,
    cache: Map<string, boolean>,
    directPolicy: (request: Request) => boolean,
  ): boolean {
    const key = this.policyKey(request);
    if (collection) {
      if (!collection.some((candidate) => this.policyKey(candidate) === key)) {
        collection.push(request);
      }
      return true;
    }
    const cached = cache.get(key);
    if (typeof cached === "boolean") return cached;
    return companionExtensionRuntimePresent() ? false : directPolicy(request);
  }

  protected advanceControlIsSafe(
    request: AuthenticationAdvanceControlObservation,
  ): boolean {
    return this.collectOrReadBooleanPolicy(
      request,
      this.collectingPolicies ? this.collectingPolicies.advanceControls : false,
      this.advanceControlPolicies,
      authentication_advance_control_is_safe,
    );
  }

  private passkeyCandidateIsSafe(
    request: AuthenticationDetailedPasskeyControlCandidateObservation,
  ): boolean {
    return this.collectOrReadBooleanPolicy(
      request,
      this.collectingPolicies
        ? this.collectingPolicies.passkeyCandidates
        : false,
      this.passkeyCandidatePolicies,
      authentication_passkey_control_candidate_is_safe,
    );
  }

  authenticationImplicitSubmitActuationIsSafe(
    facts: AuthenticationPageObservationFacts,
  ): boolean {
    const request: AuthenticationImplicitSubmitActuationObservation = {
      fields: facts.fields,
      ceremony: facts.ceremony,
      controlLabel: "",
      controlMachineIdentity: "",
    };
    const cached = this.implicitSubmissionPolicies.get(this.policyKey(request));
    if (typeof cached === "boolean") return cached;
    return companionExtensionRuntimePresent()
      ? false
      : authentication_implicit_submit_actuation_is_safe(request);
  }

  async prepareCompanionWorkflowPolicies(): Promise<void> {
    const collection = {
      transportability: [] as AuthenticationControlTransportability[],
      advanceControls: [] as AuthenticationAdvanceControlObservation[],
      passkeyCandidates:
        [] as AuthenticationDetailedPasskeyControlCandidateObservation[],
      pageFacts: [] as AuthenticationPageObservationFacts[],
      implicitSubmissions:
        [] as AuthenticationImplicitSubmitActuationObservation[],
    };
    this.collectingPolicies = collection;
    try {
      this.summarizeAuthenticationWorkflowForms();
    } finally {
      this.collectingPolicies = false;
    }
    const delivery = await sendCompanionWasmRuntimeMessage(this.browser, {
      type: CompanionWasmSessionMessageType.EvaluateAuthenticationPolicies,
      payload: collection,
      origin: this.browser.location.origin,
    });
    this.transportabilityPolicies.clear();
    this.advanceControlPolicies.clear();
    this.passkeyCandidatePolicies.clear();
    this.pageFactsPriorities.clear();
    this.implicitSubmissionPolicies.clear();
    this.activityProgress.clear();
    if (
      delivery.kind !== CompanionWasmRuntimeDeliveryKind.Delivered ||
      !delivery.response ||
      typeof delivery.response !== "object" ||
      !("transportability" in delivery.response) ||
      !("advanceControls" in delivery.response) ||
      !("passkeyCandidates" in delivery.response) ||
      !("pageFactsPriorities" in delivery.response) ||
      !("activityProgress" in delivery.response) ||
      !("implicitSubmissions" in delivery.response)
    ) {
      return;
    }
    const response = delivery.response;
    collection.transportability.forEach((request, index) =>
      this.transportabilityPolicies.set(
        this.policyKey(request),
        response.transportability[index] === true,
      ),
    );
    collection.advanceControls.forEach((request, index) =>
      this.advanceControlPolicies.set(
        this.policyKey(request),
        response.advanceControls[index] === true,
      ),
    );
    collection.passkeyCandidates.forEach((request, index) =>
      this.passkeyCandidatePolicies.set(
        this.policyKey(request),
        response.passkeyCandidates[index] === true,
      ),
    );
    collection.pageFacts.forEach((request, index) => {
      const priority = response.pageFactsPriorities[index];
      if (typeof priority === "number") {
        this.pageFactsPriorities.set(this.policyKey(request), priority);
      }
    });
    [
      AuthenticationWorkflowActivity.ReadyLogin,
      AuthenticationWorkflowActivity.FillingLogin,
      AuthenticationWorkflowActivity.VerifyingLogin,
      AuthenticationWorkflowActivity.FillingAuthenticator,
      AuthenticationWorkflowActivity.SaveOffer,
    ].forEach((activity, index) => {
      const progress = response.activityProgress[index];
      if (progress) this.activityProgress.set(activity, progress);
    });
    const implicitSubmissions = this.summarizeAuthenticationWorkflowForms().map(
      (observation): AuthenticationImplicitSubmitActuationObservation => {
        const facts = this.authenticationPageObservationFacts({
          observation,
          authenticatorSetupHint: false,
        });
        return {
          fields: facts.fields,
          ceremony: facts.ceremony,
          controlLabel: "",
          controlMachineIdentity: "",
        };
      },
    );
    const implicitDelivery = await sendCompanionWasmRuntimeMessage(
      this.browser,
      {
        type: CompanionWasmSessionMessageType.EvaluateAuthenticationPolicies,
        payload: {
          transportability: [],
          advanceControls: [],
          passkeyCandidates: [],
          pageFacts: [],
          implicitSubmissions,
        },
        origin: this.browser.location.origin,
      },
    );
    if (
      implicitDelivery.kind !== CompanionWasmRuntimeDeliveryKind.Delivered ||
      !implicitDelivery.response ||
      typeof implicitDelivery.response !== "object" ||
      !("implicitSubmissions" in implicitDelivery.response)
    ) {
      return;
    }
    const implicitResponses: readonly boolean[] =
      implicitDelivery.response.implicitSubmissions;
    implicitSubmissions.forEach((request, index) =>
      this.implicitSubmissionPolicies.set(
        this.policyKey(request),
        implicitResponses[index] === true,
      ),
    );
  }

  private passwordFormPriority(observation: PasswordFormObservation): number {
    const factsRequest: AuthenticationObservationFactsRequest = {
      observation,
      authenticatorSetupHint: false,
      backupCodesCopy: "",
    };
    const facts = this.authenticationPageObservationFacts(factsRequest);
    if (this.collectingPolicies) {
      this.collectingPolicies.pageFacts.push(facts);
      return 0;
    }
    const cached = this.pageFactsPriorities.get(this.policyKey(facts));
    if (typeof cached === "number") return cached;
    return companionExtensionRuntimePresent()
      ? 0
      : authentication_page_observation_facts_priority(facts);
  }

  private scopedControlRoot({
    root,
    formScope,
  }: PasswordFormObservation): ParentNode {
    return formScope.kind === PasswordFormScopeKind.Owned &&
      (root === formScope.owner.ownerDocument || root === formScope.owner)
      ? formScope.owner.ownerDocument
      : root;
  }

  protected scopedAdvanceControls(
    observation: PasswordFormObservation,
  ): LoginAdvanceControl[] {
    return Array.from(
      this.scopedControlRoot(observation).querySelectorAll<HTMLElement>(
        authenticationAdvanceControlSelector,
      ),
    ).flatMap((control) => {
      const controlScope =
        authenticationSubmissionControls.associatedAuthenticationForm(control);
      const isInScope =
        observation.formScope.kind === PasswordFormScopeKind.Owned
          ? controlScope.kind === PasswordFormScopeKind.Owned &&
            controlScope.owner === observation.formScope.owner
          : controlScope.kind === PasswordFormScopeKind.Unowned;
      return isInScope ? [control] : [];
    });
  }

  protected semanticSubmitControlsFirst(
    ...pair: SemanticSubmitControlPair
  ): number {
    return (
      Number(pair[1].matches(semanticSubmitControlSelector)) -
      Number(pair[0].matches(semanticSubmitControlSelector))
    );
  }

  private pageControlObservation({
    observation,
    control,
    authenticationUsername,
    explicitlyLocallyScoped = false,
    semanticSubmitControlCount,
  }: PageControlObservationRequest): CompleteAuthenticationAdvanceControlObservation {
    const semanticSubmit = control.matches(semanticSubmitControlSelector);
    const controlForm =
      authenticationSubmissionControls.associatedAuthenticationForm(control);
    const owned = controlForm.kind === PasswordFormScopeKind.Owned;
    const observedFormIdentityRequest: Parameters<
      typeof authenticationSubmissionControls.observedFormIdentity
    >[0] = {
      root: observation.root,
      formScope: observation.formScope,
    };
    const destinationIdentityRequest: Parameters<
      typeof authenticationSubmissionControls.controlDestinationIdentity
    >[0] = {
      control,
      formScope: observation.formScope,
    };

    return {
      actionability: authenticationSubmissionControls.controlIsInert(control)
        ? "inert"
        : "actionable",
      ownership: owned
        ? "owned-form"
        : explicitlyLocallyScoped ||
            (observation.root !== this.browser.document &&
              observation.root.contains(control))
          ? "locally-scoped"
          : "unowned",
      semantics: semanticSubmit ? "semantic-submit" : "activation",
      authenticationUsername,
      passwordFieldCount: observation.summary.passwordFieldCount,
      newPasswordFieldCount: observation.summary.newPasswordFieldCount,
      oneTimeCodeFieldCount: observation.summary.oneTimeCodeFieldCount,
      semanticSubmitControlCount,
      sourceOrigin: this.browser.location.origin,
      formIdentity: owned
        ? authenticationSubmissionControls.ownedFormIdentity(controlForm.owner)
        : authenticationSubmissionControls.observedFormIdentity(
            observedFormIdentityRequest,
          ),
      destinationIdentity:
        authenticationSubmissionControls.controlDestinationIdentity(
          destinationIdentityRequest,
        ),
      label: authenticationSubmissionControls.controlLabel(control),
      machineIdentity:
        authenticationSubmissionControls.controlMachineIdentity(control),
      submissionMethod:
        authenticationSubmissionControls.controlSubmissionMethod(control),
      submissionDestinationSource:
        AuthenticationSubmissionDestination.source(control),
    };
  }

  protected transportableControlObservation(
    request: PageControlObservationRequest,
  ): AuthenticationAdvanceControlObservation[] {
    const observation = this.pageControlObservation(request);
    const transportabilityRequest: AuthenticationControlTransportability = {
      submissionMethod: observation.submissionMethod,
      usernameFieldCount: request.observation.summary.usernameFieldCount,
    };
    if (
      !this.collectOrReadBooleanPolicy(
        transportabilityRequest,
        this.collectingPolicies
          ? this.collectingPolicies.transportability
          : false,
        this.transportabilityPolicies,
        authentication_control_transportable,
      )
    )
      return [];
    return authenticationSubmissionControls.authenticationFactStringsAreTransportable(
      [
        observation.sourceOrigin,
        observation.formIdentity,
        observation.destinationIdentity,
        observation.label,
        authenticationSubmissionControls.controlMachineIdentity(
          request.control,
        ),
      ],
    )
      ? [observation]
      : [];
  }

  private passkeyCandidateIsRustSafe({
    candidate,
    observation,
  }: PasskeyCandidateSafetyRequest): boolean {
    const { control, explicitlyMarked } = candidate;
    if (!authenticationSubmissionControls.isRenderedControl(control))
      return false;
    const adjacencyRequest: LocalOwnedFormAdjacencyRequest | false =
      observation.formScope.kind === PasswordFormScopeKind.Owned
        ? { control, owner: observation.formScope.owner }
        : false;
    const observationRequest: PageControlObservationRequest = {
      observation,
      control,
      authenticationUsername:
        passwordFieldDiscovery.usernameEvidence(observation),
      semanticSubmitControlCount:
        authenticationSubmissionControls.countedSemanticSubmitControls(
          this.scopedAdvanceControls(observation),
        ),
      explicitlyLocallyScoped:
        (observation.root === this.browser.document &&
          observation.formScope.kind === PasswordFormScopeKind.Unowned) ||
        Boolean(
          adjacencyRequest &&
          passwordFieldDiscovery.isLocallyAdjacentToOwnedForm(adjacencyRequest),
        ),
    };
    const [transported] =
      this.transportableControlObservation(observationRequest);
    if (!transported) return false;
    const safetyRequest: AuthenticationDetailedPasskeyControlCandidateObservation =
      {
        kind: explicitlyMarked ? "explicitly-marked" : "labeled",
        observation: transported,
      };
    return this.collectOrReadBooleanPolicy(
      safetyRequest,
      this.collectingPolicies
        ? this.collectingPolicies.passkeyCandidates
        : false,
      this.passkeyCandidatePolicies,
      authentication_passkey_control_candidate_is_safe,
    );
  }

  findWorkflowPasskeyControl(
    observation: PasswordFormObservation,
  ): PasskeyControlLookup {
    const liveSummaryRequest: PasswordFormScopeQuery = {
      kind: PasswordFormQueryKind.Scoped,
      root: observation.root,
      formScope: observation.formScope,
    };
    const liveObservation: PasswordFormObservation = {
      ...observation,
      summary: this.summarizeRoot(liveSummaryRequest),
    };
    const candidate = passwordFieldDiscovery
      .findPasskeyControls(this.scopedControlRoot(liveObservation))
      .find((passkeyCandidate) => {
        const associationRequest: ControlObservationAssociationRequest = {
          control: passkeyCandidate.control,
          formScope: liveObservation.formScope,
          root: liveObservation.root,
        };

        const safetyRequest: PasskeyCandidateSafetyRequest = {
          candidate: passkeyCandidate,
          observation: liveObservation,
        };
        return (
          passwordFieldDiscovery.controlAssociatesWithObservation(
            associationRequest,
          ) && this.passkeyCandidateIsRustSafe(safetyRequest)
        );
      });
    return candidate
      ? { kind: PasskeyControlLookupKind.Found, control: candidate.control }
      : { kind: PasskeyControlLookupKind.Absent };
  }

  authenticationPageObservationFacts({
    observation,
    authenticatorSetupHint,
    backupCodesHint = false,
    backupCodesCopy,
  }: AuthenticationObservationFactsRequest): AuthenticationPageObservationFacts {
    const controlRoot = this.scopedControlRoot(observation);
    const authenticationUsername =
      passwordFieldDiscovery.usernameEvidence(observation);
    const advanceControls = this.scopedAdvanceControls(observation).sort(
      this.semanticSubmitControlsFirst.bind(this),
    );
    const semanticSubmitControlCount = Math.min(
      advanceControls.filter((control) =>
        control.matches(semanticSubmitControlSelector),
      ).length,
      MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT,
    );
    const passkeyControls = passwordFieldDiscovery
      .findPasskeyControls(controlRoot)
      .filter(({ control }) => {
        const associationRequest: ControlObservationAssociationRequest = {
          control,
          formScope: observation.formScope,
          root: observation.root,
        };
        return passwordFieldDiscovery.controlAssociatesWithObservation(
          associationRequest,
        );
      });

    const observationScopeQuery: PasswordFormScopeQuery = {
      kind: PasswordFormQueryKind.Scoped,
      root: observation.root,
      formScope: observation.formScope,
    };
    const oneTimeCodeBoundRequest: Parameters<
      typeof authenticationSubmissionControls.boundAuthenticationControlObservations<string>
    >[0] = {
      candidates: passwordFieldDiscovery
        .findOneTimeCodeFields(observationScopeQuery)
        .flatMap((field) =>
          ["oninput", "onchange"].flatMap((attribute) => {
            const handler = field.getAttribute(attribute);
            if (typeof handler !== "string") return [];
            const signal = `${attribute}=${handler}`;
            return authenticationSubmissionControls.authenticationPolicyTextFits(
              signal,
            )
              ? [signal]
              : [];
          }),
        ),
      isPreferred: (signal) =>
        passwordFieldDiscovery.looksLikeOneTimeCodeAutoSubmitSignal(signal),
    };
    const oneTimeCodeHandlerSignals =
      authenticationSubmissionControls.boundAuthenticationControlObservations(
        oneTimeCodeBoundRequest,
      );
    const passwordFields = passwordFieldDiscovery.findPasswordFields(
      observationScopeQuery,
    );
    const readonlyPasswordFieldCount = passwordFields.filter(
      (field) => field.readOnly,
    ).length;
    let detailedAdvanceControl: AuthenticationPageObservationFacts["detailedAdvanceControl"] =
      { kind: PasskeyControlLookupKind.Absent };
    const advanceObservations = advanceControls.flatMap((control) => {
      const observationRequest: PageControlObservationRequest = {
        observation,
        control,
        authenticationUsername,
        semanticSubmitControlCount,
      };
      return this.transportableControlObservation(observationRequest);
    });
    const advanceBoundRequest: Parameters<
      typeof authenticationSubmissionControls.boundAuthenticationControlObservations<
        (typeof advanceObservations)[number]
      >
    >[0] = {
      candidates: advanceObservations,
      isPreferred: (candidate) =>
        candidate.actionability === "actionable" &&
        this.advanceControlIsSafe(candidate),
    };
    const boundedAdvanceObservations =
      authenticationSubmissionControls.boundAuthenticationControlObservations(
        advanceBoundRequest,
      );
    if (boundedAdvanceObservations.length > 0) {
      detailedAdvanceControl = {
        kind: "observed",
        observations: boundedAdvanceObservations,
      };
    }
    let detailedPasskeyControl: AuthenticationDetailedPasskeyControlObservation =
      { kind: PasskeyControlLookupKind.Absent };
    const passkeyCandidates = passkeyControls.flatMap(
      ({ control, explicitlyMarked }) => {
        const adjacencyRequest: LocalOwnedFormAdjacencyRequest | false =
          observation.formScope.kind === PasswordFormScopeKind.Owned
            ? { control, owner: observation.formScope.owner }
            : false;
        const observationRequest: PageControlObservationRequest = {
          observation,
          control,
          authenticationUsername,
          semanticSubmitControlCount,
          explicitlyLocallyScoped:
            (observation.root === this.browser.document &&
              observation.formScope.kind === PasswordFormScopeKind.Unowned) ||
            Boolean(
              adjacencyRequest &&
              passwordFieldDiscovery.isLocallyAdjacentToOwnedForm(
                adjacencyRequest,
              ),
            ),
        };
        return this.transportableControlObservation(observationRequest).map(
          (candidateObservation) =>
            ({
              kind: explicitlyMarked ? "explicitly-marked" : "labeled",
              observation: candidateObservation,
            }) as AuthenticationDetailedPasskeyControlCandidateObservation,
        );
      },
    );
    const passkeyBoundRequest: Parameters<
      typeof authenticationSubmissionControls.boundAuthenticationControlObservations<
        (typeof passkeyCandidates)[number]
      >
    >[0] = {
      candidates: passkeyCandidates,
      isPreferred: (candidate) =>
        candidate.observation.actionability === "actionable" &&
        this.passkeyCandidateIsSafe(candidate),
      isNextPreferred: (candidate) =>
        candidate.observation.actionability === "actionable",
    };
    const boundedPasskeyCandidates =
      authenticationSubmissionControls.boundAuthenticationControlObservations(
        passkeyBoundRequest,
      );
    if (boundedPasskeyCandidates.length > 0) {
      detailedPasskeyControl = {
        kind: "candidates",
        observation: boundedPasskeyCandidates,
      };
    }

    const contextFormIdentityRequest: Parameters<
      typeof authenticationSubmissionControls.observedFormIdentity
    >[0] = {
      root: observation.root,
      formScope: observation.formScope,
    };
    const contextFormIdentity =
      authenticationSubmissionControls.observedFormIdentity(
        contextFormIdentityRequest,
      );
    const contextDestinationIdentity =
      authenticationSubmissionControls.observedFormDestination(
        observation.formScope,
      );
    const implicitSubmissionAvailable =
      observation.formScope.kind === PasswordFormScopeKind.Owned &&
      !passwordFieldDiscovery.ownedObservationIsLocallyBounded(observation) &&
      !boundedAdvanceObservations.some(
        (candidate) =>
          candidate.actionability === "actionable" &&
          this.advanceControlIsSafe(candidate),
      ) &&
      !advanceControls.some(
        (control) =>
          control.matches(semanticSubmitControlSelector) &&
          !authenticationSubmissionControls.controlIsInert(control),
      ) &&
      !(
        observation.summary.currentPasswordFieldCount +
          observation.summary.genericPasswordFieldCount +
          observation.summary.newPasswordFieldCount >
          0 &&
        authenticationSubmissionControls.formBlocksCredentialDisclosure(
          observation.formScope.owner,
        )
      );
    let credentialSubmission: AuthenticationCredentialSubmissionObservation = {
      kind: credentialSubmissionAbsent,
    };
    const selectedAdvanceObservation = boundedAdvanceObservations[0];
    const selectedSubmissionMethod =
      selectedAdvanceObservation?.submissionMethod;
    if (
      selectedAdvanceObservation &&
      selectedAdvanceObservation.actionability === "actionable" &&
      selectedSubmissionMethod &&
      selectedSubmissionMethod !== PageControlSubmissionMethod.Absent
    ) {
      credentialSubmission = {
        kind: credentialSubmissionObserved,
        facts: {
          actionability: selectedAdvanceObservation.actionability,
          method: selectedSubmissionMethod,
          sourceOrigin: selectedAdvanceObservation.sourceOrigin,
          formIdentity: selectedAdvanceObservation.formIdentity,
          destinationIdentity: selectedAdvanceObservation.destinationIdentity,
        },
      };
    } else if (
      implicitSubmissionAvailable &&
      observation.formScope.kind === PasswordFormScopeKind.Owned
    ) {
      credentialSubmission = {
        kind: credentialSubmissionObserved,
        facts: {
          actionability: "actionable",
          method: authenticationSubmissionControls.formSubmissionMethod(
            observation.formScope.owner,
          ),
          sourceOrigin: this.browser.location.origin,
          formIdentity: contextFormIdentity,
          destinationIdentity: contextDestinationIdentity,
        },
      };
    }
    return {
      fields: {
        usernameFieldCount: observation.summary.usernameFieldCount,
        currentPasswordFieldCount:
          observation.summary.currentPasswordFieldCount,
        newPasswordFieldCount: observation.summary.newPasswordFieldCount,
        genericPasswordFieldCount:
          observation.summary.genericPasswordFieldCount,
        oneTimeCodeFieldCount: observation.summary.oneTimeCodeFieldCount,
        actionablePasswordFieldCount:
          passwordFields.length - readonlyPasswordFieldCount,
        readonlyPasswordFieldCount,
      },
      ceremony: {
        oneTimeCodeProgression: "advance-control-required",
        oneTimeCodeHandlerSignal: "",
        oneTimeCodeHandlerSignals,
        authenticationContext: {
          authenticationUsername,
          sourceOrigin: this.browser.location.origin,
          formIdentity: contextFormIdentity,
          destinationIdentity: contextDestinationIdentity,
        },
        manualCheckpoint: observation.summary.manualCheckpointPresent
          ? "present"
          : "absent",
        implicitSubmissionMethod:
          observation.formScope.kind === PasswordFormScopeKind.Owned &&
          !passwordFieldDiscovery.ownedObservationIsLocallyBounded(observation)
            ? authenticationSubmissionControls.formSubmissionMethod(
                observation.formScope.owner,
              )
            : PageControlSubmissionMethod.Absent,
        advanceControl: implicitSubmissionAvailable
          ? "implicit-submission"
          : "absent",
      },
      authenticator: {
        authenticatorSetup: authenticatorSetupHint ? "present" : "absent",
        backupCodesCopy: ((
          ...[v = backupCodesHint ? "Save backup codes" : ""]
        ) => v)(backupCodesCopy),
        passkeyControl:
          passkeyControls.length > 0
            ? passkeyControlPresent
            : passkeyControlAbsent,
        passkeyAccountAvailability: "unavailable",
        matchingPasskeyAccountCount: 0,
        detailedPasskeyControl,
      },
      credentialSubmission,
      detailedAdvanceControl,
    };
  }

  summarizeAuthenticationWorkflowForms(): PasswordFormObservation[] {
    const summaryRequest: PasswordAuthenticationWorkflowFormSummaryDependencies =
      {
        browser: this.browser,
        summarizeRoot: this.summarizeRoot.bind(this),
        observationPriority: this.passwordFormPriority.bind(this),
        passkeyControlIsSafe: this.passkeyCandidateIsRustSafe.bind(this),
      };
    return new PasswordAuthenticationWorkflowFormSummary(
      summaryRequest,
    ).summarize();
  }
}
