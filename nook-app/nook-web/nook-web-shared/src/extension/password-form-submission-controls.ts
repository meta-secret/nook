import {
  authentication_advance_control_is_safe,
  can_activate_authentication_route_control,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import type { AuthenticationAdvanceControlObservation } from "./nook-companion-wasm/nook_companion_wasm.js";
import {
  FormSubmissionResult,
  observeAuthenticationSubmission,
  type AuthenticationSubmissionObservation,
  type FormSubmissionApproval,
} from "./authentication-direct-submit-bridge";
export { FormSubmissionResult, type FormSubmissionApproval };
import {
  findOneTimeCodeFields,
  findPasswordFields,
  hasAutocompleteToken,
  isAuthUsernameField,
  nearestUnownedAuthContainer,
  PasswordFormScopeKind,
  usernameEvidence,
  type PasswordFieldQuery,
  type PasswordFormScope,
  type UnownedAuthContainerRequest,
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

function neverNextPreferred(): boolean {
  return false;
}

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
};

type AuthenticationFactTexts = string[];

export const MAX_AUTHENTICATION_CONTROL_TEXT_BYTES = 512;
export const MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT = 100;
export const MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS = 20;

type SemanticSubmitControlList = HTMLElement[];

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function authenticationPolicyTextFits(value: string): boolean {
  return utf8ByteLength(value) <= MAX_AUTHENTICATION_CONTROL_TEXT_BYTES;
}

export function authenticationFactStringsAreTransportable(
  values: AuthenticationFactTexts,
): boolean {
  return values.every(authenticationPolicyTextFits);
}

export function boundedAuthenticationDestination(identity: string): string {
  return authenticationPolicyTextFits(identity) ? identity : "";
}

export function rawOwnedFormIdentity(form: HTMLFormElement): string {
  return [
    form.id,
    form.getAttribute("name") ?? "",
    form.getAttribute("class") ?? "",
    form.getAttribute("aria-label") ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function ownedFormIdentity(form: HTMLFormElement): string {
  return rawOwnedFormIdentity(form);
}

export function observedFormIdentity({
  root,
  formScope,
}: ObservedFormIdentityRequest): string {
  const owner =
    formScope.kind === PasswordFormScopeKind.Owned ? formScope.owner : root;
  if (!(owner instanceof Element)) return "";
  return [
    owner.id,
    owner.className,
    owner.getAttribute("name") ?? "",
    owner.getAttribute("role") ?? "",
    owner.getAttribute("aria-label") ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function observedFormDestination(formScope: PasswordFormScope): string {
  return formScope.kind === PasswordFormScopeKind.Owned
    ? ownedFormDestinationIdentity(formScope.owner)
    : boundedAuthenticationDestination(location.href);
}

function rawFormDestinationIdentity(form: HTMLFormElement): string {
  return form.hasAttribute("action")
    ? form.action
    : (form.ownerDocument.defaultView?.location.href ?? "");
}

export function ownedFormDestinationIdentity(form: HTMLFormElement): string {
  return boundedAuthenticationDestination(rawFormDestinationIdentity(form));
}

export function controlDestinationIdentity({
  control,
  formScope,
}: ControlDestinationIdentityRequest): string {
  if (control instanceof HTMLAnchorElement) {
    return control.href;
  }
  if (
    (control instanceof HTMLButtonElement ||
      control instanceof HTMLInputElement) &&
    controlHasNativeSubmitSemantics(control) &&
    control.hasAttribute("formaction")
  ) {
    return control.formAction;
  }
  if (
    (control instanceof HTMLButtonElement ||
      control instanceof HTMLInputElement) &&
    control.form
  ) {
    return rawFormDestinationIdentity(control.form);
  }
  return formScope.kind === PasswordFormScopeKind.Owned
    ? rawFormDestinationIdentity(formScope.owner)
    : location.href;
}

export const authenticationAdvanceControlSelector =
  'button[type="submit"], input[type="submit"], input[type="image"], button:not([type]), button[type="button"], input[type="button"]';

export const semanticSubmitControlSelector =
  'button[type="submit"], input[type="submit"], input[type="image"], button:not([type])';

export function associatedAuthenticationForm(
  control: HTMLElement,
): PasswordFormScope {
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

function isDisabledByAncestorFieldset(control: HTMLElement): boolean {
  let ancestor = control.parentElement;
  while (ancestor) {
    if (
      ancestor instanceof HTMLFieldSetElement &&
      ancestor.hasAttribute("disabled")
    ) {
      const firstLegend = [...ancestor.children].find(
        (child) => child instanceof HTMLLegendElement,
      );
      if (!(
        firstLegend instanceof HTMLLegendElement &&
        firstLegend.contains(control)
      )) {
        return true;
      }
    }
    ancestor = ancestor.parentElement;
  }
  return false;
}

function controlHasDisabledProperty(
  control: HTMLElement,
): control is
  | HTMLButtonElement
  | HTMLInputElement
  | HTMLSelectElement
  | HTMLTextAreaElement
  | HTMLFieldSetElement
  | HTMLOptionElement {
  return (
    control instanceof HTMLButtonElement ||
    control instanceof HTMLInputElement ||
    control instanceof HTMLSelectElement ||
    control instanceof HTMLTextAreaElement ||
    control instanceof HTMLFieldSetElement ||
    control instanceof HTMLOptionElement
  );
}

export function controlIsEffectivelyDisabled(control: HTMLElement): boolean {
  return (
    (controlHasDisabledProperty(control) && control.disabled) ||
    isDisabledByAncestorFieldset(control) ||
    control.getAttribute("aria-disabled") === "true" ||
    isDisabledByAncestorAria(control)
  );
}

function isDisabledByAncestorAria(control: HTMLElement): boolean {
  let ancestor = control.parentElement;
  while (ancestor) {
    if (ancestor.getAttribute("aria-disabled") === "true") return true;
    ancestor = ancestor.parentElement;
  }
  return false;
}

export function controlIsInert(control: HTMLElement): boolean {
  return (
    controlIsEffectivelyDisabled(control) ||
    !isRenderedControl(control) ||
    control.hasAttribute("inert") ||
    control.inert
  );
}

export function countedSemanticSubmitControls(
  controls: SemanticSubmitControlList,
): number {
  return Math.min(
    controls.filter(
      (control) =>
        control.matches(semanticSubmitControlSelector) &&
        !controlIsInert(control),
    ).length,
    MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT,
  );
}

export function boundAuthenticationControlObservations<
  AuthenticationControlObservation,
>({
  candidates,
  isPreferred,
  isNextPreferred = neverNextPreferred,
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

export function isRenderedControl(control: HTMLElement): boolean {
  if (control.closest("dialog:not([open])")) return false;
  let element: HTMLElement = control;
  for (;;) {
    const style = getComputedStyle(element);
    const rendered = style.display !== "none" && style.visibility !== "hidden";
    if (
      element.hidden ||
      element.hasAttribute("inert") ||
      element.inert ||
      element.getAttribute("aria-disabled") === "true" ||
      (element instanceof HTMLDialogElement && !element.open) ||
      !rendered
    ) {
      return false;
    }
    const parent = element.parentElement;
    if (!(parent instanceof HTMLElement)) return true;
    element = parent;
  }
}

function htmlEnumeratedSubmissionMethod(
  token: string,
): PageControlSubmissionMethod {
  const normalized = token.toLowerCase();
  if (normalized === "post") return PageControlSubmissionMethod.Post;
  if (normalized === "dialog") return PageControlSubmissionMethod.Dialog;
  return PageControlSubmissionMethod.Get;
}

function presentHtmlSubmissionMethod({
  element,
  name,
}: HtmlSubmissionMethodRequest): PageControlSubmissionMethod | false {
  if (!element.hasAttribute(name)) return false;
  const token = element.getAttribute(name);
  return htmlEnumeratedSubmissionMethod(token ? token : "");
}

function controlHasNativeSubmitSemantics(control: HTMLElement): boolean {
  if (control instanceof HTMLButtonElement) {
    return control.type !== "button" && control.type !== "reset";
  }
  return (
    control instanceof HTMLInputElement &&
    (control.type === "submit" || control.type === "image")
  );
}

export function controlSubmissionMethod(
  control: HTMLElement,
): PageControlSubmissionMethod {
  if (!controlHasNativeSubmitSemantics(control)) {
    return PageControlSubmissionMethod.Absent;
  }
  const formmethodRequest: HtmlSubmissionMethodRequest = {
    element: control,
    name: "formmethod",
  };
  const formmethod = presentHtmlSubmissionMethod(formmethodRequest);
  if (formmethod !== false) return formmethod;
  const owner = associatedAuthenticationForm(control);
  if (owner.kind !== PasswordFormScopeKind.Owned) {
    return PageControlSubmissionMethod.Absent;
  }
  const methodRequest: HtmlSubmissionMethodRequest = {
    element: owner.owner,
    name: "method",
  };
  const method = presentHtmlSubmissionMethod(methodRequest);
  return method === false ? PageControlSubmissionMethod.Get : method;
}

export function controlMachineIdentity(control: HTMLElement): string {
  const namedValue =
    control instanceof HTMLButtonElement || control instanceof HTMLInputElement
      ? `${control.name}=${control.value}`
      : "";
  return `${control.id} ${namedValue} ${control.getAttribute("class") ?? ""}`;
}

export function controlLabel(control: HTMLElement): string {
  const labelledBy = (control.getAttribute("aria-labelledby") ?? "")
    .split(/\s+/u)
    .filter(Boolean)
    .flatMap((id) => {
      const label = control.ownerDocument.getElementById(id);
      return label ? [label.textContent ?? ""] : [];
    })
    .join(" ");
  return [
    control.textContent ?? "",
    control.getAttribute("aria-label") ?? "",
    control.getAttribute("title") ?? "",
    control.getAttribute("alt") ?? "",
    control instanceof HTMLInputElement
      ? control.value || control.getAttribute("alt") || "submit"
      : "",
    labelledBy,
  ].join(" ");
}

export function formSubmissionMethod(
  form: HTMLFormElement,
): PageControlSubmissionMethod {
  const methodRequest: HtmlSubmissionMethodRequest = {
    element: form,
    name: "method",
  };
  const method = presentHtmlSubmissionMethod(methodRequest);
  return method === false ? PageControlSubmissionMethod.Get : method;
}

export function formUsesGetSubmission(form: HTMLFormElement): boolean {
  return formSubmissionMethod(form) === PageControlSubmissionMethod.Get;
}

export function submissionMethodBlocksCredentialDisclosure(
  method: PageControlSubmissionMethod,
): boolean {
  return (
    method === PageControlSubmissionMethod.Get ||
    method === PageControlSubmissionMethod.Dialog
  );
}

export function formBlocksCredentialDisclosure(form: HTMLFormElement): boolean {
  return submissionMethodBlocksCredentialDisclosure(formSubmissionMethod(form));
}

function controlIsNativelyDisabledOrInert(control: HTMLElement): boolean {
  if (
    (controlHasDisabledProperty(control) && control.disabled) ||
    isDisabledByAncestorFieldset(control)
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

export function formHasGetMethodSubmitter(form: HTMLFormElement): boolean {
  return Array.from(
    form.ownerDocument.querySelectorAll<HTMLElement>(
      semanticSubmitControlSelector,
    ),
  ).some((control) => {
    if (controlIsNativelyDisabledOrInert(control)) return false;
    const owner = associatedAuthenticationForm(control);
    return (
      owner.kind === PasswordFormScopeKind.Owned &&
      owner.owner === form &&
      controlSubmissionMethod(control) === PageControlSubmissionMethod.Get
    );
  });
}

export function formHasPostMethodSubmitter(form: HTMLFormElement): boolean {
  return Array.from(
    form.ownerDocument.querySelectorAll<HTMLElement>(
      semanticSubmitControlSelector,
    ),
  ).some((control) => {
    if (controlIsInert(control)) return false;
    const owner = associatedAuthenticationForm(control);
    return (
      owner.kind === PasswordFormScopeKind.Owned &&
      owner.owner === form &&
      controlSubmissionMethod(control) === PageControlSubmissionMethod.Post
    );
  });
}

export function formHasDialogSubmitter(form: HTMLFormElement): boolean {
  return Array.from(
    form.ownerDocument.querySelectorAll<HTMLElement>(
      authenticationAdvanceControlSelector,
    ),
  ).some((control) => {
    if (controlIsInert(control)) return false;
    const owner = associatedAuthenticationForm(control);
    return (
      owner.kind === PasswordFormScopeKind.Owned &&
      owner.owner === form &&
      controlSubmissionMethod(control) === PageControlSubmissionMethod.Dialog
    );
  });
}

export function selectedSubmitterBlocksCredentialDisclosure({
  form,
  selectedSubmitter,
}: SelectedSubmitterDisclosureRequest): boolean {
  if (selectedSubmitter) {
    if (controlHasNativeSubmitSemantics(selectedSubmitter)) {
      const formmethodRequest: HtmlSubmissionMethodRequest = {
        element: selectedSubmitter,
        name: "formmethod",
      };
      const formmethod = presentHtmlSubmissionMethod(formmethodRequest);
      if (formmethod !== false) {
        return (
          submissionMethodBlocksCredentialDisclosure(formmethod) ||
          formHasGetMethodSubmitter(form)
        );
      }
      return (
        formBlocksCredentialDisclosure(form) || formHasGetMethodSubmitter(form)
      );
    }
    return (
      formHasGetMethodSubmitter(form) || formBlocksCredentialDisclosure(form)
    );
  }
  if (
    formHasSemanticSubmitter(form) &&
    formUsesGetSubmission(form) &&
    !formHasPostMethodSubmitter(form)
  ) {
    return true;
  }
  if (!formHasSemanticSubmitter(form) && formBlocksCredentialDisclosure(form)) {
    return true;
  }
  return formHasGetMethodSubmitter(form) || formHasDialogSubmitter(form);
}

export function canRequestImplicitAuthenticationSubmit({
  form,
  sourceOrigin,
  destinationIdentity,
  hasAuthenticationUsername,
  hasAuthenticationPassword,
}: ImplicitAuthenticationSubmitCapabilityRequest): boolean {
  const transportableFacts: AuthenticationFactTexts = [
    sourceOrigin,
    rawOwnedFormIdentity(form),
    destinationIdentity,
  ];
  return (
    authenticationFactStringsAreTransportable(transportableFacts) &&
    can_activate_authentication_route_control(
      sourceOrigin,
      ownedFormIdentity(form),
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

export function requestImplicitAuthenticationSubmit({
  form,
  hasAuthenticationUsername,
  hasAuthenticationPassword,
  approval,
}: ImplicitAuthenticationSubmitRequest): FormSubmissionResult {
  const sourceOrigin = form.ownerDocument.defaultView?.location.origin;
  if (
    !sourceOrigin ||
    formHasSemanticSubmitter(form) ||
    formHasAriaDisabledSemanticSubmitter(form) ||
    typeof form.requestSubmit !== "function" ||
    (hasAuthenticationPassword && formBlocksCredentialDisclosure(form))
  ) {
    return FormSubmissionResult.NotObserved;
  }
  const destinationRequest: AuthenticationRouteDestinationRequest = {
    form,
  };
  const capabilityRequest: ImplicitAuthenticationSubmitCapabilityRequest = {
    form,
    sourceOrigin,
    destinationIdentity: authenticationRouteDestination(destinationRequest),
    hasAuthenticationUsername,
    hasAuthenticationPassword,
  };
  if (!canRequestImplicitAuthenticationSubmit(capabilityRequest)) {
    return FormSubmissionResult.NotObserved;
  }
  const submission: FormSubmissionObservation = {
    form,
    action: () => form.requestSubmit(),
    approval,
    expectedSubmitter: false,
  };
  return observeSubmit(submission);
}

export function authenticationRouteDestination({
  form,
  control,
}: AuthenticationRouteDestinationRequest): string {
  if (
    control &&
    controlHasNativeSubmitSemantics(control) &&
    control.hasAttribute("formaction")
  ) {
    return boundedAuthenticationDestination(control.formAction);
  }
  return ownedFormDestinationIdentity(form);
}

function authenticationControlDestination(
  control: LoginAdvanceControl,
): string {
  if (!control.form) {
    return boundedAuthenticationDestination(
      control.ownerDocument.defaultView?.location.href ?? "",
    );
  }
  const request: AuthenticationRouteDestinationRequest = {
    form: control.form,
    control,
  };
  return authenticationRouteDestination(request);
}

function canActivateAuthenticationRouteControl(
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
    identityContainer?.id ?? "",
    identityContainer?.getAttribute("name") ?? "",
    identityContainer?.getAttribute("class") ?? "",
    identityContainer?.getAttribute("aria-label") ?? "",
  ].join(" ");
  const destinationIdentity = authenticationControlDestination(control);
  const machineIdentity = controlMachineIdentity(control);
  if (
    !destinationIdentity ||
    !authenticationFactStringsAreTransportable([
      sourceOrigin,
      formIdentity,
      destinationIdentity,
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
    unownedQueryHasLocalScope(unownedScopeRequest);

  return can_activate_authentication_route_control(
    sourceOrigin,
    formIdentity,
    destinationIdentity,
    controlLabel,
    machineIdentity,
    true,
    isAuthUsernameField(query.usernameField),
    sharesOwnedForm || hasLocalUnownedScope,
    false,
  );
}

export function clickAdvanceControl(
  request: LoginAdvanceControlRequest,
): boolean {
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
    if (controlIsInert(control)) {
      continue;
    }
    const activationRequest: AuthenticationRouteControlRequest = {
      control,
      controlLabel: controlLabel(control),
      query: request,
    };
    if (!canActivateAuthenticationRouteControl(activationRequest)) {
      continue;
    }
    control.click();
    return true;
  }
  return false;
}

function formHasAriaDisabledSemanticSubmitter(form: HTMLFormElement): boolean {
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
        isDisabledByAncestorAria(control))
    );
  });
}

export function formHasRustClassifiableAdvanceControl(
  form: HTMLFormElement,
): boolean {
  const formScope: PasswordFormScope = {
    kind: PasswordFormScopeKind.Owned,
    owner: form,
  };
  const fieldQuery: PasswordFieldQuery = {
    root: form.ownerDocument,
    formScope,
  };
  const passwordFields = findPasswordFields(fieldQuery);
  const newPasswordFieldCount = passwordFields.filter((field) => {
    const tokenRequest: Parameters<typeof hasAutocompleteToken>[0] = {
      field,
      expected: "new-password",
    };
    return hasAutocompleteToken(tokenRequest);
  }).length;
  const oneTimeCodeFieldCount = findOneTimeCodeFields(fieldQuery).length;
  const controls = Array.from(
    form.ownerDocument.querySelectorAll<HTMLElement>(
      authenticationAdvanceControlSelector,
    ),
  ).filter((control) => {
    if (controlIsInert(control)) return false;
    const owner = associatedAuthenticationForm(control);
    return owner.kind === PasswordFormScopeKind.Owned && owner.owner === form;
  });
  const semanticSubmitControlCount = countedSemanticSubmitControls(controls);
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
      authenticationUsername: usernameEvidence(fieldQuery),
      passwordFieldCount: passwordFields.length,
      newPasswordFieldCount,
      oneTimeCodeFieldCount,
      semanticSubmitControlCount,
      sourceOrigin: form.ownerDocument.defaultView?.location.origin ?? "",
      formIdentity: ownedFormIdentity(form),
      destinationIdentity: controlDestinationIdentity(destinationRequest),
      label: controlLabel(control),
      machineIdentity: controlMachineIdentity(control),
      submissionMethod: controlSubmissionMethod(control),
    };
    return (
      authenticationFactStringsAreTransportable([
        observation.sourceOrigin,
        observation.formIdentity,
        observation.destinationIdentity,
        observation.label,
        observation.machineIdentity ?? "",
      ]) && authentication_advance_control_is_safe(observation)
    );
  });
}

type UnownedLocalScopeRequest = {
  root: ParentNode;
  field: HTMLInputElement;
  control: HTMLElement;
};

function unownedQueryHasLocalScope({
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
  const container = nearestUnownedAuthContainer(containerRequest);
  return container instanceof Element && container.contains(control);
}

export function formHasSemanticSubmitter(form: HTMLFormElement): boolean {
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
    return control.form === form && !controlIsInert(control);
  });
}

export function observeSubmit({
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
    const expectedDestination = controlDestinationIdentity(destinationRequest);
    return (
      formSubmissionMethod(form) ===
        controlSubmissionMethod(expectedSubmitter) &&
      ownedFormDestinationIdentity(form) ===
        boundedAuthenticationDestination(expectedDestination)
    );
  };
  const observation: AuthenticationSubmissionObservation = {
    form,
    action,
    approval,
    expectedSubmitter,
    directRouteApproved: directRouteMatches,
  };
  return observeAuthenticationSubmission(observation);
}
