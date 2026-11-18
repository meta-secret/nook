/** Whether the person can see an input: the credential scan's rendered-input rule. */
export enum PageInputRendering {
  Rendered = "rendered",
  Hidden = "hidden",
}

export type RenderedElementProbe = (candidate: HTMLElement) => boolean;

type InheritedElementRenderingObservation = {
  readonly candidate: HTMLElement;
  readonly observed: Map<HTMLElement, PageInputRendering>;
};

/** Owns browser observations shared by the concrete authentication interaction. */
export class AuthenticationInputSurface {
  constructor(protected readonly browser: typeof globalThis) {}

  /** Applies the credential scan's rendered-input rule to a host scope outside it. */
  inputRendering(field: HTMLInputElement): PageInputRendering {
    switch (this.isRenderedInput(field)) {
      case true:
        return PageInputRendering.Rendered;
      case false:
        return PageInputRendering.Hidden;
    }
  }
  protected isRenderedInput(field: HTMLInputElement): boolean {
    if (field.type === "hidden") return false;
    return this.isRenderedElement(field);
  }

  protected isRenderedElement(candidate: HTMLElement): boolean {
    return (
      this.candidateCanRender(candidate) && this.ancestryCanRender(candidate)
    );
  }

  /** Reuses inherited visibility only within one synchronous DOM observation. */
  protected observeElementRendering(): RenderedElementProbe {
    const observed = new Map<HTMLElement, PageInputRendering>();
    return (candidate) => {
      const request: InheritedElementRenderingObservation = {
        candidate,
        observed,
      };
      return (
        this.candidateCanRender(candidate) &&
        this.observedAncestryCanRender(request)
      );
    };
  }

  private candidateCanRender(candidate: HTMLElement): boolean {
    // Cookie/consent layers often mark large subtrees aria-hidden while the
    // login fields remain CSS-visible and focusable (common on Meta). Only the
    // candidate itself is rejected for aria-hidden; ancestors still fail on
    // hidden / display:none / visibility:hidden so closed menus stay ignored.
    return (
      !candidate.closest("dialog:not([open])") &&
      candidate.getAttribute("aria-hidden") !== "true"
    );
  }

  private ancestryCanRender(candidate: HTMLElement): boolean {
    for (
      let element: HTMLElement["parentElement"] = candidate;
      element;
      element = element.parentElement
    ) {
      switch (this.ancestorCanRender(element)) {
        case false:
          return false;
        case true:
          break;
      }
    }
    return true;
  }

  private observedAncestryCanRender({
    candidate,
    observed,
  }: InheritedElementRenderingObservation): boolean {
    const visited: HTMLElement[] = [];
    let rendering = PageInputRendering.Rendered;
    ancestry: for (
      let element: HTMLElement["parentElement"] = candidate;
      element;
      element = element.parentElement
    ) {
      const previous = observed.get(element);
      switch (true) {
        case previous === PageInputRendering.Rendered:
        case previous === PageInputRendering.Hidden:
          rendering = previous;
          break ancestry;
        case true:
        default:
          break;
      }
      visited.push(element);
      switch (this.ancestorCanRender(element)) {
        case false:
          rendering = PageInputRendering.Hidden;
          break ancestry;
        case true:
          break;
      }
    }
    for (const element of visited) observed.set(element, rendering);
    return rendering === PageInputRendering.Rendered;
  }

  private ancestorCanRender(element: HTMLElement): boolean {
    const ownerView = element.ownerDocument.defaultView;
    const dialogElement = ownerView?.HTMLDialogElement;
    switch (
      Boolean(
        element.hidden ||
        element.hasAttribute("inert") ||
        element.inert ||
        element.getAttribute("aria-disabled") === "true" ||
        (dialogElement && element instanceof dialogElement && !element.open),
      )
    ) {
      case true:
        return false;
      case false:
        break;
    }
    const style = ownerView?.getComputedStyle(element);
    return (
      style?.display !== "none" &&
      style?.visibility !== "hidden" &&
      !(
        style &&
        (style.overflow === "hidden" ||
          style.overflow === "clip" ||
          style.overflowY === "hidden" ||
          style.overflowY === "clip") &&
        style.height === "0px"
      )
    );
  }

  protected inputIsEffectivelyDisabled(field: HTMLInputElement): boolean {
    if (field.disabled || field.matches(":disabled")) return true;
    for (
      let ancestor = field.parentElement;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      const fieldSetElement =
        ancestor.ownerDocument.defaultView?.HTMLFieldSetElement;
      if (
        !fieldSetElement ||
        !(ancestor instanceof fieldSetElement) ||
        !ancestor.disabled
      ) {
        continue;
      }
      const legendElement =
        ancestor.ownerDocument.defaultView?.HTMLLegendElement;
      const firstLegend = Array.from(ancestor.children).flatMap((child) =>
        legendElement && child instanceof legendElement ? [child] : [],
      )[0];
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
