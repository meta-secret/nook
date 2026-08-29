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

export const authenticationAdvanceControlSelector =
  'button[type="submit"], input[type="submit"], input[type="image"], button:not([type]), button[type="button"]';

export const semanticSubmitControlSelector =
  'button[type="submit"], input[type="submit"], input[type="image"], button:not([type])';

export function isRenderedControl(control: HTMLElement): boolean {
  let element: HTMLElement = control;
  for (;;) {
    const style = getComputedStyle(element);
    const rendered = style.display !== "none" && style.visibility !== "hidden";
    if (element.hidden || !rendered) return false;
    const parent = element.parentElement;
    if (!(parent instanceof HTMLElement)) return true;
    element = parent;
  }
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

export function authenticationRouteDestination({
  form,
  control,
}: AuthenticationRouteDestinationRequest): string {
  if (control?.hasAttribute("formaction")) return control.formAction;
  if (form.hasAttribute("action")) return form.action;
  return form.ownerDocument.defaultView?.location.href ?? "";
}

function authenticationControlDestination(
  control: LoginAdvanceControl,
): string {
  if (!control.form) {
    return control.ownerDocument.defaultView?.location.origin ?? "";
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
  if (!destinationIdentity) return false;

  const sharesOwnedForm = Boolean(form && form === query.usernameField.form);
  const hasLocalUnownedScope =
    !form &&
    !query.usernameField.form &&
    query.kind === PasswordFormQueryKind.Scoped &&
    query.formScope.kind === PasswordFormScopeKind.Unowned &&
    query.root !== control.ownerDocument;
  const machineIdentity = `${control.id} ${control.name}=${control.value}`;

  return can_activate_authentication_route_control(
    sourceOrigin,
    formIdentity,
    destinationIdentity,
    controlLabel,
    machineIdentity,
    true,
    isAuthUsernameField(query.usernameField),
    sharesOwnedForm || hasLocalUnownedScope,
  );
}

export function clickAdvanceControl(
  request: LoginAdvanceControlRequest,
): boolean {
  const ownedForm =
    request.kind === PasswordFormQueryKind.Scoped &&
    request.formScope.kind === PasswordFormScopeKind.Owned
      ? request.formScope.owner
      : undefined;
  const queryRoot = ownedForm?.ownerDocument ?? request.root;
  const controls = Array.from(
    queryRoot.querySelectorAll<LoginAdvanceControl>(
      authenticationAdvanceControlSelector,
    ),
  );
  for (const control of controls) {
    if (ownedForm && control.form !== ownedForm) {
      continue;
    }
    if (
      control.disabled ||
      control.getAttribute("aria-disabled") === "true" ||
      !isRenderedControl(control)
    ) {
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
