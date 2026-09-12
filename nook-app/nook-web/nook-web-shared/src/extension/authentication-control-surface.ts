/** Owns the host rendering and disabled-state observations shared by authentication controls. */
export class AuthenticationControlSurface {
  constructor(protected readonly browser: typeof globalThis) {}
  protected isDisabledByAncestorFieldset(control: HTMLElement): boolean {
    let ancestor = control.parentElement;
    while (ancestor) {
      if (
        ancestor instanceof HTMLFieldSetElement &&
        ancestor.hasAttribute("disabled")
      ) {
        const firstLegend = [...ancestor.children].find(
          (child) => child instanceof HTMLLegendElement,
        );
        if (!(
          firstLegend instanceof HTMLLegendElement &&
          firstLegend.contains(control)
        )) {
          return true;
        }
      }
      ancestor = ancestor.parentElement;
    }
    return false;
  }

  protected controlHasDisabledProperty(
    control: HTMLElement,
  ): control is
    | HTMLButtonElement
    | HTMLInputElement
    | HTMLSelectElement
    | HTMLTextAreaElement
    | HTMLFieldSetElement
    | HTMLOptionElement {
    return (
      control instanceof HTMLButtonElement ||
      control instanceof HTMLInputElement ||
      control instanceof HTMLSelectElement ||
      control instanceof HTMLTextAreaElement ||
      control instanceof HTMLFieldSetElement ||
      control instanceof HTMLOptionElement
    );
  }

  controlIsEffectivelyDisabled(control: HTMLElement): boolean {
    return (
      (this.controlHasDisabledProperty(control) && control.disabled) ||
      this.isDisabledByAncestorFieldset(control) ||
      control.getAttribute("aria-disabled") === "true" ||
      this.isDisabledByAncestorAria(control)
    );
  }

  protected isDisabledByAncestorAria(control: HTMLElement): boolean {
    let ancestor = control.parentElement;
    while (ancestor) {
      if (ancestor.getAttribute("aria-disabled") === "true") return true;
      ancestor = ancestor.parentElement;
    }
    return false;
  }

  controlIsInert(control: HTMLElement): boolean {
    return (
      this.controlIsEffectivelyDisabled(control) ||
      !this.isRenderedControl(control) ||
      control.hasAttribute("inert") ||
      control.inert
    );
  }

  isRenderedControl(control: HTMLElement): boolean {
    if (control.closest("dialog:not([open])")) return false;
    let element: HTMLElement = control;
    for (;;) {
      const style = this.browser.getComputedStyle(element);
      const rendered =
        style.display !== "none" && style.visibility !== "hidden";
      if (
        element.hidden ||
        element.hasAttribute("inert") ||
        element.inert ||
        element.getAttribute("aria-disabled") === "true" ||
        (element instanceof HTMLDialogElement && !element.open) ||
        !rendered
      ) {
        return false;
      }
      const parent = element.parentElement;
      if (!(parent instanceof HTMLElement)) return true;
      element = parent;
    }
  }
}
