import { can_activate_authentication_route_control } from "./nook-companion-wasm/nook_companion_wasm.js";
import {
  isAuthUsernameField,
  PasswordFormScopeKind,
  type PasswordFormScope,
} from "./password-form-fields";

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
};

export const MAX_AUTHENTICATION_CONTROL_TEXT_BYTES = 512;
export const MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT = 100;
export const MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS = 20;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function authenticationPolicyTextFits(value: string): boolean {
  return utf8ByteLength(value) <= MAX_AUTHENTICATION_CONTROL_TEXT_BYTES;
}

export function authenticationFactStringsAreTransportable(
  values: string[],
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
  ].join(" ");
}

export function ownedFormIdentity(form: HTMLFormElement): string {
  return rawOwnedFormIdentity(form);
}

export function observedFormIdentity(
  root: ParentNode,
  formScope: PasswordFormScope,
): string {
  const owner =
    formScope.kind === PasswordFormScopeKind.Owned ? formScope.owner : root;
  if (!(owner instanceof Element)) return "";
  return [
    owner.id,
    owner.className,
    owner.getAttribute("name") ?? "",
    owner.getAttribute("role") ?? "",
    owner.getAttribute("aria-label") ?? "",
  ].join(" ");
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

export function controlDestinationIdentity(
  control: HTMLElement,
  formScope: PasswordFormScope,
): string {
  if (control instanceof HTMLAnchorElement) {
    return control.href;
  }
  if (
    (control instanceof HTMLButtonElement ||
      control instanceof HTMLInputElement) &&
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
  'button[type="submit"], input[type="submit"], input[type="image"], button:not([type]), button[type="button"]';

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

export function controlIsEffectivelyDisabled(control: HTMLElement): boolean {
  return (
    control.matches(":disabled") ||
    isDisabledByAncestorFieldset(control) ||
    control.getAttribute("aria-disabled") === "true"
  );
}

export function controlIsInert(control: HTMLElement): boolean {
  return (
    controlIsEffectivelyDisabled(control) ||
    !isRenderedControl(control) ||
    control.hasAttribute("inert") ||
    control.inert
  );
}

export function boundAuthenticationControlObservations<Candidate>(
  candidates: Candidate[],
  isPreferred: (candidate: Candidate) => boolean,
): Candidate[] {
  const preferred = candidates.filter(isPreferred);
  const remaining = candidates.filter((candidate) => !isPreferred(candidate));
  return [...preferred, ...remaining].slice(
    0,
    MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT,
  );
}

export function isRenderedControl(control: HTMLElement): boolean {
  let element: HTMLElement = control;
  for (;;) {
    const style = getComputedStyle(element);
    const rendered = style.display !== "none" && style.visibility !== "hidden";
    if (
      element.hidden ||
      element.hasAttribute("inert") ||
      element.inert ||
      !rendered
    ) {
      return false;
    }
    const parent = element.parentElement;
    if (!(parent instanceof HTMLElement)) return true;
    element = parent;
  }
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

export function canRequestImplicitAuthenticationSubmit(
  form: HTMLFormElement,
  sourceOrigin: string,
  destinationIdentity: string,
  hasAuthenticationUsername: boolean,
  hasAuthenticationPassword: boolean,
): boolean {
  return (
    authenticationFactStringsAreTransportable([
      sourceOrigin,
      rawOwnedFormIdentity(form),
      destinationIdentity,
    ]) &&
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

export function requestImplicitAuthenticationSubmit(
  form: HTMLFormElement,
  hasAuthenticationUsername: boolean,
  hasAuthenticationPassword: boolean,
): boolean {
  const sourceOrigin = form.ownerDocument.defaultView?.location.origin;
  if (
    !sourceOrigin ||
    formHasSemanticSubmitter(form) ||
    typeof form.requestSubmit !== "function"
  ) {
    return false;
  }
  const destinationRequest: AuthenticationRouteDestinationRequest = {
    form,
  };
  if (
    !canRequestImplicitAuthenticationSubmit(
      form,
      sourceOrigin,
      authenticationRouteDestination(destinationRequest),
      hasAuthenticationUsername,
      hasAuthenticationPassword,
    )
  ) {
    return false;
  }
  return observeSubmit({
    form,
    action: () => form.requestSubmit(),
  });
}

export function authenticationRouteDestination({
  form,
  control,
}: AuthenticationRouteDestinationRequest): string {
  if (control?.hasAttribute("formaction")) {
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
  const hasLocalUnownedScope =
    !form &&
    !query.usernameField.form &&
    query.kind === PasswordFormQueryKind.Scoped &&
    query.formScope.kind === PasswordFormScopeKind.Unowned &&
    query.root !== control.ownerDocument;

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
  const ownedScope =
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
}: FormSubmissionObservation): boolean {
  let submitted = false;
  const markSubmitted = () => {
    submitted = true;
  };
  const listenerOptions: AddEventListenerOptions = {
    capture: true,
    once: true,
  };
  form.addEventListener("submit", markSubmitted, listenerOptions);
  action();
  form.removeEventListener("submit", markSubmitted, true);
  return submitted;
}
