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
  Object.defineProperty(HTMLInputElement.prototype, "value", {
    configurable: true,
    enumerable: descriptor.enumerable,
    get() {
      return originalGet.call(this);
    },
    set(next: string) {
      const previous = originalGet.call(this);
      originalSet.call(this, next);
      if (
        previous !== next &&
        (this.type === "submit" || this.type === "image")
      ) {
        onChange();
      }
    },
  });
  return () => {
    Object.defineProperty(HTMLInputElement.prototype, "value", descriptor);
  };
}
