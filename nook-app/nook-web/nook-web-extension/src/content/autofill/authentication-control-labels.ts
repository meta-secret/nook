export type AuthenticationControlLabelRequest = {
  readonly root: ParentNode
  /** The caller's existing rendered-element check. */
  readonly rendered: (control: HTMLElement) => boolean
}

/**
 * Raw, bounded labels of the page's rendered controls (text, aria-label and
 * title). Rust classifies them, for example a sign-out control as an
 * authenticated affordance; nothing here interprets them and they are never
 * logged. Shared by the login-save and sign-in attempt sensors so both send
 * identical facts.
 */
export class AuthenticationControlLabels {
  static readonly SELECTOR =
    'button, a[href], [role="button"], input[type="button"], input[type="submit"]'
  /** The Pilot's own shadow host is never a page control. */
  static readonly WIDGET_HOST_SELECTOR = '#nook-auth-widget'
  static readonly MAX_CONTROLS = 64
  static readonly MAX_LABEL_LENGTH = 256

  static collect(request: AuthenticationControlLabelRequest): string[] {
    return Array.from(
      request.root.querySelectorAll<HTMLElement>(
        AuthenticationControlLabels.SELECTOR,
      ),
    )
      .filter(
        (control) =>
          !control.closest(AuthenticationControlLabels.WIDGET_HOST_SELECTOR) &&
          request.rendered(control),
      )
      .slice(0, AuthenticationControlLabels.MAX_CONTROLS)
      .map((control) => AuthenticationControlLabels.label(control))
  }

  private static label(control: HTMLElement): string {
    return [
      control.textContent,
      control.getAttribute('aria-label'),
      control.getAttribute('title'),
    ]
      .join(' ')
      .slice(0, AuthenticationControlLabels.MAX_LABEL_LENGTH)
  }
}
