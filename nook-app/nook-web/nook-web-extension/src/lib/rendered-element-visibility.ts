export enum ElementRendering {
  Rendered = 'rendered',
  Hidden = 'hidden',
}

/**
 * Whether an element is painted inside the viewport: it has a box there and
 * neither it nor an ancestor is hidden, `aria-hidden`, undisplayed, invisible,
 * or fully transparent.
 */
export class RenderedElementVisibility {
  constructor(private readonly browser: typeof globalThis) {}

  rendering(element: Element): ElementRendering {
    const rect = element.getBoundingClientRect()
    switch (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < this.browser.window.innerHeight &&
      rect.left < this.browser.window.innerWidth
    ) {
      case false:
        return ElementRendering.Hidden
      case true:
        break
    }
    for (
      let ancestor: HTMLElement | Element = element;
      ancestor instanceof HTMLElement;
    ) {
      const style = this.browser.window.getComputedStyle(ancestor)
      switch (
        ancestor.hasAttribute('hidden') ||
        ancestor.getAttribute('aria-hidden') === 'true' ||
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0'
      ) {
        case true:
          return ElementRendering.Hidden
        case false:
          break
      }
      const parents: HTMLElement[] = [ancestor.parentElement].filter(
        (parent) => parent instanceof HTMLElement,
      )
      for (const parent of parents) ancestor = parent
      switch (parents.length) {
        case 0:
          return ElementRendering.Rendered
        default:
          break
      }
    }
    return ElementRendering.Hidden
  }
}
