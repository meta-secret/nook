import { companionWasmReady } from "./companion-ready";
import {
  authentication_username_evidence,
  NookLoginContextObservation,
  NookPageInputFieldObservation,
  has_login_context,
  looks_like_email_verification_body,
  looks_like_manual_checkpoint_label,
  looks_like_one_time_code_auto_submit_signal,
  looks_like_one_time_code_field,
  looks_like_passkey_control_label,
  looks_like_username_field,
  parse_page_input_type,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import type { AuthenticationUsernameEvidence } from "./nook-companion-wasm/nook_companion_wasm.js";

void companionWasmReady;

export enum PasswordFormScopeKind {
  Owned = "owned",
  LocallyScoped = "locally-scoped",
  Unowned = "unowned",
}

export type PasswordFormScope =
  | { kind: PasswordFormScopeKind.Owned; owner: HTMLFormElement }
  | { kind: PasswordFormScopeKind.LocallyScoped; owner: HTMLElement }
  | { kind: PasswordFormScopeKind.Unowned };

export type PasswordFieldQuery = {
  root?: ParentNode;
  formScope?: PasswordFormScope;
};

export type ManualCheckpointScopeQuery = {
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

export type AutocompleteTokenMatchRequest = {
  field: HTMLInputElement;
  expected: string;
};

function isBlockedByDisabledFieldset(control: HTMLElement): boolean {
  return Array.from(
    control.ownerDocument.querySelectorAll<HTMLFieldSetElement>(
      "fieldset[disabled]",
    ),
  ).some((fieldset) => {
    if (!fieldset.contains(control)) return false;
    const firstLegend = Array.from(fieldset.children).find(
      (child) => child instanceof HTMLLegendElement,
    );
    return !firstLegend || !firstLegend.contains(control);
  });
}

type InsetOffsetPixelsRequest = {
  offset: string;
  dimension: number;
};

type FullyClippedByBasicShapeRequest = {
  style: CSSStyleDeclaration;
  element: HTMLElement;
};

type ClipPoint = {
  x: number;
  y: number;
};

function insetOffsetPixels({
  offset,
  dimension,
}: InsetOffsetPixelsRequest): number {
  if (!offset) return Number.NaN;
  if (offset.endsWith("%")) {
    return (Number.parseFloat(offset) / 100) * dimension;
  }
  if (offset === "0" || offset.endsWith("px")) {
    return Number.parseFloat(offset);
  }
  return Number.NaN;
}

function isFullyClippedByInset({
  style,
  element,
}: FullyClippedByBasicShapeRequest): boolean {
  const match = /^inset\(([^)]*)\)/iu.exec(style.clipPath.trim());
  const offsetsText = (match?.[1] ?? "").split(
    /\s+round(?:\s+|$)/iu,
    1,
  )[0];
  const offsets = (offsetsText ?? "")
    .split(/\s+/u)
    .filter(Boolean);
  if (offsets.length === 0 || offsets.length > 4) return false;
  const edges =
    offsets.length === 1
      ? [offsets[0], offsets[0], offsets[0], offsets[0]]
      : offsets.length === 2
        ? [offsets[0], offsets[1], offsets[0], offsets[1]]
        : offsets.length === 3
          ? [offsets[0], offsets[1], offsets[2], offsets[1]]
          : offsets;
  const percentages = edges.map((edge) =>
    edge?.endsWith("%") ? Number.parseFloat(edge) : Number.NaN,
  );
  const top = percentages[0] ?? Number.NaN;
  const right = percentages[1] ?? Number.NaN;
  const bottom = percentages[2] ?? Number.NaN;
  const left = percentages[3] ?? Number.NaN;
  if (top + bottom >= 100 || right + left >= 100) return true;

  const bounds = element.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return false;
  const topRequest: InsetOffsetPixelsRequest = {
    offset: edges[0] ?? "",
    dimension: bounds.height,
  };
  const rightRequest: InsetOffsetPixelsRequest = {
    offset: edges[1] ?? "",
    dimension: bounds.width,
  };
  const bottomRequest: InsetOffsetPixelsRequest = {
    offset: edges[2] ?? "",
    dimension: bounds.height,
  };
  const leftRequest: InsetOffsetPixelsRequest = {
    offset: edges[3] ?? "",
    dimension: bounds.width,
  };
  const topPixels = insetOffsetPixels(topRequest);
  const rightPixels = insetOffsetPixels(rightRequest);
  const bottomPixels = insetOffsetPixels(bottomRequest);
  const leftPixels = insetOffsetPixels(leftRequest);
  return (
    (Number.isFinite(topPixels) &&
      Number.isFinite(bottomPixels) &&
      topPixels + bottomPixels >= bounds.height) ||
    (Number.isFinite(rightPixels) &&
      Number.isFinite(leftPixels) &&
      rightPixels + leftPixels >= bounds.width)
  );
}

function isZeroClipLength(value: string): boolean {
  return /^[-+]?0*(?:\.0+)?(?:[a-z]+|%)?$/iu.test(value.trim());
}

function isFullyClippedByNonInsetShape({
  style,
  element,
}: FullyClippedByBasicShapeRequest): boolean {
  const clipPath = style.clipPath.trim();
  const circle = /^circle\(\s*([^\s)]+)/iu.exec(clipPath);
  if (circle?.[1] && isZeroClipLength(circle[1])) return true;

  const ellipse = /^ellipse\(\s*([^\s)]+)\s+([^\s)]+)/iu.exec(clipPath);
  if (
    (ellipse?.[1] && isZeroClipLength(ellipse[1])) ||
    (ellipse?.[2] && isZeroClipLength(ellipse[2]))
  ) {
    return true;
  }

  const polygon = /^polygon\((.*)\)$/iu.exec(clipPath);
  if (!polygon?.[1]) return false;
  const bounds = element.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return false;
  const pointTexts = polygon[1]
    .split(",")
    .map((point) => point.trim())
    .filter((point) => point !== "evenodd" && point !== "nonzero");
  if (pointTexts.length < 3) return false;
  const points: ClipPoint[] = [];
  for (const pointText of pointTexts) {
    const coordinates = pointText.split(/\s+/u);
    if (coordinates.length !== 2) return false;
    const xRequest: InsetOffsetPixelsRequest = {
      offset: coordinates[0] ?? "",
      dimension: bounds.width,
    };
    const yRequest: InsetOffsetPixelsRequest = {
      offset: coordinates[1] ?? "",
      dimension: bounds.height,
    };
    const point: ClipPoint = {
      x: insetOffsetPixels(xRequest),
      y: insetOffsetPixels(yRequest),
    };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
    points.push(point);
  }
  let twiceArea = 0;
  for (const [index, point] of points.entries()) {
    const nextPoint = points[(index + 1) % points.length];
    if (!nextPoint) return false;
    twiceArea += point.x * nextPoint.y - nextPoint.x * point.y;
  }
  return Math.abs(twiceArea) <= Number.EPSILON;
}

const CLIPPING_OVERFLOW_VALUES = new Set(["auto", "clip", "hidden", "scroll"]);

enum RenderedControlIntersectionKind {
  Absent = "absent",
  Present = "present",
}

type RenderedControlIntersection =
  | { kind: RenderedControlIntersectionKind.Absent }
  | {
      kind: RenderedControlIntersectionKind.Present;
      left: number;
      right: number;
      top: number;
      bottom: number;
    };

type PositiveRenderedControlIntersection = Extract<
  RenderedControlIntersection,
  { kind: RenderedControlIntersectionKind.Present }
>;

function renderedControlIntersection(
  control: HTMLElement,
): RenderedControlIntersection {
  const view = control.ownerDocument.defaultView;
  if (!view) return { kind: RenderedControlIntersectionKind.Absent };
  const bounds = control.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) {
    return { kind: RenderedControlIntersectionKind.Absent };
  }
  let visibleLeft = Math.max(bounds.left, 0);
  let visibleRight = Math.min(bounds.right, view.innerWidth);
  let visibleTop = Math.max(bounds.top, 0);
  let visibleBottom = Math.min(bounds.bottom, view.innerHeight);
  if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) {
    return { kind: RenderedControlIntersectionKind.Absent };
  }

  let ancestor = control.parentElement;
  while (ancestor) {
    const style = view.getComputedStyle(ancestor);
    const overflowX = style.overflowX || style.overflow;
    const overflowY = style.overflowY || style.overflow;
    const clipsX = CLIPPING_OVERFLOW_VALUES.has(overflowX);
    const clipsY = CLIPPING_OVERFLOW_VALUES.has(overflowY);
    if (clipsX || clipsY) {
      const ancestorBounds = ancestor.getBoundingClientRect();
      if (clipsX) {
        visibleLeft = Math.max(visibleLeft, ancestorBounds.left);
        visibleRight = Math.min(visibleRight, ancestorBounds.right);
      }
      if (clipsY) {
        visibleTop = Math.max(visibleTop, ancestorBounds.top);
        visibleBottom = Math.min(visibleBottom, ancestorBounds.bottom);
      }
      if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) {
        return { kind: RenderedControlIntersectionKind.Absent };
      }
    }
    ancestor = ancestor.parentElement;
  }
  return {
    kind: RenderedControlIntersectionKind.Present,
    left: visibleLeft,
    right: visibleRight,
    top: visibleTop,
    bottom: visibleBottom,
  };
}

type ExposedHitTargetRequest = {
  control: HTMLElement;
  intersection: PositiveRenderedControlIntersection;
};

const MAX_OCCLUSION_HIT_TEST_SAMPLES = 256;

function hasExposedHitTarget({
  control,
  intersection,
}: ExposedHitTargetRequest): boolean {
  const hitTest = control.ownerDocument.elementFromPoint;
  if (typeof hitTest !== "function") return true;
  const horizontalInset = Math.min(1, (intersection.right - intersection.left) / 4);
  const verticalInset = Math.min(1, (intersection.bottom - intersection.top) / 4);
  const left = intersection.left + horizontalInset;
  const right = intersection.right - horizontalInset;
  const top = intersection.top + verticalInset;
  const bottom = intersection.bottom - verticalInset;
  const centerX = (intersection.left + intersection.right) / 2;
  const centerY = (intersection.top + intersection.bottom) / 2;
  const samplePoints = [
    [centerX, centerY],
    [left, top],
    [right, top],
    [left, bottom],
    [right, bottom],
    [centerX, top],
    [centerX, bottom],
    [left, centerY],
    [right, centerY],
  ] as const;
  let hitTestObserved = false;
  for (const [x, y] of samplePoints) {
    const target = hitTest.call(control.ownerDocument, x, y);
    if (!target) continue;
    hitTestObserved = true;
    if (target === control || control.contains(target)) return true;
  }
  if (!hitTestObserved) return true;

  // Bound the fallback grid so a host page cannot turn one scan into millions
  // of synchronous hit tests. Edge midpoints above preserve the explicit
  // partial-overlay case; this grid broadens coverage without scaling by area.
  const width = intersection.right - intersection.left;
  const height = intersection.bottom - intersection.top;
  const aspectRatio = width / height;
  const columns = Math.max(
    1,
    Math.floor(Math.sqrt(MAX_OCCLUSION_HIT_TEST_SAMPLES * aspectRatio)),
  );
  const rows = Math.max(
    1,
    Math.floor(MAX_OCCLUSION_HIT_TEST_SAMPLES / columns),
  );
  const horizontalStep = width / columns;
  const verticalStep = height / rows;
  for (let row = 0; row < rows; row += 1) {
    const y = intersection.top + verticalStep * (row + 0.5);
    for (let column = 0; column < columns; column += 1) {
      const x = intersection.left + horizontalStep * (column + 0.5);
      const target = hitTest.call(control.ownerDocument, x, y);
      if (target === control || (target && control.contains(target))) return true;
    }
  }
  return false;
}

/** Apply browser actionability semantics to a control observed from page DOM. */
export function isActionablePageControl(control: HTMLElement): boolean {
  const customRoleButton =
    control.getAttribute("role") === "button" &&
    !(control instanceof HTMLButtonElement) &&
    !(control instanceof HTMLInputElement);
  if (
    control.matches(":disabled") ||
    Boolean(control.closest('[aria-disabled="true"]')) ||
    isBlockedByDisabledFieldset(control) ||
    Boolean(control.closest("[inert]")) ||
    control.getAttribute("aria-hidden") === "true" ||
    (customRoleButton && control.tabIndex < 0)
  ) {
    return false;
  }
  const renderedIntersection = renderedControlIntersection(control);
  if (renderedIntersection.kind === RenderedControlIntersectionKind.Absent) {
    return false;
  }
  let element = control;
  while (true) {
    const view = element.ownerDocument.defaultView;
    if (!view) return false;
    const style = view.getComputedStyle(element);
    const clippingRequest: FullyClippedByBasicShapeRequest = {
      style,
      element,
    };
    if (
      element.hidden ||
      style.display === "none" ||
      (element === control &&
        (style.visibility === "hidden" || style.visibility === "collapse")) ||
      style.contentVisibility === "hidden" ||
      (element === control && style.pointerEvents === "none") ||
      isFullyClippedByInset(clippingRequest) ||
      isFullyClippedByNonInsetShape(clippingRequest) ||
      Number.parseFloat(style.opacity) === 0
    ) {
      return false;
    }
    const parent = element.parentElement;
    if (!parent) {
      const hitTargetRequest: ExposedHitTargetRequest = {
        control,
        intersection: renderedIntersection,
      };
      return hasExposedHitTarget(hitTargetRequest);
    }
    element = parent;
  }
}

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
  if (!isActionablePageControl(field)) return false;
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
}: ScopedInputFieldQuery): HTMLInputElement[] {
  const queryRoot =
    formScope?.kind === PasswordFormScopeKind.Owned
      ? formScope.owner.ownerDocument
      : root;
  return Array.from(
    queryRoot.querySelectorAll<HTMLInputElement>(selector),
  ).filter((field) =>
    !formScope
      ? true
      : formScope.kind === PasswordFormScopeKind.Owned
        ? field.form === formScope.owner
        : !field.form,
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

const ONE_TIME_CODE_AUTO_SUBMIT_ATTRIBUTES = [
  "data-auto-submit",
  "data-autosubmit",
  "data-submit-on-input",
  "onchange",
  "oninput",
] as const;

const MAX_ONE_TIME_CODE_AUTO_SUBMIT_SIGNAL_LENGTH = 1_024;

/** Report bounded raw DOM attributes for Rust-owned OTP progression policy. */
export function oneTimeCodeFieldHasAutoSubmitEvidence(
  field: HTMLInputElement,
): boolean {
  const sources: HTMLElement[] = [field];
  if (field.form) sources.push(field.form);
  const signal = sources
    .flatMap((source) =>
      ONE_TIME_CODE_AUTO_SUBMIT_ATTRIBUTES.flatMap((attribute) => {
        if (!source.hasAttribute(attribute)) return [];
        return [`${attribute}=${source.getAttribute(attribute) ?? ""}`];
      }),
    )
    .join("\n")
    .slice(0, MAX_ONE_TIME_CODE_AUTO_SUBMIT_SIGNAL_LENGTH);
  return looks_like_one_time_code_auto_submit_signal(signal);
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

export function authenticationUsernameEvidence(
  field: HTMLInputElement,
): AuthenticationUsernameEvidence {
  const observationArgs: Parameters<typeof pageInputObservation>[0] = {
    field,
    loginContext: hasLoginContext(field),
  };
  const observation = pageInputObservation(observationArgs);
  try {
    return authentication_username_evidence(observation);
  } finally {
    observation.free();
  }
}

export enum PasskeyControlLookupKind {
  Absent = "absent",
  Found = "found",
}

export type PasskeyControlLookup =
  | { kind: PasskeyControlLookupKind.Absent }
  | { kind: PasskeyControlLookupKind.Found; control: HTMLElement };

export type PasskeyControlScopeQuery = {
  root: ParentNode;
  formScope: PasswordFormScope;
};

export type PageControlFormScopeQuery = {
  control: HTMLElement;
  formScope: PasswordFormScope;
};

/** Collect the visible and referenced text that names an actionable page control. */
export function pageControlLabel(control: HTMLElement): string {
  const labelledByText: string[] = [];
  const labelledBy = control.getAttribute("aria-labelledby");
  if (labelledBy) {
    for (const id of labelledBy.split(/\s+/u).filter(Boolean)) {
      const label = control.ownerDocument.getElementById(id);
      if (label?.textContent) {
        labelledByText.push(label.textContent);
      }
    }
  }
  const referencedLabel = labelledByText.join(" ").trim();
  if (referencedLabel) return referencedLabel;
  const ariaLabel = control.getAttribute("aria-label")?.trim();
  if (ariaLabel) return ariaLabel;
  return [
    control.textContent ?? "",
    control.getAttribute("alt") ?? "",
    control.getAttribute("title") ?? "",
    control.getAttribute("value") ?? "",
  ].join(" ");
}

export function pageControlFormScope(control: HTMLElement): PasswordFormScope {
  const owner =
    control instanceof HTMLButtonElement || control instanceof HTMLInputElement
      ? control.form
      : control.closest("form");
  return owner
    ? { kind: PasswordFormScopeKind.Owned, owner }
    : { kind: PasswordFormScopeKind.Unowned };
}

export function pageControlBelongsToFormScope({
  control,
  formScope,
}: PageControlFormScopeQuery): boolean {
  const controlScope = pageControlFormScope(control);
  if (formScope.kind === PasswordFormScopeKind.Owned) {
    return (
      controlScope.kind === PasswordFormScopeKind.Owned &&
      controlScope.owner === formScope.owner
    );
  }
  if (formScope.kind === PasswordFormScopeKind.LocallyScoped) {
    return (
      controlScope.kind === PasswordFormScopeKind.Unowned &&
      formScope.owner.contains(control)
    );
  }
  return controlScope.kind === PasswordFormScopeKind.Unowned;
}

function passkeyControls(root: ParentNode): HTMLElement[] {
  const controls = Array.from(
    root.querySelectorAll?.<HTMLElement>(
      '[data-nook-passkey-control], button, a[href], [role="button"], input[type="button"], input[type="submit"]',
    ) ?? [],
  );
  return controls.filter((control) => {
    if (!isActionablePageControl(control)) return false;
    if (control.hasAttribute("data-nook-passkey-control")) return true;
    const label = pageControlLabel(control).trim();
    return Boolean(label && looks_like_passkey_control_label(label));
  });
}

export function findPasskeyControl(
  root: ParentNode = document,
): PasskeyControlLookup {
  // Inputs with a WebAuthn autocomplete token remain credential fields. Only
  // marked or labeled activatable elements count as passkey controls.
  const control = passkeyControls(root)[0];
  if (control) return { kind: PasskeyControlLookupKind.Found, control };
  return { kind: PasskeyControlLookupKind.Absent };
}

export function findPasskeyControlForScope({
  root,
  formScope,
}: PasskeyControlScopeQuery): PasskeyControlLookup {
  for (const control of passkeyControls(root)) {
    const scopeQuery: PageControlFormScopeQuery = { control, formScope };
    if (pageControlBelongsToFormScope(scopeQuery)) {
      return { kind: PasskeyControlLookupKind.Found, control };
    }
  }
  return { kind: PasskeyControlLookupKind.Absent };
}

export function pageHasPasskeyControl(root: ParentNode = document): boolean {
  return findPasskeyControl(root).kind === PasskeyControlLookupKind.Found;
}

export function pageHasPasskeyControlForScope(
  request: PasskeyControlScopeQuery,
): boolean {
  return (
    findPasskeyControlForScope(request).kind === PasskeyControlLookupKind.Found
  );
}

export function pageHasManualCheckpoint(root: ParentNode): boolean {
  const explicitCheckpoints = Array.from(
    root.querySelectorAll<HTMLElement>(
      'iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i], iframe[src*="turnstile" i], iframe[title*="captcha" i], [data-nook-manual-checkpoint]',
    ),
  );
  if (explicitCheckpoints.some(isActionablePageControl)) {
    return true;
  }
  const checkboxes = Array.from(
    root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  );
  for (const checkbox of checkboxes) {
    if (!isActionablePageControl(checkbox)) continue;
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
  const checkpointTextElements = Array.from(
    root.querySelectorAll<HTMLElement>(
      'p, h1, h2, h3, h4, legend, [role="alert"], [role="status"], [role="dialog"]',
    ),
  );
  return checkpointTextElements.some(
    (element) =>
      isActionablePageControl(element) &&
      looks_like_email_verification_body(element.textContent ?? ""),
  );
}

/** Report manual-checkpoint evidence only inside the observed ceremony. */
export function pageHasManualCheckpointForScope({
  root,
  formScope,
}: ManualCheckpointScopeQuery): boolean {
  if (formScope.kind === PasswordFormScopeKind.Unowned) return false;
  const scopeRoot = formScope.owner;
  if (pageHasManualCheckpoint(scopeRoot)) return true;
  if (formScope.kind !== PasswordFormScopeKind.Owned) return false;
  return Array.from(
    root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  )
    .filter((checkbox) => checkbox.form === formScope.owner)
    .some((checkbox) => {
      const label =
        checkbox.labels?.[0]?.textContent ??
        checkbox.getAttribute("aria-label") ??
        checkbox.name ??
        checkbox.id ??
        "";
      return looks_like_manual_checkpoint_label(label.toLowerCase());
    });
}
