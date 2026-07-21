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

export type PasswordFormScope =
  | { kind: "owned"; owner: HTMLFormElement }
  | { kind: "unowned" };

export type PasswordFormObservation = {
  root: ParentNode;
  formScope: PasswordFormScope;
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

const oneTimeCodeCandidateSelector = [
  'input:not([type])',
  'input[type="text"]',
  'input[type="tel"]',
  'input[type="number"]',
  'input[type="password"]',
].join(',');

/** Matches accessible names like "Enter OTP Code" and camelCase attrs like VerificationCode. */
const oneTimeCodePositivePattern =
  /\b(?:otp|totp|2\s*fa|mfa|two\s*fa|two\s*factor|one\s*time(?:\s*code)?|auth(?:entication)?\s*code|verification\s*code|authenticator(?:\s*code)?)\b/u;

/** Avoid card CVV / postal / search fields that mention "code". */
const oneTimeCodeNegativePattern =
  /\b(?:card|credit|debit|cvv|cvc|csc|security\s*code|pin\s*code|postal|zip|search|coupon)\b/u;

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
  if (field.type === "hidden") return false;
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
  formScope?: PasswordFormScope,
): HTMLInputElement[] {
  const queryRoot =
    formScope?.kind === "owned" ? formScope.owner.ownerDocument : root;
  return Array.from(
    queryRoot.querySelectorAll<HTMLInputElement>(selector),
  ).filter((field) =>
    formScope === undefined
      ? true
      : formScope.kind === "unowned"
        ? !field.form
        : field.form === formScope.owner,
  );
}

export function findPasswordFields(
  root: ParentNode = document,
  formScope?: PasswordFormScope,
): HTMLInputElement[] {
  return findFields(root, 'input[type="password"]', formScope).filter(
    (field) =>
      !field.disabled && field.type === "password" && isRenderedInput(field),
  );
}

export function findUsernameFields(
  root: ParentNode = document,
  formScope?: PasswordFormScope,
): HTMLInputElement[] {
  return findFields(root, usernameFieldSelectors.join(","), formScope).filter(
    (field) => !field.disabled && !field.readOnly && isRenderedInput(field),
  );
}

function expandIdentityText(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .replace(/([A-Za-z])(\d)/gu, "$1 $2")
    .replace(/(\d)([A-Za-z])/gu, "$1 $2")
    .replace(/[_\-.]+/gu, " ")
    .toLowerCase();
}

function associatedLabelText(field: HTMLInputElement): string {
  const parts: string[] = [];
  if (field.labels) {
    for (const label of field.labels) {
      parts.push(label.textContent ?? "");
    }
  }
  const labelledBy = field.getAttribute("aria-labelledby");
  if (labelledBy) {
    for (const id of labelledBy.split(/\s+/u).filter(Boolean)) {
      const labelled = field.ownerDocument.getElementById(id);
      if (labelled?.textContent) {
        parts.push(labelled.textContent);
      }
    }
  }
  return parts.join(" ");
}

function oneTimeCodeIdentityText(field: HTMLInputElement): string {
  return expandIdentityText(
    [
      field.name,
      field.id,
      field.placeholder,
      field.title,
      field.getAttribute("aria-label") ?? "",
      field.getAttribute("autocomplete") ?? "",
      associatedLabelText(field),
    ].join(" "),
  );
}

function looksLikeOneTimeCodeField(field: HTMLInputElement): boolean {
  if (
    field.disabled ||
    field.readOnly ||
    !isRenderedInput(field) ||
    !["text", "tel", "number", "password"].includes(field.type)
  ) {
    return false;
  }
  const identity = oneTimeCodeIdentityText(field);
  if (!identity || oneTimeCodeNegativePattern.test(identity)) {
    return false;
  }
  // Prefer tokenized identity over CSS substring selectors so names like
  // "hotpot" are not treated as OTP just because they contain "otp".
  return oneTimeCodePositivePattern.test(identity);
}

export function findOneTimeCodeFields(
  root: ParentNode = document,
  formScope?: PasswordFormScope,
): HTMLInputElement[] {
  const seen = new Set<HTMLInputElement>();
  const fields: HTMLInputElement[] = [];
  for (const field of findFields(
    root,
    oneTimeCodeCandidateSelector,
    formScope,
  )) {
    if (seen.has(field) || !looksLikeOneTimeCodeField(field)) continue;
    seen.add(field);
    fields.push(field);
  }
  return fields;
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
  formScope?: PasswordFormScope,
): PasswordFormSummary {
  const passwordFields = findPasswordFields(root, formScope);
  const usernameFields = findUsernameFields(root, formScope);
  const oneTimeCodeFields = findOneTimeCodeFields(root, formScope);
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

function nearestUnownedAuthContainer(
  field: HTMLInputElement,
  root: ParentNode,
): ParentNode {
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
    const formScope: PasswordFormScope = { kind: "owned", owner: form };
    const summary = summarizeRoot(root, formScope);
    return (
      summary.passwordFieldCount > 0 ||
      summary.oneTimeCodeFieldCount > 0 ||
      findUsernameFields(root, formScope).some((field) =>
        hasAutocompleteToken(field, "username"),
      )
    );
  });
  const observations: PasswordFormObservation[] = forms.map((form) => ({
    root,
    formScope: { kind: "owned", owner: form },
    summary: summarizeRoot(root, { kind: "owned", owner: form }),
  }));
  const unownedFields = [
    ...allPasswordFields,
    ...allUsernameFields,
    ...allOneTimeCodeFields,
  ].filter((field) => !field.form);
  const unownedContainers = new Set(
    unownedFields.map((field) => nearestUnownedAuthContainer(field, root)),
  );
  for (const container of unownedContainers) {
    const formScope: PasswordFormScope = { kind: "unowned" };
    observations.push({
      root: container,
      formScope,
      summary: summarizeRoot(container, formScope),
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
  formScope?: PasswordFormScope,
): boolean {
  const field = findOneTimeCodeFields(root, formScope)[0];
  if (!field) return false;
  setNativeInputValue(field, code);
  field.focus();
  return true;
}

export function fillLoginCredentials(
  credentials: LoginCredentials,
  root: ParentNode = document,
  formScope?: PasswordFormScope,
): boolean {
  const passwordFields = findPasswordFields(root, formScope);
  if (passwordFields.length === 0) return false;

  const passwordField = passwordFields[0];
  const usernameCandidates = findUsernameFields(root, formScope);
  const usernameField = usernameCandidates[0];

  if (usernameField) {
    setNativeInputValue(usernameField, credentials.username);
  }
  setNativeInputValue(passwordField, credentials.password);
  return true;
}

/** Read username/password from a classified auth form scope for a save offer. */
export function readLoginCredentials(
  root: ParentNode = document,
  formScope?: PasswordFormScope,
): LoginCredentials | undefined {
  const passwordFields = findPasswordFields(root, formScope);
  if (passwordFields.length === 0) return undefined;

  const newPasswordFields = passwordFields.filter((field) =>
    hasAutocompleteToken(field, "new-password"),
  );
  const passwordField =
    newPasswordFields[0] ??
    passwordFields.find((field) =>
      hasAutocompleteToken(field, "current-password"),
    ) ??
    passwordFields[0];
  const password = passwordField.value.trim();
  const username =
    findUsernameFields(root, formScope)[0]?.value.trim() ?? "";
  if (!username || !password) return undefined;
  return { username, password };
}

export function submitLoginForm(
  root: ParentNode = document,
  formScope?: PasswordFormScope,
): boolean {
  const passwordField = findPasswordFields(root, formScope)[0];
  if (!passwordField) return false;
  const form = passwordField.form;
  if (!form) return false;

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
    return observeSubmit(form, () => submitControl.click());
  }
  if (typeof form.requestSubmit === "function") {
    return observeSubmit(form, () => form.requestSubmit());
  }
  return false;
}

function observeSubmit(form: HTMLFormElement, action: () => void): boolean {
  let submitted = false;
  const markSubmitted = () => {
    submitted = true;
  };
  form.addEventListener("submit", markSubmitted, {
    capture: true,
    once: true,
  });
  action();
  form.removeEventListener("submit", markSubmitted, true);
  return submitted;
}
