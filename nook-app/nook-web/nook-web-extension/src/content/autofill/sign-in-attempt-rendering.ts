import type {
  SignInAttemptActionOffer,
  SignInAttemptPresentation,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { AuthenticationGesture } from '../../lib/auth-widget-policy'
import { BROWSER_MESSAGE_KEYS } from '../../lib/browser-message-keys'
import type { LoginChecklistRendering } from './login-checklist-rendering'
import { workflowUi, type StepProgressArgs } from './workflow-ui'

export interface SignInAttemptSurface {
  readonly body: HTMLDivElement
  /** The header step counter, fed Rust's attempt progress unchanged. */
  readonly step: HTMLParagraphElement
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
    .sign-in-site-message { margin: 0; padding: 9px 11px; border: 1px solid var(--nk-border); border-left: 3px solid var(--nk-warning); background: var(--nk-bg); display: grid; gap: 4px; }
    .sign-in-site-message-label { margin: 0; color: var(--nk-muted); font-family: var(--nk-mono); font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; }
    .sign-in-site-message-text { margin: 0; color: var(--nk-fg); font-size: 12.5px; line-height: 1.45; overflow-wrap: anywhere; }
    .sign-in-attempt-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .sign-in-attempt-actions .primary-button,
    .sign-in-attempt-actions .is-wide,
    .sign-in-attempt-actions .text-button { grid-column: 1 / -1; }
    .sign-in-attempt-actions button.secondary-button { min-height: 36px; padding: 7px 8px; font-size: 12.5px; line-height: 1.25; }
    .sign-in-attempt-actions .text-button { margin: 0 auto; }
  `
  private readonly detail: HTMLDivElement
  private readonly siteMessage: HTMLDivElement
  private readonly siteMessageText: HTMLParagraphElement
  private readonly actions: HTMLDivElement
  /** Offer kinds and label keys of the rendered buttons; never page text. */
  private renderedActions = ''

  constructor(private readonly request: SignInAttemptRenderingRequest) {
    const { surface } = request
    const style = document.createElement('style')
    style.textContent = SignInAttemptRendering.STYLES
    this.detail = document.createElement('div')
    this.detail.className = 'sign-in-attempt-detail'
    this.detail.setAttribute('data-testid', 'nook-sign-in-attempt')
    // The site's message is announced like the description, which carries the reason.
    this.detail.setAttribute('role', 'status')
    this.detail.setAttribute('aria-live', 'polite')
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
    this.detail.append(style, this.siteMessage)
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
    const progress: StepProgressArgs = {
      step: surface.step,
      currentStep: presentation.progress.currentStep,
      totalSteps: presentation.progress.totalSteps,
    }
    workflowUi.setStepProgress(progress)
    const title: SignInAttemptDetailCopy = {
      element: surface.title,
      copy: chrome.i18n.getMessage(presentation.title_key),
    }
    this.write(title)
    const description: SignInAttemptDetailCopy = {
      element: surface.description,
      copy: chrome.i18n.getMessage(presentation.description_key),
    }
    this.write(description)
    this.detail.dataset.status = String(presentation.status)
    this.renderSiteMessage(presentation)
    checklist.render(presentation.checklist)
    this.renderActions(presentation.actions)
    this.detail.hidden =
      this.detailKind(this.siteMessage) === SignInAttemptDetailKind.Absent
    surface.continueButton.hidden = true
  }

  /** Returns the surface to the normal fresh Pilot. */
  clear(): void {
    this.detail.hidden = true
    this.actions.hidden = true
    this.actions.replaceChildren()
    this.renderedActions = ''
    this.siteMessageText.textContent = ''
    delete this.detail.dataset.status
    this.request.surface.continueButton.hidden = false
  }

  /** A chosen follow-up could not run here: say so and offer nothing further. */
  refuse(): void {
    this.actions.replaceChildren()
    this.actions.hidden = true
    this.renderedActions = ''
    const refusal: SignInAttemptDetailCopy = {
      element: this.request.surface.description,
      copy: chrome.i18n.getMessage(
        BROWSER_MESSAGE_KEYS.WidgetSignInActionUnavailable,
      ),
    }
    this.write(refusal)
  }

  /** A choice that could not be revalidated stays visible but inert. */
  disable(offer: SignInAttemptActionOffer): void {
    const button = this.actions.querySelector(
      `button[data-action="${String(offer.action)}"]`,
    )
    switch (true) {
      case button instanceof HTMLButtonElement:
        button.disabled = true
        break
      case true:
        break
    }
  }

  private renderSiteMessage(presentation: SignInAttemptPresentation): void {
    const message = presentation.site_message
    switch (true) {
      case typeof message === 'string': {
        const copy: SignInAttemptDetailCopy = {
          element: this.siteMessageText,
          copy: message,
        }
        this.write(copy)
        this.siteMessage.hidden = false
        return
      }
      case true:
        this.siteMessageText.textContent = ''
        this.siteMessage.hidden = true
    }
  }

  /** Writes only changed copy, so identical presentations cause no DOM churn. */
  private write(update: SignInAttemptDetailCopy): void {
    switch (update.element.textContent === update.copy) {
      case true:
        return
      case false:
        update.element.textContent = update.copy
    }
  }

  /** Rebuilds buttons only when the offers change, so focus and clicks survive. */
  private renderActions(offers: readonly SignInAttemptActionOffer[]): void {
    const signature = offers
      .map((offer) => `${String(offer.action)}:${String(offer.label_key)}`)
      .join('|')
    switch (signature === this.renderedActions) {
      case true:
        return
      case false:
        break
    }
    this.renderedActions = signature
    this.actions.replaceChildren(
      ...offers.map((offer) => {
        const position: SignInAttemptActionPosition = {
          offer,
          index: offers.indexOf(offer),
          offers,
        }
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
    button.textContent = chrome.i18n.getMessage(position.offer.label_key)
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

  /**
   * The first offer is the primary next step; Dismiss is a quiet text
   * button; the other offers share a compact two-column row, and an odd one
   * out spans the row.
   */
  private actionClass(position: SignInAttemptActionPosition): string {
    switch (true) {
      case position.index === 0:
        return 'primary-button'
      case position.offer.action === 'Dismiss':
        return 'text-button'
      case true:
        break
    }
    const secondary = position.offers.filter(
      (offer) =>
        offer.action !== 'Dismiss' && position.offers.indexOf(offer) !== 0,
    )
    switch (
      secondary.length % 2 === 1 &&
      secondary.indexOf(position.offer) === secondary.length - 1
    ) {
      case true:
        return 'secondary-button is-wide'
      case false:
        return 'secondary-button'
    }
  }

  private detailKind(element: HTMLElement): SignInAttemptDetailKind {
    switch (element.hidden) {
      case true:
      case 'until-found':
        return SignInAttemptDetailKind.Absent
      case false:
        return SignInAttemptDetailKind.Shown
    }
  }
}

type SignInAttemptActionPosition = {
  readonly offer: SignInAttemptActionOffer
  readonly index: number
  readonly offers: readonly SignInAttemptActionOffer[]
}
