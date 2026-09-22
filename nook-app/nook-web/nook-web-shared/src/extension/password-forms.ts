/* eslint-disable max-params -- DOM policy collection uses browser-owned callback shapes at this boundary. */
import type { AuthenticationAdvanceControlObservation } from "./nook-companion-wasm/nook_companion_wasm.js";
import {
  authenticationAdvanceControlSelector,
  semanticSubmitControlSelector,
} from "./authentication-control-selectors";
import {
  PasswordFormScopeKind,
  type PasswordFormScope,
  passwordFieldDiscovery,
} from "./password-form-fields";
import {
  FormSubmissionResult,
  PageControlSubmissionMethod,
  PasswordFormQueryKind,
  type LoginAdvanceControl,
  type FormSubmissionApproval,
  type PasswordFormScopeQuery,
  MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT,
  authenticationSubmissionControls,
} from "./password-form-submission-controls";
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
import { PasswordFormFieldQuery } from "./password-form-summary-state";
import {
  ApprovedPasswordFormKind,
  CredentialDisclosureRevalidation,
  type ApprovedPasswordForm,
} from "./credential-disclosure-revalidation";
import {
  PasswordFormWorkflowObservation,
  type AuthenticationObservationFactsRequest,
  type PageControlObservationRequest,
  type PasswordFormObservation,
} from "./password-form-workflow-observation";

export type {
  PasswordFormObservation,
  PasswordFormSummary,
} from "./password-form-workflow-observation";

export {
  oneTimeCodeFieldSelectors,
  PasskeyControlLookupKind,
  PasswordFormScopeKind,
  usernameFieldSelectors,
  passwordFieldDiscovery,
} from "./password-form-fields";

export type {
  PasskeyControlLookup,
} from "./password-form-fields";
export type { PasswordFormScope };

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

export type LoginFormSubmissionRequest = PasswordFormScopeQuery & {
  submissionApproval?: FormSubmissionApproval;
  approvedAdvanceControls?: readonly AuthenticationAdvanceControlObservation[];
};

type OwnedAdvanceControlRequest =
  OwnedAuthenticationControlRequest<LoginFormSubmissionRequest>;
type OwnedAdvanceControlLookupRequest = OwnedAdvanceControlRequest & {
  allowAdmissiblePlanningControl?: boolean;
};

/** Owns this browser host’s resources and interaction lifecycle. */
class PasswordFormInteraction extends PasswordFormWorkflowObservation {
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
    const [passwordField] = passwordFields;
    if (!passwordField) {
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
    const passwordForm = passwordField.form;
    const approvedPasswordForm: ApprovedPasswordForm = passwordForm
      ? { kind: ApprovedPasswordFormKind.Available, form: passwordForm }
      : { kind: ApprovedPasswordFormKind.Unavailable };
    const scriptedGetLookupRequest: OwnedAdvanceControlLookupRequest | false =
      passwordForm
        ? {
            request,
            form: passwordForm,
            allowAdmissiblePlanningControl: true,
          }
        : false;
    const scriptedGetSubmitter = scriptedGetLookupRequest
      ? this.findApprovedOwnedAdvanceControl(scriptedGetLookupRequest)
      : false;
    const scriptedGetDisclosureInitiallyApproved = Boolean(
      passwordForm &&
      scriptedGetSubmitter &&
      this.ownedPasswordDisclosurePlanningIsApproved(
        request,
        passwordForm,
        scriptedGetSubmitter,
      ),
    );
    const scriptedGetFormScope: PasswordFormScope | false =
      passwordForm
        ? { kind: PasswordFormScopeKind.Owned, owner: passwordForm }
        : false;
    const scriptedGetDestinationRequest:
      | Parameters<
          typeof authenticationSubmissionControls.controlDestinationIdentity
        >[0]
      | false =
      scriptedGetSubmitter && scriptedGetFormScope
        ? { control: scriptedGetSubmitter, formScope: scriptedGetFormScope }
        : false;
    const scriptedGetDestination = scriptedGetDestinationRequest
      ? authenticationSubmissionControls.controlDestinationIdentity(
          scriptedGetDestinationRequest,
        )
      : "";
    const scriptedGetLabel = scriptedGetSubmitter
      ? authenticationSubmissionControls.controlLabel(scriptedGetSubmitter)
      : "";
    const scriptedGetMachineIdentity = scriptedGetSubmitter
      ? authenticationSubmissionControls.controlMachineIdentity(
          scriptedGetSubmitter,
        )
      : "";
    const scriptedGetApprovalRemainsBound = (
      form: HTMLFormElement,
    ): boolean => {
      if (
        !scriptedGetDisclosureInitiallyApproved ||
        passwordForm !== form ||
        !scriptedGetSubmitter ||
        !scriptedGetSubmitter.isConnected
      ) {
        return false;
      }
      const submitterScope =
        authenticationSubmissionControls.associatedAuthenticationForm(
          scriptedGetSubmitter,
        );
      if (
        submitterScope.kind !== PasswordFormScopeKind.Owned ||
        submitterScope.owner !== form
      ) {
        return false;
      }
      const currentFormScope: PasswordFormScope = {
        kind: PasswordFormScopeKind.Owned,
        owner: form,
      };
      const currentDestinationRequest: Parameters<
        typeof authenticationSubmissionControls.controlDestinationIdentity
      >[0] = {
        control: scriptedGetSubmitter,
        formScope: currentFormScope,
      };
      return (
        authenticationSubmissionControls.controlSubmissionMethod(
          scriptedGetSubmitter,
        ) === PageControlSubmissionMethod.Get &&
        authenticationSubmissionControls.controlDestinationIdentity(
          currentDestinationRequest,
        ) === scriptedGetDestination &&
        authenticationSubmissionControls.controlLabel(scriptedGetSubmitter) ===
          scriptedGetLabel &&
        authenticationSubmissionControls.controlMachineIdentity(
          scriptedGetSubmitter,
        ) === scriptedGetMachineIdentity
      );
    };
    const disclosureRevalidationRequest: ConstructorParameters<
      typeof CredentialDisclosureRevalidation
    >[0] = {
      passwordField,
      approvedPasswordForm,
      request,
      selectedSubmitter: (form) => {
        if (scriptedGetApprovalRemainsBound(form)) {
          return scriptedGetSubmitter;
        }
        const approvedAdvanceControlRequest: OwnedAdvanceControlRequest = {
          request,
          form,
        };
        const lookupRequest: OwnedAdvanceControlLookupRequest = {
          ...approvedAdvanceControlRequest,
          allowAdmissiblePlanningControl: true,
        };
        return this.findApprovedOwnedAdvanceControl(lookupRequest);
      },
      scriptedGetPasswordDisclosureIsApproved: (form) =>
        scriptedGetApprovalRemainsBound(form),
    };
    const disclosureRevalidation = new CredentialDisclosureRevalidation(
      disclosureRevalidationRequest,
    );
    if (disclosureRevalidation.blocks()) return false;
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
      if (disclosureRevalidation.blocks()) {
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
    if (disclosureRevalidation.blocks()) {
      passwordFormCredentialInteraction.clearLoginCredentials(request);
      return false;
    }
    return true;
  }

  private findApprovedOwnedAdvanceControl({
    request,
    form,
    allowAdmissiblePlanningControl = false,
  }: OwnedAdvanceControlLookupRequest): LoginAdvanceControl | false {
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
    if (!observation) return false;
    const scopedControls = this.scopedAdvanceControls(observation);
    const semanticSubmitControlCount = Math.min(
      scopedControls.filter((control) =>
        control.matches(semanticSubmitControlSelector),
      ).length,
      MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT,
    );
    return ((v) => (v ? v : false))(
      scopedControls
        .sort(this.semanticSubmitControlsFirst.bind(this))
        .find((control) => {
          if (!authenticationSubmissionControls.isRenderedControl(control))
            return false;
          const observationRequest: PageControlObservationRequest = {
            observation,
            control,
            authenticationUsername:
              passwordFieldDiscovery.usernameEvidence(observation),
            semanticSubmitControlCount,
          };
          const [transported] =
            this.transportableControlObservation(observationRequest);
          if (!transported) return false;
          if (this.advanceControlIsSafe(transported)) return true;
          if (
            !allowAdmissiblePlanningControl ||
            !control.matches(semanticSubmitControlSelector)
          ) {
            return false;
          }
          return this.advanceControlAllowsPasswordDisclosurePlanning(
            transported,
          );
        }),
    );
  }

  private ownedPasswordDisclosurePlanningIsApproved(
    request: LoginCredentialsFillRequest,
    form: HTMLFormElement,
    control: LoginAdvanceControl,
  ): boolean {
    const formScope: PasswordFormScope = {
      kind: PasswordFormScopeKind.Owned,
      owner: form,
    };
    const summaryRequest: PasswordFormScopeQuery = {
      kind: PasswordFormQueryKind.Scoped,
      root: request.root,
      formScope,
    };
    const observation: PasswordFormObservation = {
      root: request.root,
      formScope,
      summary: this.summarizeRoot(summaryRequest),
    };
    const observationRequest: PageControlObservationRequest = {
      observation,
      control,
      authenticationUsername:
        passwordFieldDiscovery.usernameEvidence(observation),
      semanticSubmitControlCount: Math.min(
        this.scopedAdvanceControls(observation).filter((candidate) =>
          candidate.matches(semanticSubmitControlSelector),
        ).length,
        MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT,
      ),
    };
    const [transported] =
      this.transportableControlObservation(observationRequest);
    return Boolean(
      transported &&
      this.advanceControlAllowsPasswordDisclosurePlanning(transported),
    );
  }

  private activateApprovedOwnedAdvanceControl({
    request,
    form,
  }: OwnedAdvanceControlRequest): OwnedAdvanceControlActivation {
    const approvedAdvanceControlRequest: OwnedAdvanceControlRequest = {
      request,
      form,
    };
    const approved = this.findApprovedOwnedAdvanceControl(
      approvedAdvanceControlRequest,
    );
    if (!approved) return { kind: OwnedAdvanceControlActivationKind.Absent };
    if (
      !approved.matches(semanticSubmitControlSelector) ||
      (!(approved instanceof HTMLButtonElement) &&
        !(approved instanceof HTMLInputElement))
    ) {
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

  private findApprovedUnownedAdvanceControl(
    request: LoginFormSubmissionRequest,
    usernameField: HTMLInputElement,
  ): LoginAdvanceControl | false {
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
                candidate.formScope.kind === PasswordFormScopeKind.Unowned &&
                candidate.root.contains(usernameField),
            ),
          );
    if (!observation) return false;
    const approvedControls = ((value) => (value ? value : []))(
      request.approvedAdvanceControls,
    );
    const controls = this.scopedAdvanceControls(observation);
    const semanticSubmitControlCount =
      authenticationSubmissionControls.countedSemanticSubmitControls(
        Array.from(
          observation.root.querySelectorAll<HTMLElement>(
            authenticationAdvanceControlSelector,
          ),
        ),
      );
    const observedControls = controls.flatMap((control) => {
      if (!authenticationSubmissionControls.isRenderedControl(control))
        return [];
      const observationRequest: PageControlObservationRequest = {
        observation,
        control,
        authenticationUsername:
          passwordFieldDiscovery.usernameEvidence(observation),
        semanticSubmitControlCount,
      };
      const [transported] =
        this.transportableControlObservation(observationRequest);
      return transported ? [{ control, observation: transported }] : [];
    });
    const observationsMatch = (
      approved: (typeof approvedControls)[number],
      transported: (typeof observedControls)[number]["observation"],
    ) =>
      approved.actionability === transported.actionability &&
      approved.ownership === transported.ownership &&
      approved.semantics === transported.semantics &&
      approved.sourceOrigin === transported.sourceOrigin &&
      approved.formIdentity === transported.formIdentity &&
      approved.destinationIdentity === transported.destinationIdentity &&
      approved.label === transported.label &&
      approved.machineIdentity === transported.machineIdentity;
    for (const approved of approvedControls) {
      if (!this.advanceControlIsSafe(approved)) continue;
      const matched = observedControls.find(({ observation: transported }) =>
        observationsMatch(approved, transported),
      );
      if (!matched || !this.advanceControlIsSafe(matched.observation)) continue;
      const approvedDescendants = observedControls.filter(
        ({ control, observation: transported }) =>
          control !== matched.control &&
          matched.control.contains(control) &&
          this.advanceControlIsSafe(transported) &&
          approvedControls.some((candidate) =>
            observationsMatch(candidate, transported),
          ),
      );
      for (const approvedDescendant of approvedDescendants.reverse()) {
        return approvedDescendant.control;
      }
      return matched.control;
    }
    return false;
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
      const activationRequest: OwnedAdvanceControlRequest = {
        request,
        form,
      };
      const activation =
        this.activateApprovedOwnedAdvanceControl(activationRequest);
      if (activation.kind === OwnedAdvanceControlActivationKind.Activated) {
        return activation.result;
      }
    }
    if (
      request.kind === PasswordFormQueryKind.Scoped &&
      passwordFieldDiscovery.ownedObservationIsLocallyBounded(request)
    )
      return FormSubmissionResult.NotObserved;
    if ((!passwordField || !form) && usernameField) {
      const approved = this.findApprovedUnownedAdvanceControl(
        request,
        usernameField,
      );
      if (approved) {
        approved.click();
        return FormSubmissionResult.Submitted;
      }
    }
    if (!form) return FormSubmissionResult.NotObserved;
    const implicitSubmitRequest: ApprovedImplicitAuthenticationSubmitRequest<PasswordFormObservation> =
      {
        root: request.root,
        form,
        observations: this.summarizeAuthenticationWorkflowForms.bind(this),
        factsForObservation: (observation) => {
          const factsRequest: AuthenticationObservationFactsRequest = {
            observation,
            authenticatorSetupHint: false,
          };
          return this.authenticationPageObservationFacts(factsRequest);
        },
        hasAuthenticationUsername,
        hasAuthenticationPassword: Boolean(passwordField),
        requestedApproval: ((v) => (v ? v : false))(request.submissionApproval),
        implicitActuationIsSafe:
          this.authenticationImplicitSubmitActuationIsSafe.bind(this),
      };
    return new ApprovedImplicitAuthenticationSubmission(
      implicitSubmitRequest,
    ).execute();
  }
}

export const passwordFormInteraction = new PasswordFormInteraction(globalThis);
