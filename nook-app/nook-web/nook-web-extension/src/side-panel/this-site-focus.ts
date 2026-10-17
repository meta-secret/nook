/** Where focus was when This site replaced what it shows. */
export enum ThisSiteFocusPlace {
  InSection = 'in-section',
  Elsewhere = 'elsewhere',
}

/** Releases an attachment when Svelte removes its element. */
type ThisSiteAttachmentRelease = () => void

/**
 * Keeps focus in This site when its list is replaced (tab switch, address
 * change, reload): focus that was inside the section moves to the heading,
 * since the control that held it may be gone. Focus elsewhere never moves.
 */
export class ThisSiteFocus {
  private readonly sections = new Set<HTMLElement>()
  private readonly headings = new Set<HTMLElement>()

  readonly attachSection = (
    element: HTMLElement,
  ): ThisSiteAttachmentRelease => {
    this.sections.add(element)
    return () => this.sections.delete(element)
  }

  readonly attachHeading = (
    element: HTMLElement,
  ): ThisSiteAttachmentRelease => {
    this.headings.add(element)
    return () => this.headings.delete(element)
  }

  place(): ThisSiteFocusPlace {
    const focused = document.activeElement
    const inside = [...this.sections].some((section) =>
      section.contains(focused),
    )
    switch (inside) {
      case true:
        return ThisSiteFocusPlace.InSection
      case false:
        return ThisSiteFocusPlace.Elsewhere
    }
  }

  restore(place: ThisSiteFocusPlace): void {
    switch (place) {
      case ThisSiteFocusPlace.Elsewhere:
        return
      case ThisSiteFocusPlace.InSection:
        for (const heading of this.headings) heading.focus()
    }
  }
}
