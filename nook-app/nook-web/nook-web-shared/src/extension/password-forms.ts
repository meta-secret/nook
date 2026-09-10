/* eslint-disable nook-typed-api/no-raw-object-arguments -- Existing call shapes are preserved for this lint-only fix. */
import { PasswordFormSummaryObservation } from "./password-form-summary-observation";
import { companionWasmReady } from "./companion-ready";
import {
  authentication_advance_control_is_safe,
  authentication_control_transportable,
  authentication_page_observation_facts_priority,
  authentication_passkey_control_candidate_is_safe,
  looks_like_one_time_code_auto_submit_signal,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import type {
  AuthenticationAdvanceControlObservation,
  AuthenticationDetailedPasskeyControlCandidateObservation,
  AuthenticationDetailedPasskeyControlObservation,
  AuthenticationCredentialSubmissionObservation,
  AuthenticationPageObservationFacts,
  AuthenticationPasskeyControlObservation,
  AuthenticationUsernameEvidence,
} from "./nook-companion-wasm/nook_companion_wasm.js";
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
  AuthenticationSubmissionDestination,
  authenticationAdvanceControlSelector,
  FormSubmissionResult,
  MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT,
  PageControlSubmissionMethod,
  PasswordFormQueryKind,
  semanticSubmitControlSelector,
  type LoginAdvanceControl,
  type FormSubmissionApproval,
  type PasswordFormScopeQuery,
  authenticationSubmissionControls,
} from "./password-form-submission-controls";
import {
  IndependentPasskeyWorkflows,
  PasskeyOnlyWorkflowSummary,
} from "./password-form-passkey-only-workflows";
import {
  type LoginCredentialsFillRequest,
  passwordFormCredentialInteraction,
} from "./password-form-field-actions";
import {
  OwnedAdvanceControlActivationKind,
  ApprovedImplicitAuthenticationSubmission,
  type ApprovedImplicitAuthenticationSubmitRequest,
  type OwnedAdvanceControlActivation,
  type OwnedAuthenticationControlRequest,
} from "./password-form-implicit-actuation";
import {
  emptyPasswordFormSummary,
  PasswordFormFieldQuery,
} from "./password-form-summary-state";

export {
  oneTimeCodeFieldSelectors,
  PasskeyControlLookupKind,
  PasswordFormScopeKind,
  usernameFieldSelectors,
  passwordFieldDiscovery,
} from "./password-form-fields";

export type {
  PasskeyControlLookup,
  PasswordFormScope,
} from "./password-form-fields";

export { passwordFormCredentialInteraction } from "./password-form-field-actions";

export type {
  GeneratedPasswordFillRequest,
  LoginCredentials,
  LoginCredentialsFillRequest,
  LoginCredentialsLookup,
  OneTimeCodeFillRequest,
} from "./password-form-field-actions";

export { LoginCredentialsLookupKind } from "./password-form-field-actions";

export {
  FormSubmissionResult,
  PasswordFormQueryKind,
  type PasswordFormScopeQuery,
} from "./password-form-submission-controls";

void companionWasmReady;

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

type AuthenticationObservationFactsRequest = {
  observation: PasswordFormObservation;
  authenticatorSetupHint: boolean;
  backupCodesHint?: boolean;
  backupCodesCopy?: string;
};

type SemanticSubmitControlPair = [LoginAdvanceControl, LoginAdvanceControl];

type PageControlObservationRequest = {
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

export type LoginFormSubmissionRequest = PasswordFormScopeQuery & {
  submissionApproval?: FormSubmissionApproval;
};

type OwnedAdvanceControlRequest =
  OwnedAuthenticationControlRequest<LoginFormSubmissionRequest>;

/** Owns this browser host’s resources and interaction lifecycle. */
class PasswordFormInteraction extends PasswordFormSummaryObservation {
  private passwordFormPriority(observation: PasswordFormObservation): number {
    return authentication_page_observation_facts_priority(
      this.authenticationPageObservationFacts({
        observation,
        authenticatorSetupHint: false,
        backupCodesCopy: "",
      }),
    );
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

  private scopedAdvanceControls(
    observation: PasswordFormObservation,
  ): LoginAdvanceControl[] {
    return Array.from(
      this.scopedControlRoot(observation).querySelectorAll<HTMLElement>(
        authenticationAdvanceControlSelector,
      ),
    ).filter((control): control is LoginAdvanceControl => {
      if (!(
        control instanceof HTMLButtonElement ||
        control instanceof HTMLInputElement
      ))
        return false;
      return observation.formScope.kind === PasswordFormScopeKind.Owned
        ? control.form === observation.formScope.owner
        : !control.form;
    });
  }

  private semanticSubmitControlsFirst(
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
        : // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
          authenticationSubmissionControls.observedFormIdentity({
            root: observation.root,
            formScope: observation.formScope,
          }),
      destinationIdentity:
        authenticationSubmissionControls.controlDestinationIdentity({
          control,
          formScope: observation.formScope,
        }),
      label: authenticationSubmissionControls.controlLabel(control),
      machineIdentity:
        authenticationSubmissionControls.controlMachineIdentity(control),
      submissionMethod:
        authenticationSubmissionControls.controlSubmissionMethod(control),
      submissionDestinationSource:
        AuthenticationSubmissionDestination.source(control),
    };
  }

  private transportableControlObservation(
    request: PageControlObservationRequest,
  ): AuthenticationAdvanceControlObservation[] {
    const observation = this.pageControlObservation(request);
    if (
      !authentication_control_transportable({
        submissionMethod: observation.submissionMethod,
        usernameFieldCount: request.observation.summary.usernameFieldCount,
      })
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
    const [transported] = this.transportableControlObservation({
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
    });
    if (!transported) return false;
    return authentication_passkey_control_candidate_is_safe({
      kind: explicitlyMarked ? "explicitly-marked" : "labeled",
      observation: transported,
    });
  }

  findWorkflowPasskeyControl(
    observation: PasswordFormObservation,
  ): PasskeyControlLookup {
    const liveObservation: PasswordFormObservation = {
      ...observation,
      summary: this.summarizeRoot({
        kind: PasswordFormQueryKind.Scoped,
        root: observation.root,
        formScope: observation.formScope,
      }),
    };
    const candidate = passwordFieldDiscovery
      .findPasskeyControls(this.scopedControlRoot(liveObservation))
      .find((passkeyCandidate) => {
        const associationRequest: ControlObservationAssociationRequest = {
          control: passkeyCandidate.control,
          formScope: liveObservation.formScope,
          root: liveObservation.root,
        };

        return (
          passwordFieldDiscovery.controlAssociatesWithObservation(
            associationRequest,
          ) &&
          this.passkeyCandidateIsRustSafe({
            candidate: passkeyCandidate,
            observation: liveObservation,
          })
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
        return passwordFieldDiscovery.controlAssociatesWithObservation({
          control,
          formScope: observation.formScope,
          root: observation.root,
        });
      });

    const oneTimeCodeBoundRequest: Parameters<
      typeof authenticationSubmissionControls.boundAuthenticationControlObservations<string>
    >[0] = {
      candidates: passwordFieldDiscovery
        .findOneTimeCodeFields({
          root: observation.root,
          formScope: observation.formScope,
        })
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
        looks_like_one_time_code_auto_submit_signal(signal),
    };
    const oneTimeCodeHandlerSignals =
      authenticationSubmissionControls.boundAuthenticationControlObservations(
        oneTimeCodeBoundRequest,
      );
    const passwordFields = passwordFieldDiscovery.findPasswordFields({
      root: observation.root,
      formScope: observation.formScope,
    });
    const readonlyPasswordFieldCount = passwordFields.filter(
      (field) => field.readOnly,
    ).length;
    let detailedAdvanceControl: AuthenticationPageObservationFacts["detailedAdvanceControl"] =
      { kind: PasskeyControlLookupKind.Absent };
    const advanceObservations = advanceControls.flatMap((control) => {
      return this.transportableControlObservation({
        observation,
        control,
        authenticationUsername,
        semanticSubmitControlCount,
      });
    });
    const advanceBoundRequest: Parameters<
      typeof authenticationSubmissionControls.boundAuthenticationControlObservations<
        (typeof advanceObservations)[number]
      >
    >[0] = {
      candidates: advanceObservations,
      isPreferred: (candidate) =>
        candidate.actionability === "actionable" &&
        authentication_advance_control_is_safe(candidate),
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
        return this.transportableControlObservation({
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
        }).map(
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
        authentication_passkey_control_candidate_is_safe(candidate),
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

    const contextFormIdentity =
      authenticationSubmissionControls.observedFormIdentity({
        root: observation.root,
        formScope: observation.formScope,
      });
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
          authentication_advance_control_is_safe(candidate),
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
    const root = this.browser.document;
    const allPasswordFields = passwordFieldDiscovery.findPasswordFields({
      root,
    });
    const allUsernameFields = passwordFieldDiscovery.findUsernameFields({
      root,
    });
    const allOneTimeCodeFields = passwordFieldDiscovery.findOneTimeCodeFields({
      root,
    });
    const authUsernameFields = allUsernameFields.filter(
      passwordFieldDiscovery.isAuthUsernameField.bind(passwordFieldDiscovery),
    );
    const authFieldCount =
      allPasswordFields.length +
      authUsernameFields.length +
      allOneTimeCodeFields.length;
    const passkeyOnly = new PasskeyOnlyWorkflowSummary({
      root,
      summarizeRoot: this.summarizeRoot.bind(this),
      observationPriority: this.passwordFormPriority.bind(this),
      passkeyControlIsSafe: this.passkeyCandidateIsRustSafe.bind(this),
      emptySummary: emptyPasswordFormSummary,
    }).observations;
    if (authFieldCount === 0) {
      return passkeyOnly;
    }
    const forms = Array.from(
      root.querySelectorAll<HTMLFormElement>("form"),
    ).filter((form) => {
      const formScope: PasswordFormScope = {
        kind: PasswordFormScopeKind.Owned,
        owner: form,
      };
      const summary = this.summarizeRoot({
        kind: PasswordFormQueryKind.Scoped,
        root,
        formScope,
      });

      return (
        summary.passwordFieldCount > 0 ||
        summary.oneTimeCodeFieldCount > 0 ||
        passwordFieldDiscovery
          .findUsernameFields({
            root,
            formScope,
          })
          .some(
            passwordFieldDiscovery.isAuthUsernameField.bind(
              passwordFieldDiscovery,
            ),
          )
      );
    });
    const observations: PasswordFormObservation[] = forms.map((form) => {
      const formScope: PasswordFormScope = {
        kind: PasswordFormScopeKind.Owned,
        owner: form,
      };

      const observationRoot =
        passwordFieldDiscovery.localOwnedLoginObservationRoot({
          owner: form,
          passwordFields: allPasswordFields,
          usernameFields: authUsernameFields,
          oneTimeCodeFields: allOneTimeCodeFields,
        });

      return {
        root: observationRoot,
        formScope,
        summary: this.summarizeRoot({
          kind: PasswordFormQueryKind.Scoped,
          root: observationRoot,
          formScope,
        }),
      };
    });
    const unownedFields = [
      ...allPasswordFields,
      ...authUsernameFields,
      ...allOneTimeCodeFields,
    ].filter((field) => !field.form);
    const unownedContainers = new Set(
      unownedFields.flatMap((field) => {
        const container = passwordFieldDiscovery.nearestUnownedAuthContainer({
          field,
          root,
        });
        return container === field ? [] : [container];
      }),
    );
    for (const container of unownedContainers) {
      const formScope: PasswordFormScope = {
        kind: PasswordFormScopeKind.Unowned,
      };
      observations.push({
        root: container,
        formScope,
        summary: this.summarizeRoot({
          kind: PasswordFormQueryKind.Scoped,
          root: container,
          formScope,
        }),
      });
    }
    return new IndependentPasskeyWorkflows({
      fieldBearing: observations,
      passkeyOnly,
      observationPriority: this.passwordFormPriority.bind(this),
      passkeyControlIsSafe: this.passkeyCandidateIsRustSafe.bind(this),
    }).observations;
  }

  fillLoginCredentials(request: LoginCredentialsFillRequest): boolean {
    passwordFormCredentialInteraction.beginLoginCredentialFill(request);
    const nookTypedArgs0_18 = new PasswordFormFieldQuery(request).query;
    const observedPasswordFields =
      passwordFieldDiscovery.findPasswordFields(nookTypedArgs0_18);
    const passwordFields = observedPasswordFields.filter(
      (field) => !field.readOnly,
    );
    const nookTypedArgs0_19 = new PasswordFormFieldQuery(request).query;
    const usernameCandidates =
      passwordFieldDiscovery.findUsernameFields(nookTypedArgs0_19);
    const usernameField = usernameCandidates[0];
    if (observedPasswordFields.length > 0 && passwordFields.length === 0) {
      return false;
    }
    if (passwordFields.length === 0) {
      if (!usernameField) return false;
      const nookTypedArgs0_20: Parameters<
        typeof passwordFormCredentialInteraction.trackLoginCredentialField
      >[0] = {
        input: usernameField,
        request,
        value: request.credentials.username,
      };
      passwordFormCredentialInteraction.trackLoginCredentialField(
        nookTypedArgs0_20,
      );
      passwordFormCredentialInteraction.setNativeInputValue(nookTypedArgs0_20);
      usernameField.focus();
      return true;
    }
    const passwordField = passwordFields[0];
    const approvedPasswordForm = passwordField.form;
    const passwordFieldRemainsEligible = (): boolean =>
      !passwordField.readOnly &&
      passwordField.form === approvedPasswordForm &&
      passwordFieldDiscovery
        .findPasswordFields(new PasswordFormFieldQuery(request).query)
        .includes(passwordField);
    const formBlocksFill = (form: HTMLFormElement): boolean => {
      return authenticationSubmissionControls.selectedSubmitterBlocksCredentialDisclosure(
        {
          form,
          selectedSubmitter: this.findApprovedOwnedAdvanceControl({
            request,
            form,
          }),
        },
      );
    };
    function passwordFieldBlocksFill(): boolean {
      if (!passwordFieldRemainsEligible()) return true;
      return approvedPasswordForm
        ? formBlocksFill(approvedPasswordForm)
        : false;
    }
    if (passwordFieldBlocksFill()) return false;
    if (usernameField) {
      const nookTypedArgs0_21: Parameters<
        typeof passwordFormCredentialInteraction.trackLoginCredentialField
      >[0] = {
        input: usernameField,
        request,
        value: request.credentials.username,
      };
      passwordFormCredentialInteraction.trackLoginCredentialField(
        nookTypedArgs0_21,
      );
      passwordFormCredentialInteraction.setNativeInputValue(nookTypedArgs0_21);
      if (passwordFieldBlocksFill()) {
        passwordFormCredentialInteraction.clearLoginCredentials(request);
        return false;
      }
    }
    const nookTypedArgs0_22: Parameters<
      typeof passwordFormCredentialInteraction.trackLoginCredentialField
    >[0] = {
      input: passwordField,
      request,
      value: request.credentials.password,
    };
    passwordFormCredentialInteraction.trackLoginCredentialField(
      nookTypedArgs0_22,
    );
    passwordFormCredentialInteraction.setNativeInputValue(nookTypedArgs0_22);
    if (passwordFieldBlocksFill()) {
      passwordFormCredentialInteraction.clearLoginCredentials(request);
      return false;
    }
    return true;
  }

  private findApprovedOwnedAdvanceControl({
    request,
    form,
  }: OwnedAdvanceControlRequest): LoginAdvanceControl | false {
    const formWithinRequestRoot =
      request.root === form.ownerDocument ||
      (request.root instanceof Node && request.root.contains(form));
    const observation: PasswordFormObservation | false =
      request.kind === PasswordFormQueryKind.Scoped
        ? {
            root: request.root,
            formScope: request.formScope,
            summary: this.summarizeRoot(request),
          }
        : ((v) => (v ? v : false))(
            this.summarizeAuthenticationWorkflowForms().find(
              (candidate) =>
                formWithinRequestRoot &&
                candidate.formScope.kind === PasswordFormScopeKind.Owned &&
                candidate.formScope.owner === form,
            ),
          );
    return (
      observation &&
      ((v) => (v ? v : false))(
        this.scopedAdvanceControls(observation)
          .sort(this.semanticSubmitControlsFirst.bind(this))
          .find((control) => {
            if (!authenticationSubmissionControls.isRenderedControl(control))
              return false;
            const [transported] = this.transportableControlObservation({
              observation,
              control,
              authenticationUsername:
                passwordFieldDiscovery.usernameEvidence(observation),
              semanticSubmitControlCount:
                authenticationSubmissionControls.countedSemanticSubmitControls(
                  this.scopedAdvanceControls(observation),
                ),
            });
            return (
              Boolean(transported) &&
              authentication_advance_control_is_safe(transported)
            );
          }),
      )
    );
  }

  private activateApprovedOwnedAdvanceControl({
    request,
    form,
  }: OwnedAdvanceControlRequest): OwnedAdvanceControlActivation {
    const approved = this.findApprovedOwnedAdvanceControl({ request, form });
    if (!approved) return { kind: OwnedAdvanceControlActivationKind.Absent };
    if (!approved.matches(semanticSubmitControlSelector)) {
      approved.click();
      return {
        kind: OwnedAdvanceControlActivationKind.Activated,
        result: FormSubmissionResult.Submitted,
      };
    }
    const clickSubmission: Parameters<
      typeof authenticationSubmissionControls.observeSubmit
    >[0] = {
      form,
      action: () => approved.click(),
      approval: ((v) => (v ? v : false))(request.submissionApproval),
      expectedSubmitter: approved,
    };
    const result =
      authenticationSubmissionControls.observeSubmit(clickSubmission);
    if (
      result === FormSubmissionResult.NotObserved &&
      approved instanceof HTMLInputElement &&
      approved.type === "image"
    ) {
      clickSubmission.action = () => form.requestSubmit(approved);
      return {
        kind: OwnedAdvanceControlActivationKind.Activated,
        result: authenticationSubmissionControls.observeSubmit(clickSubmission),
      };
    }
    return {
      kind: OwnedAdvanceControlActivationKind.Activated,
      result,
    };
  }

  submitLoginForm(request: LoginFormSubmissionRequest): FormSubmissionResult {
    const nookTypedArgs0_26 = new PasswordFormFieldQuery(request).query;
    const passwordField =
      passwordFieldDiscovery.findPasswordFields(nookTypedArgs0_26)[0];
    const nookTypedArgs0_27 = new PasswordFormFieldQuery(request).query;
    const usernameFields =
      passwordFieldDiscovery.findUsernameFields(nookTypedArgs0_27);
    const usernameField = usernameFields[0];
    const hasAuthenticationUsername = usernameFields.some(
      passwordFieldDiscovery.isAuthUsernameField.bind(passwordFieldDiscovery),
    );
    const [anchor = usernameField] = [passwordField];
    if (!anchor) return FormSubmissionResult.NotObserved;
    const form = anchor.form;
    if (form) {
      const activation = this.activateApprovedOwnedAdvanceControl({
        request,
        form,
      });
      if (activation.kind === OwnedAdvanceControlActivationKind.Activated) {
        return activation.result;
      }
    }
    if (
      request.kind === PasswordFormQueryKind.Scoped &&
      passwordFieldDiscovery.ownedObservationIsLocallyBounded(request)
    )
      return FormSubmissionResult.NotObserved;
    if (!passwordField || !form) {
      if (
        authenticationSubmissionControls.clickAdvanceControl({
          ...request,
          usernameField,
        })
      )
        return FormSubmissionResult.Submitted;
    }
    if (!form) return FormSubmissionResult.NotObserved;
    const implicitSubmitRequest: ApprovedImplicitAuthenticationSubmitRequest<PasswordFormObservation> =
      {
        root: request.root,
        form,
        observations: this.summarizeAuthenticationWorkflowForms.bind(this),
        factsForObservation: (observation) => {
          return this.authenticationPageObservationFacts({
            observation,
            authenticatorSetupHint: false,
          });
        },
        hasAuthenticationUsername,
        hasAuthenticationPassword: Boolean(passwordField),
        requestedApproval: ((v) => (v ? v : false))(request.submissionApproval),
      };
    return new ApprovedImplicitAuthenticationSubmission(
      implicitSubmitRequest,
    ).execute();
  }
}

export const passwordFormInteraction = new PasswordFormInteraction(globalThis);
