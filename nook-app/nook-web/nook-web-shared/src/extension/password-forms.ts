export type PasswordFormSummary = {
  passwordFieldCount: number;
  currentPasswordFieldCount: number;
  newPasswordFieldCount: number;
  genericPasswordFieldCount: number;
  usernameFieldCount: number;
  oneTimeCodeFieldCount: number;
  formCount: number;
  observedAt: number;
};

export type LoginCredentials = {
  username: string;
  password: string;
};

export type PasswordFormObservation = {
  root: ParentNode;
  formOwner: HTMLFormElement | null;
  summary: PasswordFormSummary;
};

export const usernameFieldSelectors = [
  'input[autocomplete~="username" i]',
  'input[type="email"]',
  'input[type="text"][autocomplete~="username" i]',
  'input[type="text"][name*="user" i]',
  'input[type="text"][name*="email" i]',
  'input[type="text"][id*="user" i]',
  'input[type="text"][id*="email" i]',
] as const;

export const oneTimeCodeFieldSelectors = [
  'input[autocomplete~="one-time-code" i]',
  'input[name*="totp" i]',
  'input[id*="totp" i]',
  'input[name*="otp" i]',
  'input[id*="otp" i]',
  'input[name*="2fa" i]',
  'input[id*="2fa" i]',
  'input[name*="mfa" i]',
  'input[id*="mfa" i]',
  'input[name*="auth-code" i]',
  'input[id*="auth-code" i]',
  'input[name*="verification-code" i]',
  'input[id*="verification-code" i]',
] as const;

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const prototype = Object.getPrototypeOf(input) as HTMLInputElement;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  if (descriptor?.set) {
    descriptor.set.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function isRenderedInput(field: HTMLInputElement): boolean {
  let element: HTMLElement | undefined = field;
  while (element) {
    if (element.hidden || element.getAttribute("aria-hidden") === "true") {
      return false;
    }
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    if (style?.display === "none" || style?.visibility === "hidden") {
      return false;
    }
    element = element.parentElement ?? undefined;
  }
  return true;
}

function findFields(
  root: ParentNode,
  selector: string,
  formOwner?: HTMLFormElement | null,
): HTMLInputElement[] {
  const queryRoot =
    formOwner instanceof HTMLFormElement ? formOwner.ownerDocument : root;
  return Array.from(
    queryRoot.querySelectorAll<HTMLInputElement>(selector),
  ).filter((field) =>
    formOwner === undefined
      ? true
      : formOwner === null
        ? field.form === null
        : field.form === formOwner,
  );
}

export function findPasswordFields(
  root: ParentNode = document,
  formOwner?: HTMLFormElement | null,
): HTMLInputElement[] {
  return findFields(root, 'input[type="password"]', formOwner).filter(
    (field) => !field.disabled && field.type === "password",
  );
}

export function findUsernameFields(
  root: ParentNode = document,
  formOwner?: HTMLFormElement | null,
): HTMLInputElement[] {
  return findFields(root, usernameFieldSelectors.join(","), formOwner).filter(
    (field) => !field.disabled,
  );
}

export function findOneTimeCodeFields(
  root: ParentNode = document,
  formOwner?: HTMLFormElement | null,
): HTMLInputElement[] {
  return findFields(
    root,
    oneTimeCodeFieldSelectors.join(","),
    formOwner,
  ).filter(
    (field) =>
      !field.disabled &&
      !field.readOnly &&
      isRenderedInput(field) &&
      ["text", "tel", "number", "password"].includes(field.type),
  );
}

function hasAutocompleteToken(
  field: HTMLInputElement,
  expected: string,
): boolean {
  return field.autocomplete
    .toLowerCase()
    .split(/\s+/u)
    .filter(Boolean)
    .includes(expected);
}

function summarizeRoot(
  root: ParentNode,
  formOwner?: HTMLFormElement | null,
): PasswordFormSummary {
  const passwordFields = findPasswordFields(root, formOwner);
  const usernameFields = findUsernameFields(root, formOwner);
  const oneTimeCodeFields = findOneTimeCodeFields(root, formOwner);
  const currentPasswordFieldCount = passwordFields.filter((field) =>
    hasAutocompleteToken(field, "current-password"),
  ).length;
  const newPasswordFieldCount = passwordFields.filter((field) =>
    hasAutocompleteToken(field, "new-password"),
  ).length;
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
    formCount: forms.size,
    observedAt: Date.now(),
  };
}

export function summarizePasswordForms(
  root: ParentNode = document,
): PasswordFormSummary {
  return summarizeRoot(root);
}

export function summarizeAuthenticationWorkflowForms(
  root: ParentNode = document,
): PasswordFormObservation[] {
  const allPasswordFields = findPasswordFields(root);
  const allUsernameFields = findUsernameFields(root);
  const allOneTimeCodeFields = findOneTimeCodeFields(root);
  const authFieldCount =
    allPasswordFields.length +
    allUsernameFields.filter((field) => hasAutocompleteToken(field, "username"))
      .length +
    allOneTimeCodeFields.length;
  if (authFieldCount === 0) return [];

  const forms = Array.from(
    root.querySelectorAll<HTMLFormElement>("form"),
  ).filter((form) => {
    const summary = summarizeRoot(root, form);
    return (
      summary.passwordFieldCount > 0 ||
      summary.oneTimeCodeFieldCount > 0 ||
      findUsernameFields(root, form).some((field) =>
        hasAutocompleteToken(field, "username"),
      )
    );
  });
  const observations: PasswordFormObservation[] = forms.map((form) => ({
    root,
    formOwner: form,
    summary: summarizeRoot(root, form),
  }));
  const hasUnownedFields = [
    ...allPasswordFields,
    ...allUsernameFields,
    ...allOneTimeCodeFields,
  ].some((field) => field.form === null);
  if (hasUnownedFields) {
    observations.push({
      root,
      formOwner: null,
      summary: summarizeRoot(root, null),
    });
  }
  return observations.sort((left, right) => {
    const signal = ({ summary }: PasswordFormObservation) =>
      summary.oneTimeCodeFieldCount > 0
        ? 5
        : summary.currentPasswordFieldCount > 0
          ? 4
          : summary.genericPasswordFieldCount === 1
            ? 3
            : summary.passwordFieldCount > 0
              ? 2
              : 1;
    return signal(right) - signal(left);
  });
}

export function fillOneTimeCode(
  code: string,
  root: ParentNode = document,
  formOwner?: HTMLFormElement | null,
): boolean {
  const field = findOneTimeCodeFields(root, formOwner)[0];
  if (!field) return false;
  setNativeInputValue(field, code);
  field.focus();
  return true;
}

export function fillLoginCredentials(
  credentials: LoginCredentials,
  root: ParentNode = document,
  formOwner?: HTMLFormElement | null,
): boolean {
  const passwordFields = findPasswordFields(root, formOwner);
  if (passwordFields.length === 0) return false;

  const passwordField = passwordFields[0];
  const usernameCandidates = findUsernameFields(root, formOwner);
  const usernameField = usernameCandidates[0];

  if (usernameField) {
    setNativeInputValue(usernameField, credentials.username);
  }
  setNativeInputValue(passwordField, credentials.password);
  return true;
}

export function submitLoginForm(
  root: ParentNode = document,
  formOwner?: HTMLFormElement | null,
): boolean {
  const passwordField = findPasswordFields(root, formOwner)[0];
  if (!passwordField) return false;
  const form = passwordField.form;
  if (!form) return false;

  const submitControl = form.querySelector<HTMLElement>(
    'button[type="submit"], input[type="submit"], button:not([type])',
  );
  if (submitControl) {
    submitControl.click();
    return true;
  }
  if (typeof form.requestSubmit === "function") {
    form.requestSubmit();
    return true;
  }
  form.submit();
  return true;
}
