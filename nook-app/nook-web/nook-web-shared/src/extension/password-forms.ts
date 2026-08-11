import { companionWasmReady } from "./companion-ready";
import {
  NookLoginContextObservation,
  NookPageInputFieldObservation,
  expand_identity_text,
  has_login_context,
  looks_like_email_verification_body,
  looks_like_manual_checkpoint_label,
  looks_like_one_time_code_field,
  looks_like_passkey_control_label,
  looks_like_username_field,
  parse_page_input_type,
} from "./nook-companion-wasm/nook_companion_wasm.js";

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

export enum PasswordFormScopeKind {
  Owned = "owned",
  Unowned = "unowned",
}

export type PasswordFormScope =
  | { kind: PasswordFormScopeKind.Owned; owner: HTMLFormElement }
  | { kind: PasswordFormScopeKind.Unowned };

export type PasswordFormObservation = {
  root: ParentNode;
  formScope: PasswordFormScope;
  summary: PasswordFormSummary;
};

export const usernameFieldSelectors = [
  'input[autocomplete~="username" i]',
  'input[autocomplete~="email" i]',
  'input[type="email"]',
  'input[type="text"][autocomplete~="username" i]',
  'input[type="text"][name*="user" i]',
  'input[type="text"][name*="email" i]',
  'input[type="text"][id*="user" i]',
  'input[type="text"][id*="email" i]',
  // Popular SSO / email-first login field names (Microsoft, Google, Slack, …).
  'input[name="loginfmt" i]',
  'input[name="identifier" i]',
  'input[name*="login" i]',
  'input[id*="login" i]',
  'input[name*="account" i]',
  'input[id*="account" i]',
  'input[data-qa="login_email"]',
  'input[data-qa*="login_email" i]',
  'input[data-testid*="login" i][type="email"]',
  'input[data-testid*="username" i]',
  'input[data-testid*="email" i]',
] as const;

const usernameCandidateSelector = [
  "input:not([type])",
  'input[type="text"]',
  'input[type="email"]',
  'input[type="tel"]',
].join(",");

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
  "input:not([type])",
  'input[type="text"]',
  'input[type="tel"]',
  'input[type="number"]',
  'input[type="password"]',
].join(",");

function setNativeInputValue({
  input,
  value,
}: {
  input: HTMLInputElement;
  value: string;
}): void {
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

function isRenderedInput(field: HTMLInputElement): boolean {
  if (field.type === "hidden") return false;
  // Cookie/consent layers often mark large subtrees aria-hidden while the
  // login fields remain CSS-visible and focusable (common on Meta). Only the
  // field itself is rejected for aria-hidden; ancestors still fail on hidden /
  // display:none / visibility:hidden so closed header menus stay ignored.
  if (field.getAttribute("aria-hidden") === "true") {
    return false;
  }
  let element = field as HTMLElement;
  while (true) {
    if (element.hidden) {
      return false;
    }
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    if (style?.display === "none" || style?.visibility === "hidden") {
      return false;
    }
    const parent = element.parentElement;
    if (!parent) break;
    element = parent;
  }
  return true;
}

function findFields({
  root,
  selector,
  formScope,
}: {
  root: ParentNode;
  selector: string;
  formScope?: PasswordFormScope;
}): HTMLInputElement[] {
  const queryRoot =
    formScope?.kind === PasswordFormScopeKind.Owned
      ? formScope.owner.ownerDocument
      : root;
  return Array.from(
    queryRoot.querySelectorAll<HTMLInputElement>(selector),
  ).filter((field) =>
    !formScope
      ? true
      : formScope.kind === PasswordFormScopeKind.Unowned
        ? !field.form
        : field.form === formScope.owner,
  );
}

export function findPasswordFields({
  root = document,
  formScope,
}: {
  root?: ParentNode;
  formScope?: PasswordFormScope;
}): HTMLInputElement[] {
  const nookTypedArgs0_0: Parameters<typeof findFields>[0] = {
    root,
    selector: 'input[type="password"]',
    formScope,
  };
  return findFields(nookTypedArgs0_0).filter(
    (field) =>
      !field.disabled && field.type === "password" && isRenderedInput(field),
  );
}

export function findUsernameFields({
  root = document,
  formScope,
}: {
  root?: ParentNode;
  formScope?: PasswordFormScope;
}): HTMLInputElement[] {
  const seen = new Set<HTMLInputElement>();
  const fields: HTMLInputElement[] = [];
  const nookTypedArgs0_1: Parameters<typeof findFields>[0] = {
    root,
    selector: usernameFieldSelectors.join(","),
    formScope,
  };
  const nookTypedArgs0_2: Parameters<typeof findFields>[0] = {
    root,
    selector: usernameCandidateSelector,
    formScope,
  };
  for (const field of [
    ...findFields(nookTypedArgs0_1),
    ...findFields(nookTypedArgs0_2),
  ]) {
    if (seen.has(field) || !looksLikeUsernameField(field)) continue;
    seen.add(field);
    fields.push(field);
  }
  return fields;
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

function rawFieldIdentityText(field: HTMLInputElement): string {
  return [
    field.name,
    field.id,
    field.placeholder,
    field.title,
    field.getAttribute("aria-label") ?? "",
    field.getAttribute("autocomplete") ?? "",
    field.getAttribute("data-qa") ?? "",
    field.getAttribute("data-testid") ?? "",
    associatedLabelText(field),
  ].join(" ");
}

function autocompleteTokens(field: HTMLInputElement): string[] {
  return (field.getAttribute("autocomplete") ?? "")
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

function hasLoginContext(field: HTMLInputElement): boolean {
  const form = field.form;
  const ancestorIdentities: string[] = [];
  let container = field.parentElement;
  let depth = 0;
  while (container && depth < 6) {
    ancestorIdentities.push(
      [
        container.id,
        container.className,
        container.getAttribute("role") ?? "",
      ].join(" "),
    );
    container = container.parentElement;
    depth += 1;
  }
  const advanceControl = (form ?? field.parentElement)?.querySelector(
    'button[type="submit"], input[type="submit"], button:not([type])',
  );
  const doc = field.ownerDocument;
  const observation = new NookLoginContextObservation(
    form
      ? [
          form.id,
          form.className,
          form.getAttribute("action") ?? "",
          form.name,
        ].join(" ")
      : "",
    ancestorIdentities,
    advanceControl
      ? [
          advanceControl.textContent ?? "",
          advanceControl.getAttribute("aria-label") ?? "",
          (advanceControl as HTMLInputElement).value ?? "",
        ].join(" ")
      : "",
    `${doc.defaultView?.location?.pathname ?? ""} ${doc.defaultView?.location?.hostname ?? ""}`,
  );
  try {
    return has_login_context(observation);
  } finally {
    observation.free();
  }
}

function pageInputObservation({
  field,
  loginContext,
}: {
  field: HTMLInputElement;
  loginContext: boolean;
}): NookPageInputFieldObservation {
  return new NookPageInputFieldObservation(
    parse_page_input_type(field.type),
    field.disabled,
    field.readOnly,
    autocompleteTokens(field),
    rawFieldIdentityText(field),
    loginContext,
  );
}

function looksLikeUsernameField(field: HTMLInputElement): boolean {
  if (!isRenderedInput(field)) return false;
  const nookTypedArgs0_3: Parameters<typeof pageInputObservation>[0] = {
    field,
    loginContext: hasLoginContext(field),
  };
  const observation = pageInputObservation(nookTypedArgs0_3);
  try {
    return looks_like_username_field(observation);
  } finally {
    observation.free();
  }
}

function looksLikeOneTimeCodeField(field: HTMLInputElement): boolean {
  if (!isRenderedInput(field)) return false;
  const nookTypedArgs0_4: Parameters<typeof pageInputObservation>[0] = {
    field,
    loginContext: false,
  };
  const observation = pageInputObservation(nookTypedArgs0_4);
  try {
    return looks_like_one_time_code_field(observation);
  } finally {
    observation.free();
  }
}

export function findOneTimeCodeFields({
  root = document,
  formScope,
}: {
  root?: ParentNode;
  formScope?: PasswordFormScope;
} = {}): HTMLInputElement[] {
  const seen = new Set<HTMLInputElement>();
  const fields: HTMLInputElement[] = [];
  const nookTypedArgs0_5: Parameters<typeof findFields>[0] = {
    root,
    selector: oneTimeCodeCandidateSelector,
    formScope,
  };
  for (const field of findFields(nookTypedArgs0_5)) {
    if (seen.has(field) || !looksLikeOneTimeCodeField(field)) continue;
    seen.add(field);
    fields.push(field);
  }
  return fields;
}

function hasAutocompleteToken({
  field,
  expected,
}: {
  field: HTMLInputElement;
  expected: string;
}): boolean {
  return field.autocomplete
    .toLowerCase()
    .split(/\s+/u)
    .filter(Boolean)
    .includes(expected);
}

export enum PasskeyControlLookupKind {
  Absent = "absent",
  Found = "found",
}

export type PasskeyControlLookup =
  | { kind: PasskeyControlLookupKind.Absent }
  | { kind: PasskeyControlLookupKind.Found; control: HTMLElement };

export function findPasskeyControl(
  root: ParentNode = document,
): PasskeyControlLookup {
  // Only marked controls and labeled activatable elements count. Do not treat
  // password/username inputs that happen to include `webauthn` in autocomplete
  // (common on combined login forms) as passkey controls — that falsely
  // proposes "Create passkey" instead of password autofill.
  const marked = root.querySelector?.("[data-nook-passkey-control]");
  if (marked instanceof HTMLElement) {
    return { kind: PasskeyControlLookupKind.Found, control: marked };
  }
  const controls = Array.from(
    root.querySelectorAll?.<HTMLElement>(
      'button, a[href], [role="button"], input[type="button"], input[type="submit"]',
    ) ?? [],
  );
  for (const control of controls) {
    const labeled = (
      control.textContent ??
      control.getAttribute("aria-label") ??
      control.getAttribute("title") ??
      (control as HTMLInputElement).value ??
      ""
    ).trim();
    if (labeled && looks_like_passkey_control_label(labeled)) {
      return { kind: PasskeyControlLookupKind.Found, control };
    }
  }
  return { kind: PasskeyControlLookupKind.Absent };
}

export function pageHasPasskeyControl(root: ParentNode = document): boolean {
  return findPasskeyControl(root).kind === PasskeyControlLookupKind.Found;
}

function pageHasManualCheckpoint(root: ParentNode): boolean {
  const doc = root.ownerDocument ?? document;
  if (
    doc.querySelector(
      'iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i], iframe[src*="turnstile" i], iframe[title*="captcha" i], [data-nook-manual-checkpoint]',
    )
  ) {
    return true;
  }
  const checkboxes = Array.from(
    root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  );
  for (const checkbox of checkboxes) {
    const labeled = (
      checkbox.labels?.[0]?.textContent ??
      checkbox.getAttribute("aria-label") ??
      checkbox.name ??
      checkbox.id ??
      ""
    ).toLowerCase();
    if (looks_like_manual_checkpoint_label(labeled)) {
      return true;
    }
  }
  return looks_like_email_verification_body(root.textContent ?? "");
}

function summarizeRoot({
  root,
  formScope,
}: {
  root: ParentNode;
  formScope?: PasswordFormScope;
}): PasswordFormSummary {
  const nookTypedArgs0_6: Parameters<typeof findPasswordFields>[0] = {
    root,
    formScope,
  };
  const passwordFields = findPasswordFields(nookTypedArgs0_6);
  const nookTypedArgs0_7: Parameters<typeof findUsernameFields>[0] = {
    root,
    formScope,
  };
  const usernameFields = findUsernameFields(nookTypedArgs0_7);
  const nookTypedArgs0_8: Parameters<typeof findOneTimeCodeFields>[0] = {
    root,
    formScope,
  };
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

export function summarizePasswordForms(
  root: ParentNode = document,
): PasswordFormSummary {
  const nookTypedArgs0_9: Parameters<typeof summarizeRoot>[0] = { root };
  return summarizeRoot(nookTypedArgs0_9);
}

function nearestUnownedAuthContainer({
  field,
  root,
}: {
  field: HTMLInputElement;
  root: ParentNode;
}): ParentNode {
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

function isAuthUsernameField(field: HTMLInputElement): boolean {
  const nookNamedArgs0_0: Parameters<typeof hasAutocompleteToken>[0] = {
    field,
    expected: "username",
  };
  const nookNamedArgs0_1: Parameters<typeof hasAutocompleteToken>[0] = {
    field,
    expected: "email",
  };
  return (
    hasAutocompleteToken(nookNamedArgs0_0) ||
    hasAutocompleteToken(nookNamedArgs0_1) ||
    looksLikeUsernameField(field)
  );
}

export function summarizeAuthenticationWorkflowForms(
  root: ParentNode = document,
): PasswordFormObservation[] {
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
    const nookTypedArgs0_2: Parameters<typeof summarizeRoot>[0]["formScope"] = {
      kind: PasswordFormScopeKind.Unowned,
    };
    const nookTypedArgs0_13: Parameters<typeof summarizeRoot>[0] = {
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
    (left, right) => {
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
    },
  );
}

export function fillOneTimeCode({
  code,
  root = document,
  formScope,
}: {
  code: string;
  root?: ParentNode;
  formScope?: PasswordFormScope;
}): boolean {
  const nookTypedArgs0_16: Parameters<typeof findOneTimeCodeFields>[0] = {
    root,
    formScope,
  };
  const field = findOneTimeCodeFields(nookTypedArgs0_16)[0];
  if (!field) return false;
  const nookTypedArgs0_17: Parameters<typeof setNativeInputValue>[0] = {
    input: field,
    value: code,
  };
  setNativeInputValue(nookTypedArgs0_17);
  field.focus();
  return true;
}

export function fillLoginCredentials({
  credentials,
  root = document,
  formScope,
}: {
  credentials: LoginCredentials;
  root?: ParentNode;
  formScope?: PasswordFormScope;
}): boolean {
  const nookTypedArgs0_18: Parameters<typeof findPasswordFields>[0] = {
    root,
    formScope,
  };
  const passwordFields = findPasswordFields(nookTypedArgs0_18);
  const nookTypedArgs0_19: Parameters<typeof findUsernameFields>[0] = {
    root,
    formScope,
  };
  const usernameCandidates = findUsernameFields(nookTypedArgs0_19);
  const usernameField = usernameCandidates[0];

  if (passwordFields.length === 0) {
    if (!usernameField) return false;
    const nookTypedArgs0_20: Parameters<typeof setNativeInputValue>[0] = {
      input: usernameField,
      value: credentials.username,
    };
    setNativeInputValue(nookTypedArgs0_20);
    usernameField.focus();
    return true;
  }

  const passwordField = passwordFields[0];
  if (usernameField) {
    const nookTypedArgs0_21: Parameters<typeof setNativeInputValue>[0] = {
      input: usernameField,
      value: credentials.username,
    };
    setNativeInputValue(nookTypedArgs0_21);
  }
  const nookTypedArgs0_22: Parameters<typeof setNativeInputValue>[0] = {
    input: passwordField,
    value: credentials.password,
  };
  setNativeInputValue(nookTypedArgs0_22);
  return true;
}

/** Fill every `new-password` field (and confirm) without touching current-password. */
export function fillGeneratedPassword({
  password,
  root = document,
  formScope,
}: {
  password: string;
  root?: ParentNode;
  formScope?: PasswordFormScope;
}): boolean {
  const nookTypedArgs0_23: Parameters<typeof findPasswordFields>[0] = {
    root,
    formScope,
  };
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
      value: password,
    };
    setNativeInputValue(nookTypedArgs0_24);
  }
  newPasswordFields[0]?.focus();
  return true;
}

/** Read username/password from a classified auth form scope for a save offer. */
export function readLoginCredentials({
  root = document,
  formScope,
}: {
  root?: ParentNode;
  formScope?: PasswordFormScope;
}): LoginCredentialsLookup {
  const nookTypedArgs0_25: Parameters<typeof findPasswordFields>[0] = {
    root,
    formScope,
  };
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
  const nookNamedArgs0_3: Parameters<typeof findUsernameFields>[0] = {
    root,
    formScope,
  };
  const username = findUsernameFields(nookNamedArgs0_3)[0]?.value.trim() ?? "";
  if (!username || !password) {
    return { kind: LoginCredentialsLookupKind.Absent };
  }
  return {
    kind: LoginCredentialsLookupKind.Found,
    credentials: { username, password },
  };
}

export function submitLoginForm({
  root = document,
  formScope,
}: {
  root?: ParentNode;
  formScope?: PasswordFormScope;
} = {}): boolean {
  const nookTypedArgs0_26: Parameters<typeof findPasswordFields>[0] = {
    root,
    formScope,
  };
  const passwordField = findPasswordFields(nookTypedArgs0_26)[0];
  const nookTypedArgs0_27: Parameters<typeof findUsernameFields>[0] = {
    root,
    formScope,
  };
  const usernameField = findUsernameFields(nookTypedArgs0_27)[0];
  const anchor = passwordField ?? usernameField;
  if (!anchor) return false;

  // Email-first / multi-step logins often use a type=button "Next" control
  // rather than a real submit. Prefer an advance control before requestSubmit
  // only while the password step is still missing.
  const nookNamedArgs0_4: Parameters<typeof clickAdvanceControl>[0] = {
    root,
    formScope,
  };
  if (!passwordField && clickAdvanceControl(nookNamedArgs0_4)) {
    return true;
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

function clickAdvanceControl({
  root,
  formScope,
}: {
  root: ParentNode;
  formScope?: PasswordFormScope;
}): boolean {
  const queryRoot =
    formScope?.kind === PasswordFormScopeKind.Owned ? formScope.owner : root;
  const controls = Array.from(
    queryRoot.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      'button[type="submit"], input[type="submit"], button:not([type]), button[type="button"]',
    ),
  );
  for (const control of controls) {
    if (control.disabled || control.getAttribute("aria-disabled") === "true") {
      continue;
    }
    const label = expand_identity_text(
      [
        control.textContent ?? "",
        control.getAttribute("aria-label") ?? "",
        control.value ?? "",
      ].join(" "),
    );
    if (
      !/\b(?:next|continue|sign[\s-]*in|log[\s-]*in|submit|verify)\b/u.test(
        label,
      )
    ) {
      continue;
    }
    control.click();
    return true;
  }
  return false;
}

function observeSubmit({
  form,
  action,
}: {
  form: HTMLFormElement;
  action: () => void;
}): boolean {
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
