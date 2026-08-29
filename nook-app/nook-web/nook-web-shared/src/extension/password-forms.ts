import { companionWasmReady } from "./companion-ready";
import {
  authentication_form_observation_priority,
  can_activate_authentication_route_control,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import type { AuthenticationPageObservation } from "./nook-companion-wasm/nook_companion_wasm.js";
import {
  findOneTimeCodeFields,
  findPasswordFields,
  findUsernameFields,
  hasAutocompleteToken,
  isAuthUsernameField,
  pageHasManualCheckpoint,
  pageHasPasskeyControl,
  PasswordFormScopeKind,
} from "./password-form-fields";
import type { PasswordFormScope } from "./password-form-fields";
import type { PasswordFieldQuery } from "./password-form-fields";

export {
  findOneTimeCodeFields,
  findPasswordFields,
  findUsernameFields,
  findPasskeyControl,
  oneTimeCodeFieldSelectors,
  pageHasPasskeyControl,
  PasskeyControlLookupKind,
  PasswordFormScopeKind,
  usernameFieldSelectors,
} from "./password-form-fields";
export type {
  PasskeyControlLookup,
  PasswordFormScope,
} from "./password-form-fields";

void companionWasmReady;

export type PasswordFormSummary = {
  passwordFieldCount: number;
  currentPasswordFieldCount: number;
  newPasswordFieldCount: number;
  genericPasswordFieldCount: number;
  usernameFieldCount: number;
  oneTimeCodeFieldCount: number;
  /** CAPTCHA, terms acceptance, or email-verification style human gate. */
  manualCheckpointPresent: boolean;
  /** Visible passkey / WebAuthn control the user can activate. */
  passkeyControlPresent: boolean;
  formCount: number;
  observedAt: number;
};

export type LoginCredentials = {
  username: string;
  password: string;
};

export enum LoginCredentialsLookupKind {
  Absent = "absent",
  Found = "found",
}

export type LoginCredentialsLookup =
  | { kind: LoginCredentialsLookupKind.Absent }
  | {
      kind: LoginCredentialsLookupKind.Found;
      credentials: LoginCredentials;
    };

export type PasswordFormObservation = {
  root: ParentNode;
  formScope: PasswordFormScope;
  summary: PasswordFormSummary;
};

type NativeInputValueMutation = {
  input: HTMLInputElement;
  value: string;
};

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

type PasswordFormSummaryRequest = PasswordFormScopeQuery;

type UnownedAuthenticationContainerQuery = {
  field: HTMLInputElement;
  root: ParentNode;
};

export type OneTimeCodeFillRequest = PasswordFormScopeQuery & {
  code: string;
};

export type LoginCredentialsFillRequest = PasswordFormScopeQuery & {
  credentials: LoginCredentials;
};

export type GeneratedPasswordFillRequest = PasswordFormScopeQuery & {
  password: string;
};

type LoginAdvanceControlRequest = PasswordFormScopeQuery & {
  usernameField: HTMLInputElement;
};

type LoginAdvanceControl = HTMLButtonElement | HTMLInputElement;

function isRenderedControl(control: LoginAdvanceControl): boolean {
  let element: HTMLElement | undefined = control;
  while (element) {
    const style = getComputedStyle(element);
    const rendered = style.display !== "none" && style.visibility !== "hidden";
    if (element.hidden || !rendered) return false;
    element = element.parentElement ?? undefined;
  }
  return true;
}

type AuthenticationRouteControlRequest = {
  control: LoginAdvanceControl;
  controlLabel: string;
  query: LoginAdvanceControlRequest;
};

type FormSubmissionObservation = {
  form: HTMLFormElement;
  action: () => void;
};

function setNativeInputValue({ input, value }: NativeInputValueMutation): void {
  const prototype = Object.getPrototypeOf(input) as HTMLInputElement;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  if (descriptor?.set) {
    descriptor.set.call(input, value);
  } else {
    input.value = value;
  }
  const nookTypedArgs0_0: ConstructorParameters<typeof Event>[1] = {
    bubbles: true,
  };
  input.dispatchEvent(new Event("input", nookTypedArgs0_0));
  const nookTypedArgs0_1: ConstructorParameters<typeof Event>[1] = {
    bubbles: true,
  };
  input.dispatchEvent(new Event("change", nookTypedArgs0_1));
}

function passwordFieldQuery(
  request: PasswordFormScopeQuery,
): PasswordFieldQuery {
  if (request.kind === PasswordFormQueryKind.Root) {
    return { root: request.root };
  }
  return { root: request.root, formScope: request.formScope };
}

function summarizeRoot(
  request: PasswordFormSummaryRequest,
): PasswordFormSummary {
  const { root } = request;
  const nookTypedArgs0_6 = passwordFieldQuery(request);
  const passwordFields = findPasswordFields(nookTypedArgs0_6);
  const nookTypedArgs0_7 = passwordFieldQuery(request);
  const usernameFields = findUsernameFields(nookTypedArgs0_7);
  const nookTypedArgs0_8 = passwordFieldQuery(request);
  const oneTimeCodeFields = findOneTimeCodeFields(nookTypedArgs0_8);
  const currentPasswordFieldCount = passwordFields.filter((field) => {
    const nookArrowArgs0: Parameters<typeof hasAutocompleteToken>[0] = {
      field,
      expected: "current-password",
    };
    return hasAutocompleteToken(nookArrowArgs0);
  }).length;
  const newPasswordFieldCount = passwordFields.filter((field) => {
    const nookArrowArgs1: Parameters<typeof hasAutocompleteToken>[0] = {
      field,
      expected: "new-password",
    };
    return hasAutocompleteToken(nookArrowArgs1);
  }).length;
  const forms = new Set<HTMLFormElement>();

  for (const field of [
    ...passwordFields,
    ...usernameFields,
    ...oneTimeCodeFields,
  ]) {
    if (field.form) {
      forms.add(field.form);
    }
  }

  return {
    passwordFieldCount: passwordFields.length,
    currentPasswordFieldCount,
    newPasswordFieldCount,
    genericPasswordFieldCount:
      passwordFields.length - currentPasswordFieldCount - newPasswordFieldCount,
    usernameFieldCount: usernameFields.length,
    oneTimeCodeFieldCount: oneTimeCodeFields.length,
    manualCheckpointPresent: pageHasManualCheckpoint(root),
    passkeyControlPresent: pageHasPasskeyControl(root),
    formCount: forms.size,
    observedAt: Date.now(),
  };
}

export function summarizePasswordForms(): PasswordFormSummary {
  const nookTypedArgs0_9: PasswordFormSummaryRequest = {
    kind: PasswordFormQueryKind.Root,
    root: document,
  };
  return summarizeRoot(nookTypedArgs0_9);
}

function passwordFormPriority({ summary }: PasswordFormObservation): number {
  const observation: AuthenticationPageObservation = {
    usernameFieldCount: summary.usernameFieldCount,
    currentPasswordFieldCount: summary.currentPasswordFieldCount,
    newPasswordFieldCount: summary.newPasswordFieldCount,
    genericPasswordFieldCount: summary.genericPasswordFieldCount,
    oneTimeCodeFieldCount: summary.oneTimeCodeFieldCount,
    manualCheckpointPresent: summary.manualCheckpointPresent,
    authenticatorSetupHint: false,
    backupCodesHint: false,
    passkeyControlPresent: summary.passkeyControlPresent,
    matchingPasskeyAccountCount: 0,
  };
  return authentication_form_observation_priority(observation);
}

function nearestUnownedAuthContainer({
  field,
  root,
}: UnownedAuthenticationContainerQuery): ParentNode {
  let container = field.parentElement;
  while (container && container !== root) {
    const explicitAuthContainer = container.matches(
      'dialog, [role="dialog"], [role="form"], [id*="login" i], [id*="signin" i], [id*="signup" i], [id*="reset" i], [class*="login" i], [class*="signin" i], [class*="signup" i], [class*="reset" i]',
    );
    const hasSubmitControl = Boolean(
      container.querySelector(
        'button[type="submit"], input[type="submit"], button:not([type])',
      ),
    );
    if (explicitAuthContainer || hasSubmitControl) return container;
    container = container.parentElement;
  }
  return root;
}

export function summarizeAuthenticationWorkflowForms(): PasswordFormObservation[] {
  const root = document;
  const nookTypedArgs0_10: Parameters<typeof findPasswordFields>[0] = { root };
  const allPasswordFields = findPasswordFields(nookTypedArgs0_10);
  const nookTypedArgs0_11: Parameters<typeof findUsernameFields>[0] = { root };
  const allUsernameFields = findUsernameFields(nookTypedArgs0_11);
  const nookTypedArgs0_12: Parameters<typeof findOneTimeCodeFields>[0] = {
    root,
  };
  const allOneTimeCodeFields = findOneTimeCodeFields(nookTypedArgs0_12);
  const authUsernameFields = allUsernameFields.filter(isAuthUsernameField);
  const authFieldCount =
    allPasswordFields.length +
    authUsernameFields.length +
    allOneTimeCodeFields.length;
  if (authFieldCount === 0) {
    if (!pageHasPasskeyControl(root)) return [];
    const nookTypedArgs0_2: PasswordFormScope = {
      kind: PasswordFormScopeKind.Unowned,
    };
    const nookTypedArgs0_13: Parameters<typeof summarizeRoot>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root,
      formScope: nookTypedArgs0_2,
    };
    return [
      {
        root,
        formScope: { kind: PasswordFormScopeKind.Unowned },
        summary: summarizeRoot(nookTypedArgs0_13),
      },
    ];
  }

  const forms = Array.from(
    root.querySelectorAll<HTMLFormElement>("form"),
  ).filter((form) => {
    const formScope: PasswordFormScope = {
      kind: PasswordFormScopeKind.Owned,
      owner: form,
    };
    const nookTypedArgs0_14: Parameters<typeof summarizeRoot>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root,
      formScope,
    };
    const summary = summarizeRoot(nookTypedArgs0_14);
    const nookNamedArgs0_2: Parameters<typeof findUsernameFields>[0] = {
      root,
      formScope,
    };
    return (
      summary.passwordFieldCount > 0 ||
      summary.oneTimeCodeFieldCount > 0 ||
      findUsernameFields(nookNamedArgs0_2).some(isAuthUsernameField)
    );
  });
  const observations: PasswordFormObservation[] = forms.map((form) => {
    const summaryArgs: Parameters<typeof summarizeRoot>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root,
      formScope: {
        kind: PasswordFormScopeKind.Owned,
        owner: form,
      },
    };
    return {
      root,
      formScope: { kind: PasswordFormScopeKind.Owned, owner: form },
      summary: summarizeRoot(summaryArgs),
    };
  });
  const unownedFields = [
    ...allPasswordFields,
    ...authUsernameFields,
    ...allOneTimeCodeFields,
  ].filter((field) => !field.form);
  const unownedContainers = new Set(
    unownedFields.map((field) => {
      const nookArrowArgs2: Parameters<typeof nearestUnownedAuthContainer>[0] =
        { field, root };
      return nearestUnownedAuthContainer(nookArrowArgs2);
    }),
  );
  for (const container of unownedContainers) {
    const formScope: PasswordFormScope = {
      kind: PasswordFormScopeKind.Unowned,
    };
    const nookTypedArgs0_15: Parameters<typeof summarizeRoot>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: container,
      formScope,
    };
    const nookTypedArgs0_3: Parameters<typeof observations.push>[0] = {
      root: container,
      formScope,
      summary: summarizeRoot(nookTypedArgs0_15),
    };
    observations.push(nookTypedArgs0_3);
  }
  return observations.sort(
    // eslint-disable-next-line max-params -- Array.sort owns the comparator callback signature.
    (left, right) => passwordFormPriority(right) - passwordFormPriority(left),
  );
}

export function fillOneTimeCode(request: OneTimeCodeFillRequest): boolean {
  const nookTypedArgs0_16 = passwordFieldQuery(request);
  const field = findOneTimeCodeFields(nookTypedArgs0_16)[0];
  if (!field) return false;
  const nookTypedArgs0_17: Parameters<typeof setNativeInputValue>[0] = {
    input: field,
    value: request.code,
  };
  setNativeInputValue(nookTypedArgs0_17);
  field.focus();
  return true;
}

export function fillLoginCredentials(
  request: LoginCredentialsFillRequest,
): boolean {
  const nookTypedArgs0_18 = passwordFieldQuery(request);
  const passwordFields = findPasswordFields(nookTypedArgs0_18);
  const nookTypedArgs0_19 = passwordFieldQuery(request);
  const usernameCandidates = findUsernameFields(nookTypedArgs0_19);
  const usernameField = usernameCandidates[0];

  if (passwordFields.length === 0) {
    if (!usernameField) return false;
    const nookTypedArgs0_20: Parameters<typeof setNativeInputValue>[0] = {
      input: usernameField,
      value: request.credentials.username,
    };
    setNativeInputValue(nookTypedArgs0_20);
    usernameField.focus();
    return true;
  }

  const passwordField = passwordFields[0];
  if (usernameField) {
    const nookTypedArgs0_21: Parameters<typeof setNativeInputValue>[0] = {
      input: usernameField,
      value: request.credentials.username,
    };
    setNativeInputValue(nookTypedArgs0_21);
  }
  const nookTypedArgs0_22: Parameters<typeof setNativeInputValue>[0] = {
    input: passwordField,
    value: request.credentials.password,
  };
  setNativeInputValue(nookTypedArgs0_22);
  return true;
}

/** Fill every `new-password` field (and confirm) without touching current-password. */
export function fillGeneratedPassword(
  request: GeneratedPasswordFillRequest,
): boolean {
  const nookTypedArgs0_23 = passwordFieldQuery(request);
  const passwordFields = findPasswordFields(nookTypedArgs0_23);
  const newPasswordFields = passwordFields.filter((field) => {
    const nookArrowArgs3: Parameters<typeof hasAutocompleteToken>[0] = {
      field,
      expected: "new-password",
    };
    return hasAutocompleteToken(nookArrowArgs3);
  });
  if (newPasswordFields.length === 0) return false;
  for (const field of newPasswordFields) {
    const nookTypedArgs0_24: Parameters<typeof setNativeInputValue>[0] = {
      input: field,
      value: request.password,
    };
    setNativeInputValue(nookTypedArgs0_24);
  }
  newPasswordFields[0]?.focus();
  return true;
}

/** Read username/password from a classified auth form scope for a save offer. */
export function readLoginCredentials(
  request: PasswordFormScopeQuery,
): LoginCredentialsLookup {
  const nookTypedArgs0_25 = passwordFieldQuery(request);
  const passwordFields = findPasswordFields(nookTypedArgs0_25);
  if (passwordFields.length === 0) {
    return { kind: LoginCredentialsLookupKind.Absent };
  }

  const newPasswordFields = passwordFields.filter((field) => {
    const nookArrowArgs4: Parameters<typeof hasAutocompleteToken>[0] = {
      field,
      expected: "new-password",
    };
    return hasAutocompleteToken(nookArrowArgs4);
  });
  const passwordField =
    newPasswordFields[0] ??
    passwordFields.find((field) => {
      const nookArrowArgs5: Parameters<typeof hasAutocompleteToken>[0] = {
        field,
        expected: "current-password",
      };
      return hasAutocompleteToken(nookArrowArgs5);
    }) ??
    passwordFields[0];
  const password = passwordField.value.trim();
  const nookNamedArgs0_3 = passwordFieldQuery(request);
  const username = findUsernameFields(nookNamedArgs0_3)[0]?.value.trim() ?? "";
  if (!username || !password) {
    return { kind: LoginCredentialsLookupKind.Absent };
  }
  return {
    kind: LoginCredentialsLookupKind.Found,
    credentials: { username, password },
  };
}

export function submitLoginForm(request: PasswordFormScopeQuery): boolean {
  const nookTypedArgs0_26 = passwordFieldQuery(request);
  const passwordField = findPasswordFields(nookTypedArgs0_26)[0];
  const nookTypedArgs0_27 = passwordFieldQuery(request);
  const usernameField = findUsernameFields(nookTypedArgs0_27)[0];
  const anchor = passwordField ?? usernameField;
  if (!anchor) return false;

  // Email-first / multi-step logins often use a type=button "Next" control
  // rather than a real submit. Prefer an advance control before requestSubmit
  // only while the password step is still missing.
  if (!passwordField) {
    const nookNamedArgs0_4: Parameters<typeof clickAdvanceControl>[0] = {
      ...request,
      usernameField,
    };
    if (clickAdvanceControl(nookNamedArgs0_4)) return true;
    const form = usernameField.form;
    const sourceOrigin = form?.ownerDocument.defaultView?.location.origin;
    if (
      !form ||
      !sourceOrigin ||
      form.querySelector(
        'button[type="submit"], input[type="submit"], button:not([type])',
      ) ||
      !can_activate_authentication_route_control(
        sourceOrigin,
        [
          form.id,
          form.getAttribute("name") ?? "",
          form.getAttribute("class") ?? "",
          form.getAttribute("aria-label") ?? "",
        ].join(" "),
        form.action,
        "",
        "",
        false,
        isAuthUsernameField(usernameField),
        true,
      )
    ) {
      return false;
    }
    const nookTypedArgs0_28: Parameters<typeof observeSubmit>[0] = {
      form,
      action: () => form.requestSubmit(),
    };
    return observeSubmit(nookTypedArgs0_28);
  }

  const form = anchor.form;
  if (!form) {
    // Password present without a real <form>: fill succeeded, but do not
    // claim submission for opaque type=button host chrome.
    return false;
  }

  const submitControl = form.querySelector<
    HTMLButtonElement | HTMLInputElement
  >('button[type="submit"], input[type="submit"], button:not([type])');
  if (submitControl) {
    if (
      submitControl.disabled ||
      submitControl.getAttribute("aria-disabled") === "true"
    ) {
      return false;
    }
    const nookTypedArgs0_28: Parameters<typeof observeSubmit>[0] = {
      form,
      action: () => submitControl.click(),
    };
    return observeSubmit(nookTypedArgs0_28);
  }
  if (typeof form.requestSubmit === "function") {
    const nookTypedArgs0_29: Parameters<typeof observeSubmit>[0] = {
      form,
      action: () => form.requestSubmit(),
    };
    return observeSubmit(nookTypedArgs0_29);
  }
  return false;
}

function clickAdvanceControl(request: LoginAdvanceControlRequest): boolean {
  const queryRoot =
    request.kind === PasswordFormQueryKind.Scoped &&
    request.formScope.kind === PasswordFormScopeKind.Owned
      ? request.formScope.owner
      : request.root;
  const controls = Array.from(
    queryRoot.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      'button[type="submit"], input[type="submit"], button:not([type]), button[type="button"]',
    ),
  );
  for (const control of controls) {
    if (
      control.disabled ||
      control.getAttribute("aria-disabled") === "true" ||
      !isRenderedControl(control)
    ) {
      continue;
    }
    const label = [
      control.textContent ?? "",
      control.getAttribute("aria-label") ?? "",
      control.title,
      ...(control.getAttribute("aria-labelledby") ?? "")
        .split(/\s+/)
        .map(
          (id) => control.ownerDocument.getElementById(id)?.textContent ?? "",
        ),
      control.tagName === "INPUT" ? control.value || "submit" : "",
    ].join(" ");
    const nookTypedArgs0_30: AuthenticationRouteControlRequest = {
      control,
      controlLabel: label,
      query: request,
    };
    if (!canActivateAuthenticationRouteControl(nookTypedArgs0_30)) {
      continue;
    }
    control.click();
    return true;
  }
  return false;
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
  const destinationIdentity = control.hasAttribute("formaction")
    ? control.formAction
    : (form?.action ?? control.ownerDocument.defaultView?.location.href ?? "");
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

function observeSubmit({ form, action }: FormSubmissionObservation): boolean {
  let submitted = false;
  const markSubmitted = () => {
    submitted = true;
  };
  const nookTypedArgs0_4: Parameters<typeof form.addEventListener>[2] = {
    capture: true,
    once: true,
  };
  form.addEventListener("submit", markSubmitted, nookTypedArgs0_4);
  action();
  form.removeEventListener("submit", markSubmitted, true);
  return submitted;
}
