/** Owns browser observations shared by the concrete authentication interaction. */
export class AuthenticationInputSurface {
  constructor(protected readonly browser: typeof globalThis) {}
  protected isRenderedInput(field: HTMLInputElement): boolean {
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
      const style =
        element.ownerDocument.defaultView?.getComputedStyle(element);
      if (style?.display === "none" || style?.visibility === "hidden") {
        return false;
      }
      const parent = element.parentElement;
      if (!parent) break;
      element = parent;
    }
    return true;
  }

  protected inputIsEffectivelyDisabled(field: HTMLInputElement): boolean {
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
        (child): child is HTMLLegendElement =>
          child instanceof HTMLLegendElement,
      );
      if (!firstLegend?.contains(field)) return true;
    }
    return false;
  }

  protected associatedLabelText(field: HTMLInputElement): string {
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

  protected fieldIdentityId(field: HTMLInputElement): string {
    return field.id.toLowerCase() === "user" ||
      /username|email|login|account|identifier|otp|totp|mfa|2fa|one-?time|verif/i.test(
        field.id,
      )
      ? field.id
      : "";
  }

  protected rawFieldIdentityText(field: HTMLInputElement): string {
    return [
      field.name,
      this.fieldIdentityId(field),
      field.placeholder,
      field.title,
      ((v) => (v ? v : ""))(field.getAttribute("aria-label")),
      ((v) => (v ? v : ""))(field.getAttribute("autocomplete")),
      ((v) => (v ? v : ""))(field.getAttribute("data-qa")),
      ((v) => (v ? v : ""))(field.getAttribute("data-testid")),
      this.associatedLabelText(field),
    ].join(" ");
  }

  protected autocompleteTokens(field: HTMLInputElement): string[] {
    return ((v) => (v ? v : ""))(field.getAttribute("autocomplete"))
      .split(/\s+/u)
      .map((token) => token.trim())
      .filter(Boolean);
  }
}
