import {
  AirbnbLoginModalRouteKind,
  isAirbnbLoginModalContinueControl,
  observeAirbnbLoginModalRoute,
  type AirbnbLoginModalContinueControlRequest,
  type AirbnbLoginModalRouteRequest,
} from "./airbnb-login-modal-route";
import { AuthenticationControlSurface } from "./authentication-control-surface";
import { AuthenticationInputSurface } from "./authentication-input-surface";
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

export enum PasswordFormQueryKind {
  Root = "root",
  Scoped = "scoped",
}

export const PageControlSubmissionMethod = {
  Absent: "absent",
  Post: "post",
  Get: "get",
  Dialog: "dialog",
} as const satisfies Record<string, PageControlSubmissionMethodValue>;
export type PageControlSubmissionMethod = PageControlSubmissionMethodValue;

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

type HtmlSubmissionMethodRequest = {
  element: Element;
  name: string;
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

type SelectedSubmitterDisclosureRequest = {
  form: HTMLFormElement;
  selectedSubmitter: LoginAdvanceControl | false;
  scriptedGetPasswordDisclosureApproved: boolean;
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

export const MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT = 100;

export const MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS = 20;

type SemanticSubmitControlList = HTMLElement[];

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
class AuthenticationSubmissionControls extends AuthenticationControlSurface {
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
    if (!AuthenticationInputSurface.isElementParentNode(owner)) return "";
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
    if (AuthenticationInputSurface.isAnchorElement(control)) {
      return control.href;
    }
    if (
      (AuthenticationInputSurface.isButtonElement(control) ||
        AuthenticationInputSurface.isInputElement(control)) &&
      this.controlHasNativeSubmitSemantics(control) &&
      control.hasAttribute("formaction")
    ) {
      return control.formAction;
    }
    if (
      (AuthenticationInputSurface.isButtonElement(control) ||
        AuthenticationInputSurface.isInputElement(control)) &&
      control.form
    ) {
      return this.formDestinationIdentity(control.form);
    }
    return formScope.kind === PasswordFormScopeKind.Owned
      ? this.formDestinationIdentity(formScope.owner)
      : this.browser.location.href;
  }

  associatedAuthenticationForm(control: HTMLElement): PasswordFormScope {
    if (
      (AuthenticationInputSurface.isButtonElement(control) ||
        AuthenticationInputSurface.isInputElement(control)) &&
      control.form
    ) {
      return { kind: PasswordFormScopeKind.Owned, owner: control.form };
    }
    const owner = control.closest("form");
    return owner && AuthenticationInputSurface.isFormElement(owner)
      ? { kind: PasswordFormScopeKind.Owned, owner }
      : { kind: PasswordFormScopeKind.Unowned };
  }

  countedSemanticSubmitControls(controls: SemanticSubmitControlList): number {
    return Math.min(
      controls.filter(
        (control) =>
          control.matches(semanticSubmitControlSelector) &&
          !this.controlIsInert(control),
      ).length,
      MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT,
    );
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

  private htmlEnumeratedSubmissionMethod(
    token: string,
  ): PageControlSubmissionMethod {
    const normalized = token.toLowerCase();
    if (normalized === "post") return PageControlSubmissionMethod.Post;
    if (normalized === "dialog") return PageControlSubmissionMethod.Dialog;
    return PageControlSubmissionMethod.Get;
  }

  private presentHtmlSubmissionMethod({
    element,
    name,
  }: HtmlSubmissionMethodRequest): PageControlSubmissionMethod | false {
    if (!element.hasAttribute(name)) return false;
    const token = element.getAttribute(name);
    return this.htmlEnumeratedSubmissionMethod(token ? token : "");
  }

  controlHasNativeSubmitSemantics(control: HTMLElement): boolean {
    if (AuthenticationInputSurface.isButtonElement(control)) {
      return control.type !== "button" && control.type !== "reset";
    }
    return (
      AuthenticationInputSurface.isInputElement(control) &&
      (control.type === "submit" || control.type === "image")
    );
  }

  controlSubmissionMethod(control: HTMLElement): PageControlSubmissionMethod {
    if (!this.controlHasNativeSubmitSemantics(control)) {
      return PageControlSubmissionMethod.Absent;
    }
    const formmethodRequest: HtmlSubmissionMethodRequest = {
      element: control,
      name: "formmethod",
    };
    const formmethod = this.presentHtmlSubmissionMethod(formmethodRequest);
    if (formmethod !== false) return formmethod;
    const owner = this.associatedAuthenticationForm(control);
    if (owner.kind !== PasswordFormScopeKind.Owned) {
      return PageControlSubmissionMethod.Absent;
    }
    const methodRequest: HtmlSubmissionMethodRequest = {
      element: owner.owner,
      name: "method",
    };
    const method = this.presentHtmlSubmissionMethod(methodRequest);
    return method === false ? PageControlSubmissionMethod.Get : method;
  }

  controlMachineIdentity(control: HTMLElement): string {
    if (
      (AuthenticationInputSurface.isButtonElement(control) ||
        AuthenticationInputSurface.isInputElement(control)) &&
      control.form
    ) {
      const continueControlRequest: AirbnbLoginModalContinueControlRequest = {
        form: control.form,
        control,
      };
      if (isAirbnbLoginModalContinueControl(continueControlRequest)) {
        return "";
      }
    }
    const namedValue =
      (AuthenticationInputSurface.isButtonElement(control) ||
        AuthenticationInputSurface.isInputElement(control)) &&
      (control.name || control.value)
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
          AuthenticationInputSurface.isInputElement(control)
            ? control.value || control.getAttribute("alt") || "submit"
            : "",
          labelledBy,
        ]
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ].join(" ");
  }

  formSubmissionMethod(form: HTMLFormElement): PageControlSubmissionMethod {
    const methodRequest: HtmlSubmissionMethodRequest = {
      element: form,
      name: "method",
    };
    const method = this.presentHtmlSubmissionMethod(methodRequest);
    return method === false ? PageControlSubmissionMethod.Get : method;
  }

  formUsesGetSubmission(form: HTMLFormElement): boolean {
    return this.formSubmissionMethod(form) === PageControlSubmissionMethod.Get;
  }

  submissionMethodBlocksCredentialDisclosure(
    method: PageControlSubmissionMethod,
  ): boolean {
    return (
      method === PageControlSubmissionMethod.Get ||
      method === PageControlSubmissionMethod.Dialog
    );
  }

  formBlocksCredentialDisclosure(form: HTMLFormElement): boolean {
    return this.submissionMethodBlocksCredentialDisclosure(
      this.formSubmissionMethod(form),
    );
  }

  private controlIsNativelyDisabledOrInert(control: HTMLElement): boolean {
    if (
      ((AuthenticationInputSurface.isButtonElement(control) ||
        AuthenticationInputSurface.isInputElement(control)) &&
        control.disabled) ||
      this.isDisabledByAncestorFieldset(control)
    ) {
      return true;
    }
    let element: HTMLElement = control;
    for (;;) {
      if (element.hasAttribute("inert") || element.inert) return true;
      const parent = element.parentElement;
      if (!parent) return false;
      element = parent;
    }
  }

  formHasGetMethodSubmitter(form: HTMLFormElement): boolean {
    return Array.from(
      form.ownerDocument.querySelectorAll<HTMLElement>(
        semanticSubmitControlSelector,
      ),
    ).some((control) => {
      if (this.controlIsNativelyDisabledOrInert(control)) return false;
      const owner = this.associatedAuthenticationForm(control);
      return (
        owner.kind === PasswordFormScopeKind.Owned &&
        owner.owner === form &&
        this.controlSubmissionMethod(control) ===
          PageControlSubmissionMethod.Get
      );
    });
  }

  formHasPostMethodSubmitter(form: HTMLFormElement): boolean {
    return Array.from(
      form.ownerDocument.querySelectorAll<HTMLElement>(
        semanticSubmitControlSelector,
      ),
    ).some((control) => {
      if (this.controlIsInert(control)) return false;
      const owner = this.associatedAuthenticationForm(control);
      return (
        owner.kind === PasswordFormScopeKind.Owned &&
        owner.owner === form &&
        this.controlSubmissionMethod(control) ===
          PageControlSubmissionMethod.Post
      );
    });
  }

  formHasDialogSubmitter(form: HTMLFormElement): boolean {
    return Array.from(
      form.ownerDocument.querySelectorAll<HTMLElement>(
        authenticationAdvanceControlSelector,
      ),
    ).some((control) => {
      if (this.controlIsInert(control)) return false;
      const owner = this.associatedAuthenticationForm(control);
      return (
        owner.kind === PasswordFormScopeKind.Owned &&
        owner.owner === form &&
        this.controlSubmissionMethod(control) ===
          PageControlSubmissionMethod.Dialog
      );
    });
  }

  selectedSubmitterBlocksCredentialDisclosure({
    form,
    selectedSubmitter,
    scriptedGetPasswordDisclosureApproved,
  }: SelectedSubmitterDisclosureRequest): boolean {
    if (
      scriptedGetPasswordDisclosureApproved &&
      selectedSubmitter &&
      this.controlHasNativeSubmitSemantics(selectedSubmitter) &&
      this.controlSubmissionMethod(selectedSubmitter) ===
        PageControlSubmissionMethod.Get
    ) {
      return false;
    }
    if (selectedSubmitter) {
      if (this.controlHasNativeSubmitSemantics(selectedSubmitter)) {
        const formmethodRequest: HtmlSubmissionMethodRequest = {
          element: selectedSubmitter,
          name: "formmethod",
        };
        const formmethod = this.presentHtmlSubmissionMethod(formmethodRequest);
        if (formmethod !== false) {
          return (
            this.submissionMethodBlocksCredentialDisclosure(formmethod) ||
            this.formHasGetMethodSubmitter(form)
          );
        }
        return (
          this.formBlocksCredentialDisclosure(form) ||
          this.formHasGetMethodSubmitter(form)
        );
      }
      return (
        this.formHasGetMethodSubmitter(form) ||
        this.formBlocksCredentialDisclosure(form)
      );
    }
    if (
      this.formHasSemanticSubmitter(form) &&
      this.formUsesGetSubmission(form) &&
      !this.formHasPostMethodSubmitter(form)
    ) {
      return true;
    }
    if (
      !this.formHasSemanticSubmitter(form) &&
      this.formBlocksCredentialDisclosure(form)
    ) {
      return true;
    }
    return (
      this.formHasGetMethodSubmitter(form) || this.formHasDialogSubmitter(form)
    );
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
    if (
      control &&
      (AuthenticationInputSurface.isButtonElement(control) ||
        AuthenticationInputSurface.isInputElement(control)) &&
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

    const identityContainer: Element | false = form
      ? form
      : query.kind === PasswordFormQueryKind.Scoped &&
          query.formScope.kind === PasswordFormScopeKind.Unowned &&
          AuthenticationInputSurface.isElementParentNode(query.root)
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

  private formHasAriaDisabledSemanticSubmitter(form: HTMLFormElement): boolean {
    return Array.from(
      form.ownerDocument.querySelectorAll<HTMLElement>(
        semanticSubmitControlSelector,
      ),
    ).some((control) => {
      if (
        !AuthenticationInputSurface.isButtonElement(control) &&
        !AuthenticationInputSurface.isInputElement(control)
      ) {
        return false;
      }
      return (
        control.form === form &&
        (control.getAttribute("aria-disabled") === "true" ||
          this.isDisabledByAncestorAria(control))
      );
    });
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
    if (AuthenticationInputSurface.isElementParentNode(root)) {
      return root.contains(control) && root.contains(field);
    }
    if (!AuthenticationInputSurface.isDocumentParentNode(root)) return false;
    const containerRequest: UnownedAuthContainerRequest = {
      field,
      root: field.ownerDocument,
    };
    const container =
      passwordFieldDiscovery.nearestUnownedAuthContainer(containerRequest);
    return (
      AuthenticationInputSurface.isElementParentNode(container) &&
      container.contains(control)
    );
  }

  formHasSemanticSubmitter(form: HTMLFormElement): boolean {
    return Array.from(
      form.ownerDocument.querySelectorAll<HTMLElement>(
        semanticSubmitControlSelector,
      ),
    ).some((control) => {
      if (
        !AuthenticationInputSurface.isButtonElement(control) &&
        !AuthenticationInputSurface.isInputElement(control)
      ) {
        return false;
      }
      return control.form === form && !this.controlIsInert(control);
    });
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
        Array.from(form.elements).some(
          (element) =>
            AuthenticationInputSurface.isInputElement(element) &&
            element.type === "password",
        )
      ),
    };
    return authenticationSubmissionBridge.observeAuthenticationSubmission(
      observation,
    );
  }
}

export const authenticationSubmissionControls =
  new AuthenticationSubmissionControls(globalThis);
