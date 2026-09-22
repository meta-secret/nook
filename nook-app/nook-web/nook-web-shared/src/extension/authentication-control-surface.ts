/** Owns the host rendering and disabled-state observations shared by authentication controls. */
enum DisabledPropertyControlDecodeKind {
  Unsupported = "unsupported",
  Supported = "supported",
}

type DisabledPropertyControl =
  | HTMLButtonElement
  | HTMLInputElement
  | HTMLSelectElement
  | HTMLTextAreaElement
  | HTMLFieldSetElement
  | HTMLOptionElement;

type DisabledPropertyControlDecode =
  | { readonly kind: DisabledPropertyControlDecodeKind.Unsupported }
  | {
      readonly kind: DisabledPropertyControlDecodeKind.Supported;
      readonly control: DisabledPropertyControl;
    };

export class AuthenticationControlSurface {
  constructor(protected readonly browser: typeof globalThis) {}
  protected isDisabledByAncestorFieldset(control: HTMLElement): boolean {
    let ancestor = control.parentElement;
    while (ancestor) {
      const fieldSetElement =
        ancestor.ownerDocument.defaultView?.HTMLFieldSetElement;
      if (
        fieldSetElement &&
        ancestor instanceof fieldSetElement &&
        ancestor.hasAttribute("disabled")
      ) {
        const legendElement =
          ancestor.ownerDocument.defaultView?.HTMLLegendElement;
        const firstLegend = [...ancestor.children].find(
          (child) => legendElement && child instanceof legendElement,
        );
        if (!(firstLegend && firstLegend.contains(control))) {
          return true;
        }
      }
      ancestor = ancestor.parentElement;
    }
    return false;
  }

  protected decodeDisabledPropertyControl(
    control: HTMLElement,
  ): DisabledPropertyControlDecode {
    const view = control.ownerDocument.defaultView;
    const buttonElement = view?.HTMLButtonElement;
    if (buttonElement && control instanceof buttonElement)
      return { kind: DisabledPropertyControlDecodeKind.Supported, control };
    const inputElement = view?.HTMLInputElement;
    if (inputElement && control instanceof inputElement)
      return { kind: DisabledPropertyControlDecodeKind.Supported, control };
    const selectElement = view?.HTMLSelectElement;
    if (selectElement && control instanceof selectElement)
      return { kind: DisabledPropertyControlDecodeKind.Supported, control };
    const textAreaElement = view?.HTMLTextAreaElement;
    if (textAreaElement && control instanceof textAreaElement)
      return { kind: DisabledPropertyControlDecodeKind.Supported, control };
    const fieldSetElement = view?.HTMLFieldSetElement;
    if (fieldSetElement && control instanceof fieldSetElement)
      return { kind: DisabledPropertyControlDecodeKind.Supported, control };
    const optionElement = view?.HTMLOptionElement;
    if (optionElement && control instanceof optionElement)
      return { kind: DisabledPropertyControlDecodeKind.Supported, control };
    return { kind: DisabledPropertyControlDecodeKind.Unsupported };
  }

  controlIsEffectivelyDisabled(control: HTMLElement): boolean {
    const disabledPropertyControl = this.decodeDisabledPropertyControl(control);
    return (
      (disabledPropertyControl.kind ===
        DisabledPropertyControlDecodeKind.Supported &&
        disabledPropertyControl.control.disabled) ||
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
        (element.ownerDocument.defaultView?.HTMLDialogElement &&
          element instanceof
            element.ownerDocument.defaultView.HTMLDialogElement &&
          !element.open) ||
        !rendered
      ) {
        return false;
      }
      const parent = element.parentElement;
      if (!parent) return true;
      element = parent;
    }
  }
}
