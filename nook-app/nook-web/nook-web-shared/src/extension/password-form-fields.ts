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
import { containerHasAuthenticationIdentity } from "./password-form-container-identity";
import { ownedAuthenticationFields } from "./password-form-owned-field-index";

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

type OwnedObservationBoundsRequest = {
  root: ParentNode;
  formScope: PasswordFormScope;
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

export type LocalOwnedLoginObservationRootRequest = {
  owner: HTMLFormElement;
  passwordFields: readonly HTMLInputElement[];
  usernameFields: readonly HTMLInputElement[];
  oneTimeCodeFields: readonly HTMLInputElement[];
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

export function localOwnedLoginObservationRoot({
  owner,
  passwordFields,
  usernameFields,
  oneTimeCodeFields,
}: LocalOwnedLoginObservationRootRequest): ParentNode {
  const ownedFieldsRequest: Parameters<typeof ownedAuthenticationFields>[0] = {
    owner,
    passwordFields,
    usernameFields,
    oneTimeCodeFields,
  };
  const {
    passwordFields: ownedPasswordFields,
    usernameFields: ownedUsernameFields,
    oneTimeCodeFields: ownedOneTimeCodeFields,
  } = ownedAuthenticationFields(ownedFieldsRequest);
  const [passwordField] = ownedPasswordFields;
  const [usernameField] = ownedUsernameFields;
  if (
    ownedPasswordFields.length !== 1 ||
    ownedUsernameFields.length !== 1 ||
    ownedOneTimeCodeFields.length > 0 ||
    !passwordField ||
    !usernameField
  ) {
    return owner.ownerDocument;
  }
  const currentPasswordTokenRequest: AutocompleteTokenMatchRequest = {
    field: passwordField,
    expected: "current-password",
  };
  if (!hasAutocompleteToken(currentPasswordTokenRequest)) {
    return owner.ownerDocument;
  }
  let container = passwordField.parentElement;
  while (container && container !== owner) {
    if (container.contains(usernameField)) {
      if (!owner.contains(container)) return owner.ownerDocument;
      if (!containerLooksLikeExplicitAuthSurface(container)) {
        container = container.parentElement;
        continue;
      }
      if (
        ownedFormHasManualCheckpoint(owner) &&
        !pageHasManualCheckpoint(container)
      ) {
        return owner.ownerDocument;
      }
      return container;
    }
    container = container.parentElement;
  }
  return owner.ownerDocument;
}

export function ownedObservationIsLocallyBounded({
  root,
  formScope,
}: OwnedObservationBoundsRequest): boolean {
  return (
    formScope.kind === PasswordFormScopeKind.Owned &&
    root !== formScope.owner &&
    root !== formScope.owner.ownerDocument
  );
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
      if (
        field.form === owner &&
        (root === owner.ownerDocument ||
          (root instanceof Node && root.contains(field)))
      ) {
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
        if (
          !seen.has(field) &&
          field.form === owner &&
          (root === owner.ownerDocument ||
            (root instanceof Node && root.contains(field)))
        ) {
          seen.add(field);
          fields.push(field);
        }
      }
    }
    fields.sort((...pair) => {
      const left = pair[0];
      const right = pair[1];
      if (left === right) return 0;
      return left.compareDocumentPosition(right) &
        Node.DOCUMENT_POSITION_FOLLOWING
        ? -1
        : 1;
    });
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
      !inputIsEffectivelyDisabled(field) &&
      field.type === "password" &&
      isRenderedInput(field),
  );
}

function inputIsEffectivelyDisabled(field: HTMLInputElement): boolean {
  if (field.disabled || field.matches(":disabled")) return true;
  for (
    let ancestor = field.parentElement;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    if (!(ancestor instanceof HTMLFieldSetElement) || !ancestor.disabled) {
      continue;
    }
    const firstLegend = Array.from(ancestor.children).find(
      (child): child is HTMLLegendElement => child instanceof HTMLLegendElement,
    );
    if (!firstLegend?.contains(field)) return true;
  }
  return false;
}

function associatedLabelText(field: HTMLInputElement): string {
  const parts: string[] = [];
  if (field.labels) {
    for (const label of field.labels) {
      parts.push(((v) => (v ? v : ""))(label.textContent));
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
  return field.id.toLowerCase() === "user" ||
    /username|email|login|account|identifier|otp|totp|mfa|2fa|one-?time|verif/i.test(
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
    ((v) => (v ? v : ""))(field.getAttribute("aria-label")),
    ((v) => (v ? v : ""))(field.getAttribute("autocomplete")),
    ((v) => (v ? v : ""))(field.getAttribute("data-qa")),
    ((v) => (v ? v : ""))(field.getAttribute("data-testid")),
    associatedLabelText(field),
  ].join(" ");
}

function autocompleteTokens(field: HTMLInputElement): string[] {
  return ((v) => (v ? v : ""))(field.getAttribute("autocomplete"))
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

const loginAdvanceControlSelector =
  'button[type="submit"], input[type="submit"], button:not([type]), button[type="button"], input[type="button"]';

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
        ((v) => (v ? v : ""))(container.getAttribute("role")),
      ].join(" "),
    );
    container = container.parentElement;
    depth += 1;
  }
  const advanceControls = form
    ? Array.from(
        form.ownerDocument.querySelectorAll<HTMLElement>(
          loginAdvanceControlSelector,
        ),
      ).filter(
        (control) =>
          (control instanceof HTMLButtonElement ||
            control instanceof HTMLInputElement) &&
          control.form === form,
      )
    : field.parentElement
      ? Array.from(
          field.parentElement.querySelectorAll<HTMLElement>(
            loginAdvanceControlSelector,
          ),
        )
      : [];
  const advanceControlLabels = advanceControls.map((control) =>
    [
      ((v) => (v ? v : ""))(control.textContent),
      ((v) => (v ? v : ""))(control.getAttribute("aria-label")),
      ((v) => (v ? v : ""))(control.getAttribute("title")),
      control instanceof HTMLInputElement ? control.value : "",
    ].join(" "),
  );
  const [authenticationAdvanceControlLabel = advanceControlLabels.join(" ")] = [
    advanceControlLabels.find((label) =>
      looks_like_login_advance_control_label(label),
    ),
  ];
  const doc = field.ownerDocument;
  const observation = new NookLoginContextObservation(
    form
      ? [
          form.id,
          form.className,
          ((v) => (v ? v : ""))(form.getAttribute("action")),
          form.name,
        ].join(" ")
      : "",
    ancestorIdentities,
    authenticationAdvanceControlLabel,
    `${((v) => (v ? v : ""))(doc.defaultView?.location?.pathname)} ${((v) => (v ? v : ""))(doc.defaultView?.location?.hostname)}`,
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
  return preferred ? preferred : ((v) => (v ? v : false))(fields[0]);
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
    ((v) => (v ? v : []))(
      root.querySelectorAll?.<HTMLElement>(passkeyControlSelector),
    ),
  );
  const rooted =
    root instanceof HTMLElement && root.matches(passkeyControlSelector)
      ? [root]
      : [];
  const controls = [...rooted, ...descendants];
  const candidates = controls.flatMap((control) => {
    const explicitlyMarked = control.hasAttribute("data-nook-passkey-control");
    const labeled = localActivationControlLabel(control);
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
  const labelledBy = ((v) => (v ? v : ""))(
    control.getAttribute("aria-labelledby"),
  )
    .split(/\s+/u)
    .filter(Boolean)
    .flatMap((id) => {
      const label = control.ownerDocument.getElementById(id);
      return label ? [((v) => (v ? v : ""))(label.textContent)] : [];
    })
    .join(" ");
  const value =
    control instanceof HTMLInputElement || control instanceof HTMLButtonElement
      ? control.value
      : "";
  return [
    ((v) => (v ? v : ""))(control.textContent),
    ((v) => (v ? v : ""))(control.getAttribute("aria-label")),
    ((v) => (v ? v : ""))(control.getAttribute("title")),
    ((v) => (v ? v : ""))(control.getAttribute("alt")),
    value,
    labelledBy,
  ]
    .join(" ")
    .trim();
}

const formlessTypeButtonSelector =
  'button[type="button"], input[type="button"], [role="button"]';

function containerHasGenericTypeButtonControls(container: Element): boolean {
  return Array.from(
    container.querySelectorAll(formlessTypeButtonSelector),
  ).some(
    (control) =>
      !looks_like_login_advance_control_label(
        localActivationControlLabel(control),
      ),
  );
}

function containerHasUnambiguousAuthenticationActivation(
  container: Element,
): boolean {
  return labeledTypeButtonActivationControls(container).length === 1;
}

function labeledTypeButtonActivationControls(container: Element): Element[] {
  return Array.from(
    container.querySelectorAll(formlessTypeButtonSelector),
  ).filter((control) =>
    looks_like_login_advance_control_label(
      localActivationControlLabel(control),
    ),
  );
}

function containerIsDocumentShell(container: Element): boolean {
  return container === container.ownerDocument.documentElement;
}

function unownedCredentialFields(root: ParentNode): HTMLInputElement[] {
  return Array.from(
    root.querySelectorAll<HTMLInputElement>(
      'input[type="password"], input[autocomplete~="username" i], input[autocomplete~="email" i], input[autocomplete~="one-time-code" i]',
    ),
  ).filter((field) => !field.form && isRenderedInput(field));
}

function containerHasUnownedCredentialCluster(container: Element): boolean {
  const fields = unownedCredentialFields(container);
  const passwords = fields.filter((field) => field.type === "password").length;
  const otps = fields.filter((field) => {
    const tokenRequest: AutocompleteTokenMatchRequest = {
      field,
      expected: "one-time-code",
    };
    return hasAutocompleteToken(tokenRequest);
  }).length;
  const usernames = fields.length - passwords - otps;
  return otps > 0 || (usernames > 0 && passwords > 0);
}

function containerHasSemanticSubmitControl(container: Element): boolean {
  return Boolean(
    container.querySelector(
      'button[type="submit"], input[type="submit"], button:not([type])',
    ),
  );
}

function containerLooksLikeExplicitAuthSurface(container: Element): boolean {
  if (container.matches('dialog, [role="dialog"], [role="form"]')) return true;
  return containerHasAuthenticationIdentity(container);
}

function containerIsFormlessAuthenticationScope({
  container,
  field,
}: TypeButtonPromotionScopeRequest): boolean {
  if (containerIsDocumentShell(container)) return false;
  if (containerHasSemanticSubmitControl(container)) return true;
  const promotionRequest: TypeButtonPromotionScopeRequest = {
    container,
    field,
  };
  if (
    containerHasUnambiguousAuthenticationActivation(container) &&
    !typeButtonPromotionSwallowsForeignScope(promotionRequest)
  ) {
    return true;
  }
  if (
    containerLooksLikeExplicitAuthSurface(container) &&
    !containerHasGenericTypeButtonControls(container)
  ) {
    return true;
  }
  return (
    containerHasUnownedCredentialCluster(container) &&
    !containerHasGenericTypeButtonControls(container) &&
    !typeButtonPromotionSwallowsForeignScope(promotionRequest)
  );
}

function unownedCredentialFieldCount(root: ParentNode): number {
  return unownedCredentialFields(root).length;
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
    const scopeRequest: TypeButtonPromotionScopeRequest = {
      container,
      field,
    };
    if (containerIsFormlessAuthenticationScope(scopeRequest)) {
      return container;
    }
    container = container.parentElement;
  }
  const parent = field.parentElement;
  if (parent instanceof HTMLElement && parent !== root) {
    const parentScopeRequest: TypeButtonPromotionScopeRequest = {
      container: parent,
      field,
    };
    if (containerIsFormlessAuthenticationScope(parentScopeRequest)) {
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
  const doc = ((v) => (v ? v : document))(root.ownerDocument);
  if (
    doc.querySelector(
      'iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i], iframe[src*="turnstile" i], iframe[title*="captcha" i], [data-nook-manual-checkpoint]',
    )
  ) {
    return true;
  }
  if (
    Array.from(
      root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ).some(checkboxHasManualCheckpoint)
  )
    return true;
  return looks_like_email_verification_body(
    ((v) => (v ? v : ""))(root.textContent),
  );
}

function checkboxHasManualCheckpoint(checkbox: HTMLInputElement): boolean {
  const label = checkbox.labels?.[0];
  const ariaLabel = checkbox.attributes.getNamedItem("aria-label");
  const labeled = label
    ? ((v) => (v ? v : ""))(label.textContent)
    : ariaLabel
      ? ariaLabel.value
      : checkbox.name;
  return looks_like_manual_checkpoint_label(labeled.toLowerCase());
}

function ownedFormHasManualCheckpoint(owner: HTMLFormElement): boolean {
  const fieldQuery: ScopedInputFieldQuery = {
    root: owner.ownerDocument,
    selector: 'input[type="checkbox"]',
    formScope: { kind: PasswordFormScopeKind.Owned, owner },
  };
  return (
    pageHasManualCheckpoint(owner) ||
    findFields(fieldQuery).some(checkboxHasManualCheckpoint)
  );
}
