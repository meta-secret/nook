import {
  AirbnbLoginModalRouteKind,
  isAirbnbLoginModalContinueControl,
  observeAirbnbLoginModalRoute,
  type AirbnbLoginModalContinueControlRequest,
  type AirbnbLoginModalRouteRequest,
} from "./airbnb-login-modal-route";
import { authenticationFactBounds } from "./authentication-fact-bounds";
import {
  authenticationAdvanceControlSelector,
  semanticSubmitControlSelector,
} from "./authentication-control-selectors";
import {
  authentication_advance_control_is_safe,
  can_activate_authentication_route_control,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import type {
  AuthenticationAdvanceControlObservation,
  PageControlSubmissionMethod as PageControlSubmissionMethodValue,
  PageControlSubmissionDestinationSource,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import {
  FormSubmissionResult,
  type AuthenticationSubmissionObservation,
  type FormSubmissionApproval,
  authenticationSubmissionBridge,
} from "./authentication-direct-submit-bridge";

export { FormSubmissionResult, type FormSubmissionApproval };
import {
  PasswordFormScopeKind,
  type AutocompleteTokenMatchRequest,
  type PasswordFieldQuery,
  type PasswordFormScope,
  type UnownedAuthContainerRequest,
  passwordFieldDiscovery,
} from "./password-form-fields";
import {
  AuthenticationSubmissionSemantics,
  PageControlSubmissionMethod,
} from "./authentication-submission-semantics";

export { PageControlSubmissionMethod };
export type PageControlSubmissionMethod = PageControlSubmissionMethodValue;

export enum PasswordFormQueryKind {
  Root = "root",
  Scoped = "scoped",
}

export type PasswordFormScopeQuery =
  | { kind: PasswordFormQueryKind.Root; root: ParentNode }
  | {
      kind: PasswordFormQueryKind.Scoped;
      root: ParentNode;
      formScope: PasswordFormScope;
    };

export type LoginAdvanceControl = HTMLElement;

export type LoginAdvanceControlRequest = PasswordFormScopeQuery & {
  usernameField: HTMLInputElement;
  advanceControlIsSafe?: (
    observation: AuthenticationAdvanceControlObservation,
  ) => boolean;
};

type AuthenticationRouteControlRequest = {
  control: LoginAdvanceControl;
  controlLabel: string;
  query: LoginAdvanceControlRequest;
};

type AuthenticationRouteDestinationRequest = {
  form: HTMLFormElement;
  control?: LoginAdvanceControl;
};

type FormSubmissionObservation = {
  form: HTMLFormElement;
  action: () => void;
  approval: FormSubmissionApproval | false;
  expectedSubmitter: LoginAdvanceControl | false;
};

type ObservedFormIdentityRequest = {
  root: ParentNode;
  formScope: PasswordFormScope;
};

type ControlDestinationIdentityRequest = {
  control: HTMLElement;
  formScope: PasswordFormScope;
};

type AuthenticationControlPreference<AuthenticationControlObservation> = (
  candidate: AuthenticationControlObservation,
) => boolean;

type BoundedAuthenticationControlObservationsRequest<
  AuthenticationControlObservation,
> = {
  candidates: AuthenticationControlObservation[];
  isPreferred: AuthenticationControlPreference<AuthenticationControlObservation>;
  isNextPreferred?: AuthenticationControlPreference<AuthenticationControlObservation>;
};

type ImplicitAuthenticationSubmitCapabilityRequest = {
  form: HTMLFormElement;
  sourceOrigin: string;
  destinationIdentity: string;
  hasAuthenticationUsername: boolean;
  hasAuthenticationPassword: boolean;
};

type ImplicitAuthenticationSubmitRequest = {
  form: HTMLFormElement;
  hasAuthenticationUsername: boolean;
  hasAuthenticationPassword: boolean;
  approval: FormSubmissionApproval | false;
  alternativeActuationIsSafe: () => boolean;
};

export const MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT =
  AuthenticationSubmissionSemantics.MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT;

export const MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS = 20;

export class AuthenticationSubmissionDestination {
  static source(control: HTMLElement): PageControlSubmissionDestinationSource {
    if (
      !authenticationSubmissionControls.controlHasNativeSubmitSemantics(control)
    )
      return "omitted";
    if (control.hasAttribute("formaction")) return "authored";
    const owner =
      authenticationSubmissionControls.associatedAuthenticationForm(control);
    if (owner.kind !== PasswordFormScopeKind.Owned) return "omitted";
    const routeRequest: AirbnbLoginModalRouteRequest = { form: owner.owner };
    const airbnbRoute = observeAirbnbLoginModalRoute(routeRequest);
    if (airbnbRoute.kind === AirbnbLoginModalRouteKind.Present) {
      return "omitted";
    }
    return owner.owner.hasAttribute("action") ? "authored" : "omitted";
  }
}

type UnownedLocalScopeRequest = {
  root: ParentNode;
  field: HTMLInputElement;
  control: HTMLElement;
};

/** Owns this browser host’s resources and interaction lifecycle. */
class AuthenticationSubmissionControls extends AuthenticationSubmissionSemantics {
  private neverNextPreferred(): boolean {
    return false;
  }

  rawOwnedFormIdentity(form: HTMLFormElement): string {
    return [
      form.id,
      ((v) => (v ? v : ""))(form.getAttribute("name")),
      ((v) => (v ? v : ""))(form.getAttribute("class")),
      ((v) => (v ? v : ""))(form.getAttribute("aria-label")),
    ]
      .filter(Boolean)
      .join(" ");
  }

  ownedFormIdentity(form: HTMLFormElement): string {
    return this.rawOwnedFormIdentity(form);
  }

  observedFormIdentity({
    root,
    formScope,
  }: ObservedFormIdentityRequest): string {
    const owner =
      formScope.kind === PasswordFormScopeKind.Owned ? formScope.owner : root;
    const element = owner.ownerDocument?.defaultView?.Element;
    if (!element || !(owner instanceof element)) return "";
    return [
      owner.id,
      owner.className,
      ((v) => (v ? v : ""))(owner.getAttribute("name")),
      ((v) => (v ? v : ""))(owner.getAttribute("role")),
      ((v) => (v ? v : ""))(owner.getAttribute("aria-label")),
    ]
      .filter(Boolean)
      .join(" ");
  }

  observedFormDestination(formScope: PasswordFormScope): string {
    return formScope.kind === PasswordFormScopeKind.Owned
      ? this.ownedFormDestinationIdentity(formScope.owner)
      : this.browser.location.href;
  }

  private rawFormDestinationIdentity(form: HTMLFormElement): string {
    return form.hasAttribute("action")
      ? form.action
      : ((v) => (v ? v : ""))(form.ownerDocument.defaultView?.location.href);
  }

  private formDestinationIdentity(form: HTMLFormElement): string {
    const routeRequest: AirbnbLoginModalRouteRequest = { form };
    const airbnbRoute = observeAirbnbLoginModalRoute(routeRequest);
    if (airbnbRoute.kind === AirbnbLoginModalRouteKind.Present) {
      return airbnbRoute.destinationIdentity;
    }
    return this.rawFormDestinationIdentity(form);
  }

  ownedFormDestinationIdentity(form: HTMLFormElement): string {
    return this.formDestinationIdentity(form);
  }

  controlDestinationIdentity({
    control,
    formScope,
  }: ControlDestinationIdentityRequest): string {
    const anchorElement = control.ownerDocument.defaultView?.HTMLAnchorElement;
    if (anchorElement && control instanceof anchorElement) {
      return control.href;
    }
    if (
      ((control.ownerDocument.defaultView?.HTMLButtonElement &&
        control instanceof
          control.ownerDocument.defaultView.HTMLButtonElement) ||
        (control.ownerDocument.defaultView?.HTMLInputElement &&
          control instanceof
            control.ownerDocument.defaultView.HTMLInputElement)) &&
      this.controlHasNativeSubmitSemantics(control) &&
      control.hasAttribute("formaction")
    ) {
      return control.formAction;
    }
    if (
      ((control.ownerDocument.defaultView?.HTMLButtonElement &&
        control instanceof
          control.ownerDocument.defaultView.HTMLButtonElement) ||
        (control.ownerDocument.defaultView?.HTMLInputElement &&
          control instanceof
            control.ownerDocument.defaultView.HTMLInputElement)) &&
      control.form
    ) {
      return this.formDestinationIdentity(control.form);
    }
    return formScope.kind === PasswordFormScopeKind.Owned
      ? this.formDestinationIdentity(formScope.owner)
      : this.browser.location.href;
  }

  boundAuthenticationControlObservations<AuthenticationControlObservation>({
    candidates,
    isPreferred,
    isNextPreferred = this.neverNextPreferred.bind(this),
  }: BoundedAuthenticationControlObservationsRequest<AuthenticationControlObservation>): AuthenticationControlObservation[] {
    const preferred = candidates.filter(isPreferred);
    const nextPreferred = candidates.filter(
      (candidate) => !isPreferred(candidate) && isNextPreferred(candidate),
    );
    const remaining = candidates.filter(
      (candidate) => !isPreferred(candidate) && !isNextPreferred(candidate),
    );
    return [...preferred, ...nextPreferred, ...remaining].slice(
      0,
      MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT,
    );
  }

  controlMachineIdentity(control: HTMLElement): string {
    const buttonElement = control.ownerDocument.defaultView?.HTMLButtonElement;
    const inputElement = control.ownerDocument.defaultView?.HTMLInputElement;
    const isButton = buttonElement && control instanceof buttonElement;
    const isInput = inputElement && control instanceof inputElement;
    if ((isButton || isInput) && control.form) {
      const continueControlRequest: AirbnbLoginModalContinueControlRequest = {
        form: control.form,
        control,
      };
      if (isAirbnbLoginModalContinueControl(continueControlRequest)) {
        return "";
      }
    }
    const namedValue =
      (isButton || isInput) && (control.name || control.value)
        ? `${control.name}=${control.value}`
        : "";
    return [
      control.id,
      namedValue,
      ((v) => (v ? v : ""))(control.getAttribute("class")),
    ]
      .filter(Boolean)
      .join(" ");
  }

  controlLabel(control: HTMLElement): string {
    const inputElement = control.ownerDocument.defaultView?.HTMLInputElement;
    const labelledBy = ((v) => (v ? v : ""))(
      control.getAttribute("aria-labelledby"),
    )
      .split(/\s+/u)
      .filter(Boolean)
      .flatMap((id) => {
        const label = control.ownerDocument.getElementById(id);
        return label ? [((v) => (v ? v : ""))(label.textContent)] : [];
      })
      .join(" ");
    return [
      ...new Set(
        [
          ((v) => (v ? v : ""))(control.textContent),
          ((v) => (v ? v : ""))(control.getAttribute("aria-label")),
          ((v) => (v ? v : ""))(control.getAttribute("title")),
          ((v) => (v ? v : ""))(control.getAttribute("alt")),
          inputElement && control instanceof inputElement
            ? control.value || control.getAttribute("alt") || "submit"
            : "",
          labelledBy,
        ]
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ].join(" ");
  }

  canRequestImplicitAuthenticationSubmit({
    form,
    sourceOrigin,
    destinationIdentity,
    hasAuthenticationUsername,
    hasAuthenticationPassword,
  }: ImplicitAuthenticationSubmitCapabilityRequest): boolean {
    return (
      authenticationFactBounds.controlTextsFit([
        sourceOrigin,
        this.rawOwnedFormIdentity(form),
      ]) &&
      can_activate_authentication_route_control(
        sourceOrigin,
        this.ownedFormIdentity(form),
        destinationIdentity,
        "",
        "",
        false,
        hasAuthenticationUsername,
        true,
        hasAuthenticationPassword,
      )
    );
  }

  requestImplicitAuthenticationSubmit({
    form,
    hasAuthenticationUsername,
    hasAuthenticationPassword,
    approval,
    alternativeActuationIsSafe,
  }: ImplicitAuthenticationSubmitRequest): FormSubmissionResult {
    const sourceOrigin = form.ownerDocument.defaultView?.location.origin;
    if (
      !sourceOrigin ||
      this.formHasSemanticSubmitter(form) ||
      this.formHasAriaDisabledSemanticSubmitter(form) ||
      typeof form.requestSubmit !== "function" ||
      (hasAuthenticationPassword && this.formBlocksCredentialDisclosure(form))
    ) {
      return FormSubmissionResult.NotObserved;
    }
    const destinationRequest: AuthenticationRouteDestinationRequest = {
      form,
    };
    const capabilityRequest: ImplicitAuthenticationSubmitCapabilityRequest = {
      form,
      sourceOrigin,
      destinationIdentity:
        this.authenticationRouteDestination(destinationRequest),
      hasAuthenticationUsername,
      hasAuthenticationPassword,
    };
    const legacyActuationIsSafe =
      !(typeof chrome === "object" && Boolean(chrome.runtime?.id)) &&
      this.canRequestImplicitAuthenticationSubmit(capabilityRequest);
    const alternativeIsSafe = alternativeActuationIsSafe();
    if (!legacyActuationIsSafe && !alternativeIsSafe) {
      return FormSubmissionResult.NotObserved;
    }
    const requestedApproval = approval;
    const alternativeApproval: FormSubmissionApproval = {
      isApproved: () =>
        alternativeActuationIsSafe() &&
        (!requestedApproval || requestedApproval.isApproved()),
      reject: () => {
        if (requestedApproval) requestedApproval.reject();
      },
    };
    const submission: FormSubmissionObservation = {
      form,
      action: () => form.requestSubmit(),
      approval: legacyActuationIsSafe ? approval : alternativeApproval,
      expectedSubmitter: false,
    };
    return this.observeSubmit(submission);
  }

  authenticationRouteDestination({
    form,
    control,
  }: AuthenticationRouteDestinationRequest): string {
    const buttonElement = control?.ownerDocument.defaultView?.HTMLButtonElement;
    const inputElement = control?.ownerDocument.defaultView?.HTMLInputElement;
    if (
      control &&
      ((buttonElement && control instanceof buttonElement) ||
        (inputElement && control instanceof inputElement)) &&
      this.controlHasNativeSubmitSemantics(control) &&
      control.hasAttribute("formaction")
    ) {
      return control.formAction;
    }
    return this.ownedFormDestinationIdentity(form);
  }

  private authenticationControlDestination(
    control: LoginAdvanceControl,
  ): string {
    const controlForm = this.associatedAuthenticationForm(control);
    if (controlForm.kind !== PasswordFormScopeKind.Owned) {
      return ((v) => (v ? v : ""))(
        control.ownerDocument.defaultView?.location.href,
      );
    }
    const request: AuthenticationRouteDestinationRequest = {
      form: controlForm.owner,
      control,
    };
    return this.authenticationRouteDestination(request);
  }

  private canActivateAuthenticationRouteControl(
    request: AuthenticationRouteControlRequest,
  ): boolean {
    const { control, controlLabel, query } = request;
    const controlForm = this.associatedAuthenticationForm(control);
    const form =
      controlForm.kind === PasswordFormScopeKind.Owned
        ? controlForm.owner
        : false;
    const sourceOrigin = control.ownerDocument.defaultView?.location.origin;
    if (!sourceOrigin) return false;

    const elementConstructor =
      query.root.nodeType === 1
        ? (query.root as Element).ownerDocument.defaultView?.Element
        : false;
    const identityContainer: Element | false = form
      ? form
      : query.kind === PasswordFormQueryKind.Scoped &&
          query.formScope.kind === PasswordFormScopeKind.Unowned &&
          elementConstructor &&
          query.root instanceof elementConstructor
        ? query.root
        : false;
    const formIdentity = [
      identityContainer ? identityContainer.id : "",
      identityContainer
        ? ((v) => (v ? v : ""))(identityContainer.getAttribute("name"))
        : "",
      identityContainer
        ? ((v) => (v ? v : ""))(identityContainer.getAttribute("class"))
        : "",
      identityContainer
        ? ((v) => (v ? v : ""))(identityContainer.getAttribute("aria-label"))
        : "",
    ].join(" ");
    const destinationIdentity = this.authenticationControlDestination(control);
    const machineIdentity = this.controlMachineIdentity(control);
    if (
      !destinationIdentity ||
      !authenticationFactBounds.controlTextsFit([
        sourceOrigin,
        formIdentity,
        controlLabel,
        machineIdentity,
      ])
    ) {
      return false;
    }

    const sharesOwnedForm = Boolean(form && form === query.usernameField.form);
    const unownedScopeRequest: UnownedLocalScopeRequest = {
      root: query.root,
      field: query.usernameField,
      control,
    };
    const hasLocalUnownedScope =
      !form &&
      !query.usernameField.form &&
      query.kind === PasswordFormQueryKind.Scoped &&
      query.formScope.kind === PasswordFormScopeKind.Unowned &&
      this.unownedQueryHasLocalScope(unownedScopeRequest);

    const passwordFields = passwordFieldDiscovery.findPasswordFields(query);
    const newPasswordFieldCount = passwordFields.filter((field) => {
      const newPasswordTokenRequest: AutocompleteTokenMatchRequest = {
        field,
        expected: "new-password",
      };
      return passwordFieldDiscovery.hasAutocompleteToken(
        newPasswordTokenRequest,
      );
    }).length;
    const controls = Array.from(
      query.root.querySelectorAll<HTMLElement>(
        authenticationAdvanceControlSelector,
      ),
    );
    const observation: AuthenticationAdvanceControlObservation = {
      actionability: "actionable",
      ownership: sharesOwnedForm
        ? "owned-form"
        : hasLocalUnownedScope
          ? "locally-scoped"
          : "unowned",
      semantics: control.matches(semanticSubmitControlSelector)
        ? "semantic-submit"
        : "activation",
      authenticationUsername: passwordFieldDiscovery.usernameEvidence(query),
      passwordFieldCount: passwordFields.length,
      newPasswordFieldCount,
      oneTimeCodeFieldCount:
        passwordFieldDiscovery.findOneTimeCodeFields(query).length,
      semanticSubmitControlCount: this.countedSemanticSubmitControls(controls),
      sourceOrigin,
      formIdentity: formIdentity.trim(),
      destinationIdentity,
      label: controlLabel,
      machineIdentity,
      submissionMethod: this.controlSubmissionMethod(control),
      submissionDestinationSource:
        AuthenticationSubmissionDestination.source(control),
    };
    return query.advanceControlIsSafe
      ? query.advanceControlIsSafe(observation)
      : authentication_advance_control_is_safe(observation);
  }

  clickAdvanceControl(request: LoginAdvanceControlRequest): boolean {
    const ownedScope: PasswordFormScope =
      request.kind === PasswordFormQueryKind.Scoped &&
      request.formScope.kind === PasswordFormScopeKind.Owned
        ? { kind: PasswordFormScopeKind.Owned, owner: request.formScope.owner }
        : { kind: PasswordFormScopeKind.Unowned };
    const queryRoot =
      ownedScope.kind === PasswordFormScopeKind.Owned
        ? ownedScope.owner.ownerDocument
        : request.root;
    const controls = Array.from(
      queryRoot.querySelectorAll<LoginAdvanceControl>(
        authenticationAdvanceControlSelector,
      ),
    );
    for (const control of controls) {
      const controlScope = this.associatedAuthenticationForm(control);
      if (ownedScope.kind === PasswordFormScopeKind.Owned) {
        if (
          controlScope.kind !== PasswordFormScopeKind.Owned ||
          controlScope.owner !== ownedScope.owner
        ) {
          continue;
        }
      }
      if (this.controlIsInert(control)) {
        continue;
      }
      const activationRequest: AuthenticationRouteControlRequest = {
        control,
        controlLabel: this.controlLabel(control),
        query: request,
      };
      if (!this.canActivateAuthenticationRouteControl(activationRequest)) {
        continue;
      }
      control.click();
      return true;
    }
    return false;
  }

  formHasRustClassifiableAdvanceControl(form: HTMLFormElement): boolean {
    const formScope: PasswordFormScope = {
      kind: PasswordFormScopeKind.Owned,
      owner: form,
    };
    const fieldQuery: PasswordFieldQuery = {
      root: form.ownerDocument,
      formScope,
    };
    const passwordFields =
      passwordFieldDiscovery.findPasswordFields(fieldQuery);
    const newPasswordFieldCount = passwordFields.filter((field) => {
      const newPasswordTokenRequest: AutocompleteTokenMatchRequest = {
        field,
        expected: "new-password",
      };
      return passwordFieldDiscovery.hasAutocompleteToken(
        newPasswordTokenRequest,
      );
    }).length;
    const oneTimeCodeFieldCount =
      passwordFieldDiscovery.findOneTimeCodeFields(fieldQuery).length;
    const controls = Array.from(
      form.ownerDocument.querySelectorAll<HTMLElement>(
        authenticationAdvanceControlSelector,
      ),
    ).filter((control) => {
      if (this.controlIsInert(control)) return false;
      const owner = this.associatedAuthenticationForm(control);
      return owner.kind === PasswordFormScopeKind.Owned && owner.owner === form;
    });
    const semanticSubmitControlCount =
      this.countedSemanticSubmitControls(controls);
    return controls.some((control) => {
      const destinationRequest: ControlDestinationIdentityRequest = {
        control,
        formScope,
      };
      const observation: AuthenticationAdvanceControlObservation = {
        actionability: "actionable",
        ownership: "owned-form",
        semantics: control.matches(semanticSubmitControlSelector)
          ? "semantic-submit"
          : "activation",
        authenticationUsername:
          passwordFieldDiscovery.usernameEvidence(fieldQuery),
        passwordFieldCount: passwordFields.length,
        newPasswordFieldCount,
        oneTimeCodeFieldCount,
        semanticSubmitControlCount,
        sourceOrigin: ((v) => (v ? v : ""))(
          form.ownerDocument.defaultView?.location.origin,
        ),
        formIdentity: this.ownedFormIdentity(form),
        destinationIdentity:
          this.controlDestinationIdentity(destinationRequest),
        label: this.controlLabel(control),
        machineIdentity: this.controlMachineIdentity(control),
        submissionMethod: this.controlSubmissionMethod(control),
        submissionDestinationSource:
          AuthenticationSubmissionDestination.source(control),
      };
      const transportable = authenticationFactBounds.controlTextsFit([
        observation.sourceOrigin,
        observation.formIdentity,
        observation.label,
        ((v) => (v ? v : ""))(observation.machineIdentity),
      ]);
      if (!transportable) return false;
      // The shortlist grants no action authority. In extension content worlds,
      // retain the candidate for the subsequent offscreen Rust policy batch.
      if (typeof chrome === "object" && Boolean(chrome.runtime?.id))
        return true;
      return authentication_advance_control_is_safe(observation);
    });
  }

  private unownedQueryHasLocalScope({
    root,
    field,
    control,
  }: UnownedLocalScopeRequest): boolean {
    const rootDocument =
      root.nodeType === 9
        ? (root as Document)
        : root.nodeType === 1
          ? (root as Element).ownerDocument
          : false;
    const rootView = rootDocument ? rootDocument.defaultView : false;
    const elementConstructor = rootView ? rootView.Element : false;
    const documentConstructor = rootView ? rootView.Document : false;
    if (elementConstructor && root instanceof elementConstructor) {
      return root.contains(control) && root.contains(field);
    }
    if (documentConstructor && !(root instanceof documentConstructor))
      return false;
    const containerRequest: UnownedAuthContainerRequest = {
      field,
      root: field.ownerDocument,
    };
    const container =
      passwordFieldDiscovery.nearestUnownedAuthContainer(containerRequest);
    const containerDocument =
      container.nodeType === 9
        ? (container as Document)
        : container.ownerDocument;
    const containerElement = containerDocument?.defaultView?.Element;
    return Boolean(
      containerElement &&
      container instanceof containerElement &&
      container.contains(control)
    );
  }

  observeSubmit({
    form,
    action,
    approval,
    expectedSubmitter,
  }: FormSubmissionObservation): FormSubmissionResult {
    const directRouteMatches = () => {
      if (!expectedSubmitter) return true;
      const formScope: PasswordFormScope = {
        kind: PasswordFormScopeKind.Owned,
        owner: form,
      };
      const destinationRequest: ControlDestinationIdentityRequest = {
        control: expectedSubmitter,
        formScope,
      };
      const expectedDestination =
        this.controlDestinationIdentity(destinationRequest);
      return (
        this.formSubmissionMethod(form) ===
          this.controlSubmissionMethod(expectedSubmitter) &&
        this.ownedFormDestinationIdentity(form) === expectedDestination
      );
    };
    const observation: AuthenticationSubmissionObservation = {
      form,
      action,
      approval,
      expectedSubmitter,
      directRouteApproved: directRouteMatches,
      // A framework-owned GET form may consume a synthetic submit, but Nook
      // must never replay a native GET that would serialize a password.
      allowNativeReplay: !(
        this.formSubmissionMethod(form) === PageControlSubmissionMethod.Get &&
        Array.from(form.elements).some((element) => {
          const inputElement =
            element.ownerDocument.defaultView?.HTMLInputElement;
          return (
            inputElement &&
            element instanceof inputElement &&
            element.type === "password"
          );
        })
      ),
    };
    return authenticationSubmissionBridge.observeAuthenticationSubmission(
      observation,
    );
  }
}

export const authenticationSubmissionControls =
  new AuthenticationSubmissionControls(globalThis);
