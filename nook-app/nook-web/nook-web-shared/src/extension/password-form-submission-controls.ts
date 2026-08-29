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

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function truncateUtf8Bytes(value: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(value);
  if (encoded.length <= maxBytes) {
    return value;
  }
  let end = maxBytes;
  while (end > 0 && (encoded[end] & 0b1100_0000) === 0b1000_0000) {
    end -= 1;
  }
  return new TextDecoder().decode(encoded.subarray(0, end));
}

export function boundedAuthenticationText(value: string): string {
  return truncateUtf8Bytes(value, MAX_AUTHENTICATION_CONTROL_TEXT_BYTES);
}

export function boundedAuthenticationDestination(identity: string): string {
  if (utf8ByteLength(identity) <= MAX_AUTHENTICATION_CONTROL_TEXT_BYTES) {
    return identity;
  }
  try {
    const url = new URL(identity);
    const pathIdentity = `${url.origin}${url.pathname}`;
    if (utf8ByteLength(pathIdentity) <= MAX_AUTHENTICATION_CONTROL_TEXT_BYTES) {
      return pathIdentity;
    }
    return truncateUtf8Bytes(
      pathIdentity,
      MAX_AUTHENTICATION_CONTROL_TEXT_BYTES,
    );
  } catch {
    return truncateUtf8Bytes(identity, MAX_AUTHENTICATION_CONTROL_TEXT_BYTES);
  }
}

export function ownedFormIdentity(form: HTMLFormElement): string {
  return boundedAuthenticationText(
    [
      form.id,
      form.getAttribute("name") ?? "",
      form.getAttribute("class") ?? "",
      form.getAttribute("aria-label") ?? "",
    ].join(" "),
  );
}

export function ownedFormDestinationIdentity(form: HTMLFormElement): string {
  return boundedAuthenticationDestination(
    form.hasAttribute("action")
      ? form.action
      : (form.ownerDocument.defaultView?.location.href ?? ""),
  );
}

export function controlDestinationIdentity(
  control: HTMLElement,
  formScope: PasswordFormScope,
): string {
  if (control instanceof HTMLAnchorElement) {
    return boundedAuthenticationDestination(control.href);
  }
  if (
    (control instanceof HTMLButtonElement ||
      control instanceof HTMLInputElement) &&
    control.hasAttribute("formaction")
  ) {
    return boundedAuthenticationDestination(control.formAction);
  }
  if (
    (control instanceof HTMLButtonElement ||
      control instanceof HTMLInputElement) &&
    control.form
  ) {
    return ownedFormDestinationIdentity(control.form);
  }
  return formScope.kind === PasswordFormScopeKind.Owned
    ? ownedFormDestinationIdentity(formScope.owner)
    : boundedAuthenticationDestination(location.href);
}

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
  const formIdentity = boundedAuthenticationText(
    [
      identityContainer?.id ?? "",
      identityContainer?.getAttribute("name") ?? "",
      identityContainer?.getAttribute("class") ?? "",
      identityContainer?.getAttribute("aria-label") ?? "",
    ].join(" "),
  );
  const destinationIdentity = authenticationControlDestination(control);
  if (!destinationIdentity) return false;

  const sharesOwnedForm = Boolean(form && form === query.usernameField.form);
  const hasLocalUnownedScope =
    !form &&
    !query.usernameField.form &&
    query.kind === PasswordFormQueryKind.Scoped &&
    query.formScope.kind === PasswordFormScopeKind.Unowned &&
    query.root !== control.ownerDocument;
  const machineIdentity = boundedAuthenticationText(
    `${control.id} ${control.name}=${control.value}`,
  );

  return can_activate_authentication_route_control(
    sourceOrigin,
    formIdentity,
    destinationIdentity,
    boundedAuthenticationText(controlLabel),
    machineIdentity,
    true,
    isAuthUsernameField(query.usernameField),
    sharesOwnedForm || hasLocalUnownedScope,
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
    return control.form === form;
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
