import type {
  SignInAttemptActionOffer,
  SignInAttemptPresentation,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { AuthenticationGesture } from '../../lib/auth-widget-policy'
import { BROWSER_MESSAGE_KEYS } from '../../lib/browser-message-keys'
import type { LoginChecklistRendering } from './login-checklist-rendering'

export interface SignInAttemptSurface {
  readonly body: HTMLDivElement
  readonly title: HTMLHeadingElement
  readonly description: HTMLParagraphElement
  readonly continueButton: HTMLButtonElement
}

export type SignInAttemptActionChoice = (
  offer: SignInAttemptActionOffer,
) => void

export type SignInAttemptRenderingRequest = {
  readonly surface: SignInAttemptSurface
  readonly checklist: LoginChecklistRendering
  readonly choose: SignInAttemptActionChoice
}

enum SignInAttemptDetailKind {
  Shown = 'shown',
  Absent = 'absent',
}
type SignInAttemptDetailCopy = {
  readonly element: HTMLElement
  readonly copy: string
}

/**
 * Renders a Rust sign-in attempt presentation into the Pilot surface.
 * All copy comes from Rust-selected message keys; the site's own message is
 * written with `textContent` only.
 */
export class SignInAttemptRendering {
  static readonly STYLES = `
    .sign-in-attempt-detail { display: grid; gap: 10px; margin: -4px 0 0; }
    .sign-in-attempt-reason { margin: 0; color: var(--nk-fg); font-size: 13px; font-weight: 600; line-height: 1.45; }
    .sign-in-site-message { margin: 0; padding: 9px 11px; border: 1px solid var(--nk-border); border-left: 3px solid var(--nk-warning); background: var(--nk-bg); display: grid; gap: 4px; }
    .sign-in-site-message-label { margin: 0; color: var(--nk-muted); font-family: var(--nk-mono); font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; }
    .sign-in-site-message-text { margin: 0; color: var(--nk-fg); font-size: 12.5px; line-height: 1.45; overflow-wrap: anywhere; }
    .sign-in-attempt-actions { display: grid; gap: 8px; }
    .sign-in-attempt-actions .text-button { margin: 0 auto; }
  `
  private readonly detail: HTMLDivElement
  private readonly reason: HTMLParagraphElement
  private readonly siteMessage: HTMLDivElement
  private readonly siteMessageText: HTMLParagraphElement
  private readonly actions: HTMLDivElement

  constructor(private readonly request: SignInAttemptRenderingRequest) {
    const { surface } = request
    const style = document.createElement('style')
    style.textContent = SignInAttemptRendering.STYLES
    this.detail = document.createElement('div')
    this.detail.className = 'sign-in-attempt-detail'
    this.detail.setAttribute('data-testid', 'nook-sign-in-attempt')
    this.reason = document.createElement('p')
    this.reason.className = 'sign-in-attempt-reason'
    this.reason.setAttribute('data-testid', 'nook-sign-in-reason')
    this.siteMessage = document.createElement('div')
    this.siteMessage.className = 'sign-in-site-message'
    const label = document.createElement('p')
    label.className = 'sign-in-site-message-label'
    label.textContent = chrome.i18n.getMessage(
      BROWSER_MESSAGE_KEYS.WidgetSignInSiteMessageLabel,
    )
    this.siteMessageText = document.createElement('p')
    this.siteMessageText.className = 'sign-in-site-message-text'
    this.siteMessageText.setAttribute(
      'data-testid',
      'nook-sign-in-site-message',
    )
    this.siteMessage.append(label, this.siteMessageText)
    this.detail.append(style, this.reason, this.siteMessage)
    this.actions = document.createElement('div')
    this.actions.className = 'sign-in-attempt-actions'
    this.actions.setAttribute('data-testid', 'nook-sign-in-actions')
    surface.description.after(this.detail)
    surface.continueButton.before(this.actions)
    this.detail.hidden = true
    this.actions.hidden = true
  }

  render(presentation: SignInAttemptPresentation): void {
    const { surface, checklist } = this.request
    surface.title.textContent = chrome.i18n.getMessage(presentation.titleKey)
    surface.description.textContent = chrome.i18n.getMessage(
      presentation.descriptionKey,
    )
    this.detail.dataset.status = String(presentation.status)
    this.renderReason(presentation)
    this.renderSiteMessage(presentation)
    checklist.render(presentation.checklist)
    this.renderActions(presentation.actions)
    this.detail.hidden = ![this.reason, this.siteMessage]
      .map((element) => this.detailKind(element))
      .includes(SignInAttemptDetailKind.Shown)
    surface.continueButton.hidden = true
  }

  /** Returns the surface to the normal fresh Pilot. */
  clear(): void {
    this.detail.hidden = true
    this.actions.hidden = true
    this.actions.replaceChildren()
    this.siteMessageText.textContent = ''
    delete this.detail.dataset.status
    this.request.surface.continueButton.hidden = false
  }

  /** A choice that could not be revalidated stays visible but inert. */
  disable(offer: SignInAttemptActionOffer): void {
    const button = this.actions.querySelector(
      `button[data-action="${String(offer.action)}"]`,
    )
    switch (true) {
      case button instanceof HTMLButtonElement:
        button.disabled = true
    }
  }

  private renderReason(presentation: SignInAttemptPresentation): void {
    const reason = presentation.reasonKey
    switch (typeof reason) {
      case 'string': {
        const update: SignInAttemptDetailCopy = {
          element: this.reason,
          copy: chrome.i18n.getMessage(reason),
        }
        this.show(update)
        return
      }
    }
    this.hide(this.reason)
  }

  private renderSiteMessage(presentation: SignInAttemptPresentation): void {
    const message = presentation.siteMessage
    switch (typeof message) {
      case 'string': {
        this.siteMessageText.textContent = message
        this.siteMessage.hidden = false
        return
      }
    }
    this.siteMessageText.textContent = ''
    this.siteMessage.hidden = true
  }

  private show(update: SignInAttemptDetailCopy): void {
    update.element.textContent = update.copy
    update.element.hidden = false
  }

  private hide(element: HTMLElement): void {
    element.textContent = ''
    element.hidden = true
  }

  private renderActions(offers: readonly SignInAttemptActionOffer[]): void {
    this.actions.replaceChildren(
      ...offers.map((offer, index) => {
        const position: SignInAttemptActionPosition = { offer, index }
        return this.actionButton(position)
      }),
    )
    this.actions.hidden = offers.length === 0
  }

  private actionButton(
    position: SignInAttemptActionPosition,
  ): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = this.actionClass(position)
    button.dataset.action = String(position.offer.action)
    button.textContent = chrome.i18n.getMessage(position.offer.labelKey)
    button.addEventListener('click', (event) => {
      switch (new AuthenticationGesture(event).trusted && !button.disabled) {
        case true:
          button.disabled = true
          this.request.choose(position.offer)
          return
        case false:
          return
      }
    })
    return button
  }

  /** The first offer is the primary next step; the rest stay secondary. */
  private actionClass(position: SignInAttemptActionPosition): string {
    switch (position.index) {
      case 0:
        return 'primary-button'
    }
    return 'secondary-button'
  }

  private detailKind(element: HTMLElement): SignInAttemptDetailKind {
    switch (element.hidden) {
      case true:
        return SignInAttemptDetailKind.Absent
      case false:
        return SignInAttemptDetailKind.Shown
    }
  }
}

type SignInAttemptActionPosition = {
  readonly offer: SignInAttemptActionOffer
  readonly index: number
}
