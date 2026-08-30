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
  attributeFilter: [...authenticationFactAttributeFilter],
  childList: true,
  characterData: true,
  subtree: true,
} as const satisfies MutationObserverInit;

export const AUTHENTICATION_FACT_SCAN_DEBOUNCE_MS = 150;

const authenticationFactCharacterDataScopeSelector =
  'a, button, form, input, label, legend, select, textarea, [role="button"], [role="form"], [aria-label], [title]';

const authenticationFactLabelledControlSelector =
  'a[href][aria-labelledby], button[aria-labelledby], input[type="button"][aria-labelledby], input[type="image"][aria-labelledby], input[type="submit"][aria-labelledby], [role="button"][aria-labelledby]';

export type AuthenticationFactMutation = {
  type: MutationRecord["type"];
  target: Node;
};

function characterDataLabelsAuthenticationControl(element: Element): boolean {
  const referencedIds = new Set<string>();
  let labelElement: Element | false = element;
  while (labelElement) {
    if (labelElement.id) referencedIds.add(labelElement.id);
    labelElement = labelElement.parentElement ?? false;
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

export function authenticationFactMutationRequiresScan(
  mutation: AuthenticationFactMutation,
): boolean {
  if (mutation.type !== "characterData") return true;
  const node = mutation.target;
  const element =
    node instanceof Text
      ? node.parentElement
      : node instanceof Element
        ? node
        : false;
  return Boolean(
    element &&
    (element.closest(authenticationFactCharacterDataScopeSelector) ||
      characterDataLabelsAuthenticationControl(element)),
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
