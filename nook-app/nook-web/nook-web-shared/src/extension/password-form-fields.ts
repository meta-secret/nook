import { companionWasmReady } from "./companion-ready";
import {
  NookLoginContextObservation,
  NookPageInputFieldObservation,
  has_login_context,
  looks_like_email_verification_body,
  looks_like_manual_checkpoint_label,
  looks_like_one_time_code_field,
  looks_like_passkey_control_label,
  looks_like_username_field,
  parse_page_input_type,
} from "./nook-companion-wasm/nook_companion_wasm.js";

void companionWasmReady;

export enum PasswordFormScopeKind {
  Owned = "owned",
  Unowned = "unowned",
}

export type PasswordFormScope =
  | { kind: PasswordFormScopeKind.Owned; owner: HTMLFormElement }
  | { kind: PasswordFormScopeKind.Unowned };

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
  const findArgs: Parameters<typeof findFields>[0] = {
    root,
    selector: 'input[type="password"]',
    formScope,
  };
  return findFields(findArgs).filter(
    (field) =>
      !field.disabled && field.type === "password" && isRenderedInput(field),
  );
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
  const observationArgs: Parameters<typeof pageInputObservation>[0] = {
    field,
    loginContext: hasLoginContext(field),
  };
  const observation = pageInputObservation(observationArgs);
  try {
    return looks_like_username_field(observation);
  } finally {
    observation.free();
  }
}

function looksLikeOneTimeCodeField(field: HTMLInputElement): boolean {
  if (!isRenderedInput(field)) return false;
  const observationArgs: Parameters<typeof pageInputObservation>[0] = {
    field,
    loginContext: false,
  };
  const observation = pageInputObservation(observationArgs);
  try {
    return looks_like_one_time_code_field(observation);
  } finally {
    observation.free();
  }
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
  const selectorArgs: Parameters<typeof findFields>[0] = {
    root,
    selector: usernameFieldSelectors.join(","),
    formScope,
  };
  const candidateArgs: Parameters<typeof findFields>[0] = {
    root,
    selector: usernameCandidateSelector,
    formScope,
  };
  for (const field of [
    ...findFields(selectorArgs),
    ...findFields(candidateArgs),
  ]) {
    if (seen.has(field) || !looksLikeUsernameField(field)) continue;
    seen.add(field);
    fields.push(field);
  }
  return fields;
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
  const findArgs: Parameters<typeof findFields>[0] = {
    root,
    selector: oneTimeCodeCandidateSelector,
    formScope,
  };
  for (const field of findFields(findArgs)) {
    if (seen.has(field) || !looksLikeOneTimeCodeField(field)) continue;
    seen.add(field);
    fields.push(field);
  }
  return fields;
}

export function hasAutocompleteToken({
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

export function isAuthUsernameField(field: HTMLInputElement): boolean {
  const usernameArgs: Parameters<typeof hasAutocompleteToken>[0] = {
    field,
    expected: "username",
  };
  const emailArgs: Parameters<typeof hasAutocompleteToken>[0] = {
    field,
    expected: "email",
  };
  return (
    hasAutocompleteToken(usernameArgs) ||
    hasAutocompleteToken(emailArgs) ||
    looksLikeUsernameField(field)
  );
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
  // Inputs with a WebAuthn autocomplete token remain credential fields. Only
  // marked or labeled activatable elements count as passkey controls.
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

export function pageHasManualCheckpoint(root: ParentNode): boolean {
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
