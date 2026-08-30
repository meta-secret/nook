import { companionWasmReady } from "./companion-ready";
import {
  NookLoginContextObservation,
  NookPageInputFieldObservation,
  authentication_username_evidence,
  has_login_context,
  looks_like_email_verification_body,
  looks_like_login_advance_control_label,
  looks_like_manual_checkpoint_label,
  looks_like_one_time_code_field,
  looks_like_passkey_control_label,
  looks_like_one_time_code_auto_submit_signal,
  looks_like_username_field,
  parse_page_input_type,
  strongest_authentication_username_evidence,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import type { AuthenticationUsernameEvidence } from "./nook-companion-wasm/nook_companion_wasm.js";

void companionWasmReady;

export enum PasswordFormScopeKind {
  Owned = "owned",
  Unowned = "unowned",
}

export type PasswordFormScope =
  | { kind: PasswordFormScopeKind.Owned; owner: HTMLFormElement }
  | { kind: PasswordFormScopeKind.Unowned };

export type PasswordFieldQuery = {
  root?: ParentNode;
  formScope?: PasswordFormScope;
};

type ScopedInputFieldQuery = {
  root: ParentNode;
  selector: string;
  formScope?: PasswordFormScope;
};

type PageInputClassificationRequest = {
  field: HTMLInputElement;
  loginContext: boolean;
};

type AssociatedFormFieldSelectorRequest = {
  selector: string;
  formId: string;
};

type TypeButtonPromotionScopeRequest = {
  container: Element;
  field: HTMLElement;
};

export type UnownedAuthContainerRequest = {
  field: HTMLElement;
  root: ParentNode;
};

export type AutocompleteTokenMatchRequest = {
  field: HTMLInputElement;
  expected: string;
};

export const usernameFieldSelectors = [
  'input[autocomplete~="username" i]',
  'input[autocomplete~="email" i]',
  'input[type="email"]',
  'input[type="text"][autocomplete~="username" i]',
  'input[type="text"][name*="user" i]',
  'input[type="text"][name*="email" i]',
  'input[type="text"][id*="username" i]',
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
  if (field.closest("dialog:not([open])")) return false;
  // Cookie/consent layers often mark large subtrees aria-hidden while the
  // login fields remain CSS-visible and focusable (common on Meta). Only the
  // field itself is rejected for aria-hidden; ancestors still fail on hidden /
  // display:none / visibility:hidden so closed header menus stay ignored.
  if (field.getAttribute("aria-hidden") === "true") {
    return false;
  }
  let element = field as HTMLElement;
  while (true) {
    if (
      element.hidden ||
      element.hasAttribute("inert") ||
      element.inert ||
      element.getAttribute("aria-disabled") === "true" ||
      (element instanceof HTMLDialogElement && !element.open)
    ) {
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

function associatedFormFieldSelector({
  selector,
  formId,
}: AssociatedFormFieldSelectorRequest): string {
  return selector
    .split(",")
    .map((part) => `${part.trim()}[form="${CSS.escape(formId)}"]`)
    .join(",");
}

function findFields({
  root,
  selector,
  formScope,
}: ScopedInputFieldQuery): HTMLInputElement[] {
  if (formScope?.kind === PasswordFormScopeKind.Owned) {
    const owner = formScope.owner;
    const seen = new Set<HTMLInputElement>();
    const fields: HTMLInputElement[] = [];
    for (const field of owner.querySelectorAll<HTMLInputElement>(selector)) {
      if (field.form === owner) {
        seen.add(field);
        fields.push(field);
      }
    }
    if (owner.id) {
      const associatedSelectorRequest: AssociatedFormFieldSelectorRequest = {
        selector,
        formId: owner.id,
      };
      const associated = owner.ownerDocument.querySelectorAll<HTMLInputElement>(
        associatedFormFieldSelector(associatedSelectorRequest),
      );
      for (const field of associated) {
        if (!seen.has(field) && field.form === owner) {
          seen.add(field);
          fields.push(field);
        }
      }
    }
    return fields;
  }
  return Array.from(root.querySelectorAll<HTMLInputElement>(selector)).filter(
    (field) => {
      if (!formScope) return true;
      if (formScope.kind !== PasswordFormScopeKind.Unowned || field.form) {
        return false;
      }
      const containerRequest: UnownedAuthContainerRequest = {
        field,
        root: field.ownerDocument,
      };
      return nearestUnownedAuthContainer(containerRequest) === root;
    },
  );
}

export function findPasswordFields({
  root = document,
  formScope,
}: PasswordFieldQuery): HTMLInputElement[] {
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

function fieldIdentityId(field: HTMLInputElement): string {
  return /username|email|login|account|identifier|otp|totp|mfa|2fa|one-?time|verif/i.test(
    field.id,
  )
    ? field.id
    : "";
}

function rawFieldIdentityText(field: HTMLInputElement): string {
  return [
    field.name,
    fieldIdentityId(field),
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
}: PageInputClassificationRequest): NookPageInputFieldObservation {
  return new NookPageInputFieldObservation(
    parse_page_input_type(field.type),
    field.disabled,
    field.readOnly,
    autocompleteTokens(field),
    rawFieldIdentityText(field),
    loginContext,
  );
}

export function usernameEvidence(
  observation: PasswordFieldQuery,
): AuthenticationUsernameEvidence {
  const usernameQuery: Parameters<typeof findUsernameFields>[0] = {
    root: observation.root,
    formScope: observation.formScope,
  };
  const evidence = findUsernameFields(usernameQuery).map(
    authenticationUsernameEvidence,
  );
  return strongest_authentication_username_evidence(evidence);
}

export function authenticationUsernameEvidence(
  field: HTMLInputElement,
): AuthenticationUsernameEvidence {
  const observationRequest: Parameters<typeof pageInputObservation>[0] = {
    field,
    loginContext: hasLoginContext(field),
  };
  const observation = pageInputObservation(observationRequest);
  try {
    return authentication_username_evidence(observation);
  } finally {
    observation.free();
  }
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
}: PasswordFieldQuery): HTMLInputElement[] {
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
}: PasswordFieldQuery): HTMLInputElement[] {
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

function fieldHasOneTimeCodeAutoSubmitHandler(
  field: HTMLInputElement,
): boolean {
  return ["oninput", "onchange"].some((attribute) => {
    const handler = field.getAttribute(attribute);
    return (
      typeof handler === "string" &&
      looks_like_one_time_code_auto_submit_signal(`${attribute}=${handler}`)
    );
  });
}

type OneTimeCodeFieldList = HTMLInputElement[];

export function preferredOneTimeCodeFillField(
  fields: OneTimeCodeFieldList,
): HTMLInputElement | false {
  const preferred = fields.find(fieldHasOneTimeCodeAutoSubmitHandler);
  return preferred ? preferred : (fields[0] ?? false);
}

export function hasAutocompleteToken({
  field,
  expected,
}: AutocompleteTokenMatchRequest): boolean {
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

export type PasskeyControlCandidate = {
  control: HTMLElement;
  explicitlyMarked: boolean;
};

const passkeyControlSelector =
  '[data-nook-passkey-control], button, a[href], [role="button"], input[type="button"], input[type="submit"]';

export function findPasskeyControls(
  root: ParentNode = document,
): PasskeyControlCandidate[] {
  const descendants = Array.from(
    root.querySelectorAll?.<HTMLElement>(passkeyControlSelector) ?? [],
  );
  const rooted =
    root instanceof HTMLElement && root.matches(passkeyControlSelector)
      ? [root]
      : [];
  const controls = [...rooted, ...descendants];
  const candidates = controls.flatMap((control) => {
    const explicitlyMarked = control.hasAttribute("data-nook-passkey-control");
    const labeled = (
      control.textContent ??
      control.getAttribute("aria-label") ??
      control.getAttribute("title") ??
      (control as HTMLInputElement).value ??
      ""
    ).trim();
    return explicitlyMarked ||
      (labeled && looks_like_passkey_control_label(labeled))
      ? [{ control, explicitlyMarked }]
      : [];
  });
  return [
    ...candidates.filter((candidate) => candidate.explicitlyMarked),
    ...candidates.filter((candidate) => !candidate.explicitlyMarked),
  ];
}

export function findPasskeyControl(
  root: ParentNode = document,
): PasskeyControlLookup {
  // Inputs with a WebAuthn autocomplete token remain credential fields. Only
  // marked or labeled activatable elements count as passkey controls.
  const candidate = findPasskeyControls(root)[0];
  if (candidate)
    return { kind: PasskeyControlLookupKind.Found, control: candidate.control };
  return { kind: PasskeyControlLookupKind.Absent };
}

export function pageHasPasskeyControl(root: ParentNode = document): boolean {
  return findPasskeyControl(root).kind === PasskeyControlLookupKind.Found;
}

function localActivationControlLabel(control: Element): string {
  const value =
    control instanceof HTMLInputElement || control instanceof HTMLButtonElement
      ? control.value
      : "";
  return [
    control.textContent ?? "",
    control.getAttribute("aria-label") ?? "",
    control.getAttribute("title") ?? "",
    value,
  ]
    .join(" ")
    .trim();
}

function containerHasUnambiguousAuthenticationActivation(
  container: Element,
): boolean {
  return labeledTypeButtonActivationControls(container).length === 1;
}

function labeledTypeButtonActivationControls(container: Element): Element[] {
  return Array.from(
    container.querySelectorAll(
      'button[type="button"], input[type="button"], [role="button"]',
    ),
  ).filter((control) =>
    looks_like_login_advance_control_label(
      localActivationControlLabel(control),
    ),
  );
}

function unownedCredentialFieldCount(root: ParentNode): number {
  return Array.from(
    root.querySelectorAll<HTMLInputElement>(
      'input[type="password"], input[autocomplete~="username" i], input[autocomplete~="email" i], input[autocomplete~="one-time-code" i]',
    ),
  ).filter((field) => !field.form && isRenderedInput(field)).length;
}

function typeButtonPromotionSwallowsForeignScope({
  container,
  field,
}: TypeButtonPromotionScopeRequest): boolean {
  const [activation] = labeledTypeButtonActivationControls(container);
  if (!activation) return false;
  let scope = activation.parentElement;
  while (scope && container.contains(scope)) {
    if (unownedCredentialFieldCount(scope) > 0 && !scope.contains(field)) {
      return true;
    }
    if (scope === container) break;
    scope = scope.parentElement;
  }
  return false;
}

export function nearestUnownedAuthContainer({
  field,
  root,
}: UnownedAuthContainerRequest): ParentNode {
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
    if (explicitAuthContainer || hasSubmitControl) {
      return container;
    }
    const promotionRequest: TypeButtonPromotionScopeRequest = {
      container,
      field,
    };
    if (
      containerHasUnambiguousAuthenticationActivation(container) &&
      !typeButtonPromotionSwallowsForeignScope(promotionRequest)
    ) {
      return container;
    }
    container = container.parentElement;
  }
  const parent = field.parentElement;
  if (parent instanceof HTMLElement && parent !== root) {
    const parentPromotionRequest: TypeButtonPromotionScopeRequest = {
      container: parent,
      field,
    };
    if (!(
      containerHasUnambiguousAuthenticationActivation(parent) &&
      typeButtonPromotionSwallowsForeignScope(parentPromotionRequest)
    )) {
      return parent;
    }
  }
  return field;
}

export type LocalOwnedFormAdjacencyRequest = {
  control: HTMLElement;
  owner: HTMLFormElement;
};

export function isLocallyAdjacentToOwnedForm({
  control,
  owner,
}: LocalOwnedFormAdjacencyRequest): boolean {
  const containingForm = control.closest("form");
  if (containingForm && containingForm !== owner) {
    return false;
  }
  const panel = owner.parentElement;
  if (
    !panel ||
    panel === owner.ownerDocument.body ||
    panel === owner.ownerDocument.documentElement
  ) {
    return false;
  }
  if (
    (control instanceof HTMLButtonElement ||
      control instanceof HTMLInputElement) &&
    control.form
  ) {
    return false;
  }
  const formsInPanel = Array.from(panel.querySelectorAll("form"));
  return formsInPanel.length === 1 && formsInPanel[0] === owner
    ? panel.contains(control)
    : false;
}

export type ControlObservationAssociationRequest = {
  control: HTMLElement;
  formScope: PasswordFormScope;
  root: ParentNode;
};

export function controlAssociatesWithObservation({
  control,
  formScope,
}: ControlObservationAssociationRequest): boolean {
  if (formScope.kind === PasswordFormScopeKind.Owned) {
    const adjacencyRequest: LocalOwnedFormAdjacencyRequest = {
      control,
      owner: formScope.owner,
    };
    if (
      control instanceof HTMLButtonElement ||
      control instanceof HTMLInputElement
    ) {
      return (
        control.form === formScope.owner ||
        isLocallyAdjacentToOwnedForm(adjacencyRequest)
      );
    }
    return (
      formScope.owner.contains(control) ||
      isLocallyAdjacentToOwnedForm(adjacencyRequest)
    );
  }
  if (
    control instanceof HTMLButtonElement ||
    control instanceof HTMLInputElement
  ) {
    return !control.form;
  }
  return !control.closest("form");
}

export function localUnownedPasskeyContainer({
  field,
  root,
}: UnownedAuthContainerRequest): ParentNode {
  const documentRoot = field.ownerDocument;
  const nearestRequest: UnownedAuthContainerRequest = { field, root };
  const nearest = nearestUnownedAuthContainer(nearestRequest);
  if (
    nearest !== field &&
    nearest !== root &&
    nearest !== documentRoot.body &&
    nearest !== documentRoot.documentElement
  ) {
    return nearest;
  }
  const parent = field.parentElement;
  if (
    parent &&
    parent !== documentRoot.body &&
    parent !== documentRoot.documentElement
  ) {
    return parent;
  }
  return root;
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
