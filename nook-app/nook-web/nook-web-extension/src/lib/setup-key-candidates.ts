import { AuthenticatorEnrollmentSourceBound } from '../../../nook-web-shared/src/extension/authenticator-enrollment-candidates'
import {
  ElementRendering,
  RenderedElementVisibility,
} from './rendered-element-visibility'

/** The nearest setup scope and the instruction or QR element its texts are ordered from. */
export type SetupKeySource = {
  readonly scope: HTMLElement
  readonly anchor: Element
}

/** At most one setup scope: the one nearest the setup instructions or QR. */
export type SetupKeySources = readonly SetupKeySource[]

enum SetupKeyTextFit {
  Fits = 'fits',
  TooLong = 'too-long',
}

/** Tree distance from one anchor element: edges up to a shared ancestor and back down. */
class DomDistance {
  private readonly anchorDepths = new Map<Node, number>()

  constructor(anchor: Element) {
    for (const [depth, node] of [...this.ancestry(anchor)].entries()) {
      this.anchorDepths.set(node, depth)
    }
  }

  to(element: Element): number {
    for (const [steps, node] of [...this.ancestry(element)].entries()) {
      switch (this.anchorDepths.has(node)) {
        case true:
          return steps + Number(this.anchorDepths.get(node))
        case false:
          break
      }
    }
    // Disconnected trees share no ancestor; order them after every connected one.
    return [...this.ancestry(element)].length + this.anchorDepths.size
  }

  /** The node and its ancestors, nearest first. */
  private *ancestry(start: Node): Generator<Node> {
    yield start
    for (const parent of [start.parentNode].filter(
      (node) => node instanceof Node,
    )) {
      yield* this.ancestry(parent)
    }
  }
}

/**
 * Gathers bounded visible text candidates that may hold an authenticator setup
 * key, only after the trusted **Add 2FA from this page** click and only from
 * the single nearest setup scope. Candidates are ordered nearest-first by DOM
 * distance to the setup instructions or QR, so earlier prose cannot crowd the
 * key out of the bound. TypeScript never judges whether a text is a key: Rust
 * decides plausibility and normalizes it. Buttons and links are never read,
 * and text longer than the transport bound is skipped rather than truncated
 * into a different key.
 */
export class SetupKeyTextCandidates {
  static readonly CONTAINER_SELECTOR =
    'input[readonly],code,kbd,samp,pre,[data-setup-key]'
  static readonly TEXT_LEAF_SELECTOR = 'div,span,p,strong,b'
  static readonly EXCLUDED_SELECTOR =
    'button,a,[role="button"],[role="link"],textarea,select,script,style,template'

  private readonly encoder = new TextEncoder()
  private readonly visibility: RenderedElementVisibility

  constructor(browser: typeof globalThis) {
    this.visibility = new RenderedElementVisibility(browser)
  }

  collect(sources: SetupKeySources): string[] {
    const texts: string[] = []
    for (const candidate of sources.flatMap((source) => this.nearest(source))) {
      switch (
        texts.length < AuthenticatorEnrollmentSourceBound.MaxSetupKeyTexts
      ) {
        case false:
          return texts
        case true:
          break
      }
      const text = this.candidateText(candidate)
      switch (text.length > 0 && !texts.includes(text)) {
        case false:
          continue
        case true:
          break
      }
      switch (this.textFit(text)) {
        case SetupKeyTextFit.TooLong:
          continue
        case SetupKeyTextFit.Fits:
          break
      }
      texts.push(text)
    }
    return texts
  }

  /** The scope's candidates, nearest the anchor first, ties in page order. */
  private nearest({ scope, anchor }: SetupKeySource): HTMLElement[] {
    const distance = new DomDistance(anchor)
    const byDistance: HTMLElement[][] = []
    for (const element of this.elements(scope)) {
      const steps = distance.to(element)
      for (let index = byDistance.length; index <= steps; index += 1) {
        byDistance.push([])
      }
      byDistance[steps]?.push(element)
    }
    return byDistance.flat()
  }

  /**
   * Key-shaped markup reads its whole text, so a key split across child spans
   * stays one candidate; leaves read only text they hold themselves.
   */
  private elements(scope: HTMLElement): HTMLElement[] {
    const selector = `${SetupKeyTextCandidates.CONTAINER_SELECTOR},${SetupKeyTextCandidates.TEXT_LEAF_SELECTOR}`
    return Array.from(scope.querySelectorAll(selector))
      .filter((element) => element instanceof HTMLElement)
      .filter(
        (element) =>
          element.matches(SetupKeyTextCandidates.CONTAINER_SELECTOR) ||
          Array.from(element.childNodes).some(
            (node) => node instanceof Text && node.data.trim().length > 0,
          ),
      )
      .filter(
        (element) =>
          !(
            element.closest(SetupKeyTextCandidates.EXCLUDED_SELECTOR) instanceof
            Element
          ),
      )
      .filter(
        (element) =>
          this.visibility.rendering(element) === ElementRendering.Rendered,
      )
  }

  /** A read-only input shows its value; other markup shows its rendered text. */
  private candidateText(element: HTMLElement): string {
    const inputs = [element].filter(
      (candidate) => candidate instanceof HTMLInputElement,
    )
    for (const input of inputs) return input.value.trim()
    return element.innerText.trim()
  }

  private textFit(text: string): SetupKeyTextFit {
    switch (
      this.encoder.encode(text).length <=
      AuthenticatorEnrollmentSourceBound.MaxSetupKeyTextBytes
    ) {
      case true:
        return SetupKeyTextFit.Fits
      case false:
        return SetupKeyTextFit.TooLong
    }
  }
}
