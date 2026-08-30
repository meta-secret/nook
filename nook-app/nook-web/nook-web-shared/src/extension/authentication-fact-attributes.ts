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
