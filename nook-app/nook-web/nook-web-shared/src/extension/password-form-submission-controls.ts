import { AuthenticationControlSurface } from "./authentication-control-surface";
import {
  authentication_advance_control_is_safe,
  can_activate_authentication_route_control,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import type {
  AuthenticationAdvanceControlObservation,
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
  type PasswordFieldQuery,
  type PasswordFormScope,
  type UnownedAuthContainerRequest,
  passwordFieldDiscovery,
} from "./password-form-fields";

export enum PasswordFormQueryKind {
  Root = "root",
  Scoped = "scoped",
}

export enum PageControlSubmissionMethod {
  Absent = "absent",
  Post = "post",
  Get = "get",
  Dialog = "dialog",
}

export type PasswordFormScopeQuery =
  | { kind: PasswordFormQueryKind.Root; root: ParentNode }
  | {
      kind: PasswordFormQueryKind.Scoped;
      root: ParentNode;
      formScope: PasswordFormScope;
    };

export type LoginAdvanceControl = HTMLButtonElement | HTMLInputElement;

export type LoginAdvanceControlRequest = PasswordFormScopeQuery & {
  usernameField: HTMLInputElement;
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

type AuthenticationFactTexts = string[];

export const MAX_AUTHENTICATION_CONTROL_TEXT_BYTES = 512;

export const MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT = 100;

export const MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS = 20;

type SemanticSubmitControlList = HTMLElement[];

export const authenticationAdvanceControlSelector =
  'button[type="submit"], input[type="submit"], input[type="image"], button:not([type]), button[type="button"], input[type="button"]';

export const semanticSubmitControlSelector =
  'button[type="submit"], input[type="submit"], input[type="image"], button:not([type])';

export class AuthenticationSubmissionDestination {
  static source(control: HTMLElement): PageControlSubmissionDestinationSource {
    if (
      !authenticationSubmissionControls.controlHasNativeSubmitSemantics(control)
    )
      return "omitted";
    if (control.hasAttribute("formaction")) return "authored";
    const owner =
      authenticationSubmissionControls.associatedAuthenticationForm(control);
    return owner.kind === PasswordFormScopeKind.Owned &&
      owner.owner.hasAttribute("action")
      ? "authored"
      : "omitted";
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

  private utf8ByteLength(value: string): number {
    return new TextEncoder().encode(value).length;
  }

  authenticationPolicyTextFits(value: string): boolean {
    return this.utf8ByteLength(value) <= MAX_AUTHENTICATION_CONTROL_TEXT_BYTES;
  }

  authenticationFactStringsAreTransportable(
    values: AuthenticationFactTexts,
  ): boolean {
    return values.every(this.authenticationPolicyTextFits.bind(this));
  }

  boundedAuthenticationDestination(identity: string): string {
    return this.authenticationPolicyTextFits(identity) ? identity : "";
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
    if (!(owner instanceof Element)) return "";
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
      : this.boundedAuthenticationDestination(this.browser.location.href);
  }

  private rawFormDestinationIdentity(form: HTMLFormElement): string {
    return form.hasAttribute("action")
      ? form.action
      : ((v) => (v ? v : ""))(form.ownerDocument.defaultView?.location.href);
  }

  ownedFormDestinationIdentity(form: HTMLFormElement): string {
    return this.boundedAuthenticationDestination(
      this.rawFormDestinationIdentity(form),
    );
  }

  controlDestinationIdentity({
    control,
    formScope,
  }: ControlDestinationIdentityRequest): string {
    if (control instanceof HTMLAnchorElement) {
      return control.href;
    }
    if (
      (control instanceof HTMLButtonElement ||
        control instanceof HTMLInputElement) &&
      this.controlHasNativeSubmitSemantics(control) &&
      control.hasAttribute("formaction")
    ) {
      return control.formAction;
    }
    if (
      (control instanceof HTMLButtonElement ||
        control instanceof HTMLInputElement) &&
      control.form
    ) {
      return this.rawFormDestinationIdentity(control.form);
    }
    return formScope.kind === PasswordFormScopeKind.Owned
      ? this.rawFormDestinationIdentity(formScope.owner)
      : this.browser.location.href;
  }

  associatedAuthenticationForm(control: HTMLElement): PasswordFormScope {
    if (
      (control instanceof HTMLButtonElement ||
        control instanceof HTMLInputElement) &&
      control.form
    ) {
      return { kind: PasswordFormScopeKind.Owned, owner: control.form };
    }
    const owner = control.closest("form");
    return owner instanceof HTMLFormElement
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

  private controlHasNativeSubmitSemantics(control: HTMLElement): boolean {
    if (control instanceof HTMLButtonElement) {
      return control.type !== "button" && control.type !== "reset";
    }
    return (
      control instanceof HTMLInputElement &&
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
    const namedValue =
      (control instanceof HTMLButtonElement ||
        control instanceof HTMLInputElement) &&
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
      ((v) => (v ? v : ""))(control.textContent),
      ((v) => (v ? v : ""))(control.getAttribute("aria-label")),
      ((v) => (v ? v : ""))(control.getAttribute("title")),
      ((v) => (v ? v : ""))(control.getAttribute("alt")),
      control instanceof HTMLInputElement
        ? control.value || control.getAttribute("alt") || "submit"
        : "",
      labelledBy,
    ]
      .join(" ")
      .trim();
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
      (this.controlHasDisabledProperty(control) && control.disabled) ||
      this.isDisabledByAncestorFieldset(control)
    ) {
      return true;
    }
    let element: HTMLElement = control;
    for (;;) {
      if (element.hasAttribute("inert") || element.inert) return true;
      const parent = element.parentElement;
      if (!(parent instanceof HTMLElement)) return false;
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
  }: SelectedSubmitterDisclosureRequest): boolean {
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
    const transportableFacts: AuthenticationFactTexts = [
      sourceOrigin,
      this.rawOwnedFormIdentity(form),
      destinationIdentity,
    ];
    return (
      this.authenticationFactStringsAreTransportable(transportableFacts) &&
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
      this.canRequestImplicitAuthenticationSubmit(capabilityRequest);
    if (!legacyActuationIsSafe && !alternativeActuationIsSafe()) {
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
      this.controlHasNativeSubmitSemantics(control) &&
      control.hasAttribute("formaction")
    ) {
      return this.boundedAuthenticationDestination(control.formAction);
    }
    return this.ownedFormDestinationIdentity(form);
  }

  private authenticationControlDestination(
    control: LoginAdvanceControl,
  ): string {
    if (!control.form) {
      return this.boundedAuthenticationDestination(
        ((v) => (v ? v : ""))(control.ownerDocument.defaultView?.location.href),
      );
    }
    const request: AuthenticationRouteDestinationRequest = {
      form: control.form,
      control,
    };
    return this.authenticationRouteDestination(request);
  }

  private canActivateAuthenticationRouteControl(
    request: AuthenticationRouteControlRequest,
  ): boolean {
    const { control, controlLabel, query } = request;
    const form = control.form;
    const sourceOrigin = control.ownerDocument.defaultView?.location.origin;
    if (!sourceOrigin) return false;

    const identityContainer =
      !form &&
      query.kind === PasswordFormQueryKind.Scoped &&
      query.formScope.kind === PasswordFormScopeKind.Unowned &&
      query.root instanceof Element
        ? query.root
        : form;
    const formIdentity = [
      ((v) => (v ? v : ""))(identityContainer?.id),
      ((v) => (v ? v : ""))(identityContainer?.getAttribute("name")),
      ((v) => (v ? v : ""))(identityContainer?.getAttribute("class")),
      ((v) => (v ? v : ""))(identityContainer?.getAttribute("aria-label")),
    ].join(" ");
    const destinationIdentity = this.authenticationControlDestination(control);
    const machineIdentity = this.controlMachineIdentity(control);
    if (
      !destinationIdentity ||
      !this.authenticationFactStringsAreTransportable([
        sourceOrigin,
        formIdentity,
        destinationIdentity,
        this.controlLabel.bind(this),
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
    if (hasLocalUnownedScope && passwordFields.length > 0) {
      const newPasswordFieldCount = passwordFields.filter((field) => {
        return passwordFieldDiscovery.hasAutocompleteToken({
          field,
          expected: "new-password",
        });
      }).length;
      const controls = Array.from(
        query.root.querySelectorAll<HTMLElement>(
          authenticationAdvanceControlSelector,
        ),
      );
      const observation: AuthenticationAdvanceControlObservation = {
        actionability: "actionable",
        ownership: "locally-scoped",
        semantics: control.matches(semanticSubmitControlSelector)
          ? "semantic-submit"
          : "activation",
        authenticationUsername: passwordFieldDiscovery.usernameEvidence(query),
        passwordFieldCount: passwordFields.length,
        newPasswordFieldCount,
        oneTimeCodeFieldCount:
          passwordFieldDiscovery.findOneTimeCodeFields(query).length,
        semanticSubmitControlCount:
          this.countedSemanticSubmitControls(controls),
        sourceOrigin,
        formIdentity: formIdentity.trim(),
        destinationIdentity,
        label: this.controlLabel.bind(this),
        machineIdentity,
        submissionMethod: this.controlSubmissionMethod(control),
        submissionDestinationSource:
          AuthenticationSubmissionDestination.source(control),
      };
      return authentication_advance_control_is_safe(observation);
    }

    return can_activate_authentication_route_control(
      sourceOrigin,
      formIdentity,
      destinationIdentity,
      this.controlLabel.bind(this),
      machineIdentity,
      true,
      passwordFieldDiscovery.isAuthUsernameField(query.usernameField),
      sharesOwnedForm || hasLocalUnownedScope,
      false,
    );
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
      if (
        ownedScope.kind === PasswordFormScopeKind.Owned &&
        control.form !== ownedScope.owner
      ) {
        continue;
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
        !(control instanceof HTMLButtonElement) &&
        !(control instanceof HTMLInputElement)
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
      return passwordFieldDiscovery.hasAutocompleteToken({
        field,
        expected: "new-password",
      });
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
      return (
        this.authenticationFactStringsAreTransportable([
          observation.sourceOrigin,
          observation.formIdentity,
          observation.destinationIdentity,
          observation.label,
          ((v) => (v ? v : ""))(observation.machineIdentity),
        ]) && authentication_advance_control_is_safe(observation)
      );
    });
  }

  private unownedQueryHasLocalScope({
    root,
    field,
    control,
  }: UnownedLocalScopeRequest): boolean {
    if (root instanceof Element) {
      return root.contains(control) && root.contains(field);
    }
    if (!(root instanceof Document)) return false;
    const containerRequest: UnownedAuthContainerRequest = {
      field,
      root: field.ownerDocument,
    };
    const container =
      passwordFieldDiscovery.nearestUnownedAuthContainer(containerRequest);
    return container instanceof Element && container.contains(control);
  }

  formHasSemanticSubmitter(form: HTMLFormElement): boolean {
    return Array.from(
      form.ownerDocument.querySelectorAll<HTMLElement>(
        semanticSubmitControlSelector,
      ),
    ).some((control) => {
      if (
        !(control instanceof HTMLButtonElement) &&
        !(control instanceof HTMLInputElement)
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
        this.ownedFormDestinationIdentity(form) ===
          this.boundedAuthenticationDestination(expectedDestination)
      );
    };
    const observation: AuthenticationSubmissionObservation = {
      form,
      action,
      approval,
      expectedSubmitter,
      directRouteApproved: directRouteMatches,
    };
    return authenticationSubmissionBridge.observeAuthenticationSubmission(
      observation,
    );
  }
}

export const authenticationSubmissionControls =
  new AuthenticationSubmissionControls(globalThis);
