import { AuthenticationInputSurface } from "./authentication-input-surface";

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
      if (
        AuthenticationInputSurface.isFieldSetElement(ancestor) &&
        ancestor.hasAttribute("disabled")
      ) {
        const firstLegend = [...ancestor.children].find(
          AuthenticationInputSurface.isLegendElement,
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
    return AuthenticationInputSurface.isButtonElement(control) ||
      AuthenticationInputSurface.isInputElement(control) ||
      AuthenticationInputSurface.isSelectElement(control) ||
      AuthenticationInputSurface.isTextAreaElement(control) ||
      AuthenticationInputSurface.isFieldSetElement(control) ||
      AuthenticationInputSurface.isOptionElement(control)
      ? {
          kind: DisabledPropertyControlDecodeKind.Supported,
          control,
        }
      : { kind: DisabledPropertyControlDecodeKind.Unsupported };
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
        (AuthenticationInputSurface.isDialogElement(element) &&
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
