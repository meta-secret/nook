import { AuthenticatorEnrollmentSourceBound } from '../../../nook-web-shared/src/extension/authenticator-enrollment-candidates'
import {
  ElementRendering,
  RenderedElementVisibility,
} from './rendered-element-visibility'

/** The scopes whose visible text may show a setup key, in page order. */
export type SetupKeyScopes = readonly HTMLElement[]

enum SetupKeyTextFit {
  Fits = 'fits',
  TooLong = 'too-long',
}

/**
 * Gathers bounded visible text candidates that may hold an authenticator setup
 * key, only after the trusted **Add 2FA from this page** click. TypeScript
 * never judges whether a text is a key: Rust decides plausibility and
 * normalizes it. Buttons and links are never read, and text longer than the
 * transport bound is skipped rather than truncated into a different key.
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

  collect(scopes: SetupKeyScopes): string[] {
    const texts: string[] = []
    for (const candidate of scopes.flatMap((scope) => this.elements(scope))) {
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

  /**
   * Key-shaped markup comes first and reads its whole text, so a key split
   * across child spans stays one candidate; leaves read only their own text.
   */
  private elements(scope: HTMLElement): HTMLElement[] {
    const containers = Array.from(
      scope.querySelectorAll(SetupKeyTextCandidates.CONTAINER_SELECTOR),
    )
    const leaves = Array.from(
      scope.querySelectorAll(SetupKeyTextCandidates.TEXT_LEAF_SELECTOR),
    ).filter(
      (element) =>
        !element.matches(SetupKeyTextCandidates.CONTAINER_SELECTOR) &&
        Array.from(element.childNodes).some(
          (node) => node instanceof Text && node.data.trim().length > 0,
        ),
    )
    return [...containers, ...leaves]
      .filter((element) => element instanceof HTMLElement)
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
