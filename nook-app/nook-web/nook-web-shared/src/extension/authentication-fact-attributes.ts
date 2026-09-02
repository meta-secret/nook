export const authenticationFactAttributeFilter = [
  "action",
  "alt",
  "aria-disabled",
  "aria-hidden",
  "aria-label",
  "aria-labelledby",
  "autocomplete",
  "class",
  "data-nook-manual-checkpoint",
  "data-nook-passkey-control",
  "data-qa",
  "data-testid",
  "disabled",
  "for",
  "form",
  "formaction",
  "formmethod",
  "hidden",
  "href",
  "id",
  "inert",
  "method",
  "name",
  "onchange",
  "oninput",
  "open",
  "placeholder",
  "readonly",
  "role",
  "src",
  "style",
  "title",
  "type",
  "value",
] as const;

export const authenticationFactObserverOptions = {
  attributes: true,
  attributeOldValue: true,
  attributeFilter: [...authenticationFactAttributeFilter],
  childList: true,
  characterData: true,
  subtree: true,
} as const satisfies MutationObserverInit;

export const AUTHENTICATION_FACT_SCAN_DEBOUNCE_MS = 150;

const authenticationFactCharacterDataScopeSelector =
  'a, button, form, h1, h2, h3, h4, h5, h6, input, label, legend, p, select, textarea, [role="button"], [role="form"], [role="heading"], [aria-label], [title], [data-nook-passkey-control]';

const authenticationFactLabelledControlSelector =
  'a[href][aria-labelledby], button[aria-labelledby], input[type="button"][aria-labelledby], input[type="image"][aria-labelledby], input[type="submit"][aria-labelledby], [role="button"][aria-labelledby], [data-nook-passkey-control][aria-labelledby]';

const authenticationFactElementSelector =
  'a, button, form, h1, h2, h3, h4, h5, h6, iframe, input, label, legend, p, select, textarea, [role="button"], [role="form"], [role="heading"], [data-nook-manual-checkpoint], [data-nook-passkey-control]';

const authenticationFactNestedScopeSelector =
  'a, button, input, label, legend, select, textarea, [role="button"], [data-nook-passkey-control]';

export type AuthenticationFactMutation = {
  type: MutationRecord["type"];
  target: Node;
  attributeName?: MutationRecord["attributeName"];
  oldValue?: MutationRecord["oldValue"];
};

type LabelledAuthenticationControlDependency = {
  element: Element;
  previousId: string | false;
};

function elementLabelsAuthenticationControl({
  element,
  previousId,
}: LabelledAuthenticationControlDependency): boolean {
  const referencedIds = new Set<string>();
  if (previousId) referencedIds.add(previousId);
  let labelElement: Element | false = element;
  while (labelElement) {
    if (labelElement.id) referencedIds.add(labelElement.id);
    labelElement = labelElement.parentElement ?? false;
  }
  for (const labelledDescendant of element.querySelectorAll<HTMLElement>(
    "[id]",
  )) {
    referencedIds.add(labelledDescendant.id);
  }
  if (referencedIds.size === 0) return false;
  return Array.from(
    element.ownerDocument.querySelectorAll<HTMLElement>(
      authenticationFactLabelledControlSelector,
    ),
  ).some((control) =>
    (control.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/u)
      .some((id) => referencedIds.has(id)),
  );
}

export function authenticationFactMutationTouchesLabelDependency(
  mutation: MutationRecord,
): boolean {
  const elements = new Set<Element>();
  const includeNode = (node: Node): void => {
    if (node instanceof Element) elements.add(node);
    if (node.parentElement) elements.add(node.parentElement);
  };
  includeNode(mutation.target);
  if (mutation.type === "childList") {
    for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
      includeNode(node);
    }
  }
  const previousId =
    mutation.type === "attributes" &&
    mutation.attributeName === "id" &&
    mutation.oldValue
      ? mutation.oldValue
      : false;
  return [...elements].some((element) => {
    const dependency: LabelledAuthenticationControlDependency = {
      element,
      previousId,
    };
    return elementLabelsAuthenticationControl(dependency);
  });
}

function attributeTargetCanAffectAuthenticationFacts(
  mutation: AuthenticationFactMutation,
): boolean {
  const element = mutation.target instanceof Element ? mutation.target : false;
  if (!element) return false;
  if (
    mutation.attributeName === "data-nook-manual-checkpoint" ||
    mutation.attributeName === "data-nook-passkey-control" ||
    (mutation.attributeName === "role" &&
      (mutation.oldValue === "button" || mutation.oldValue === "form"))
  ) {
    return true;
  }
  if (
    element.matches(authenticationFactElementSelector) ||
    element.closest(authenticationFactNestedScopeSelector) ||
    element.querySelector(authenticationFactElementSelector)
  ) {
    return true;
  }
  const previousId =
    mutation.attributeName === "id" && mutation.oldValue
      ? mutation.oldValue
      : false;
  const dependency: LabelledAuthenticationControlDependency = {
    element,
    previousId,
  };
  return elementLabelsAuthenticationControl(dependency);
}

export function authenticationFactMutationRequiresScan(
  mutation: AuthenticationFactMutation,
): boolean {
  if (mutation.type === "attributes") {
    return attributeTargetCanAffectAuthenticationFacts(mutation);
  }
  if (mutation.type !== "characterData") return true;
  const node = mutation.target;
  const element =
    node instanceof Text
      ? node.parentElement
      : node instanceof Element
        ? node
        : false;
  if (!element) return false;
  const dependency: LabelledAuthenticationControlDependency = {
    element,
    previousId: false,
  };
  return Boolean(
    element.closest(authenticationFactCharacterDataScopeSelector) ||
    elementLabelsAuthenticationControl(dependency),
  );
}

export const AUTHENTICATION_SUBMIT_VALUE_SOURCE =
  "nook-authentication-submit-value-v1";

export function notifyAuthenticationSubmitValueAssigned(): void {
  const targetOrigin = location.origin;
  if (targetOrigin === "null") return;
  const message: Parameters<typeof window.postMessage>[0] = {
    source: AUTHENTICATION_SUBMIT_VALUE_SOURCE,
  };
  window.postMessage(message, targetOrigin);
}

export function isAuthenticationSubmitValueMessage(
  event: MessageEvent,
): boolean {
  if (
    location.origin === "null" ||
    event.origin === "null" ||
    event.origin !== location.origin ||
    event.source !== window
  ) {
    return false;
  }
  const data = event.data;
  return (
    typeof data === "object" &&
    Boolean(data) &&
    data.source === AUTHENTICATION_SUBMIT_VALUE_SOURCE
  );
}

export function observeAuthenticationSubmitValueAssignments(
  onChange: () => void,
): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  );
  if (!descriptor || !descriptor.get || !descriptor.set) {
    return () => {};
  }
  const originalGet = descriptor.get;
  const originalSet = descriptor.set;
  const valueProperty: PropertyDescriptor = {
    configurable: true,
    enumerable: descriptor.enumerable,
    get() {
      return originalGet.call(this);
    },
    set(next: string) {
      const input = this as HTMLInputElement;
      const previous = originalGet.call(input);
      originalSet.call(input, next);
      if (
        previous !== next &&
        (input.type === "submit" ||
          input.type === "image" ||
          input.type === "button")
      ) {
        onChange();
      }
    },
  };
  Object.defineProperty(HTMLInputElement.prototype, "value", valueProperty);
  return () => {
    Object.defineProperty(HTMLInputElement.prototype, "value", descriptor);
  };
}
