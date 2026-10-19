import type { AuthenticationAuthenticatorSetupObservation } from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type { AuthenticatorEnrollmentPreview } from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

import {
  BROWSER_MESSAGE_KEYS,
  type BrowserMessageKey,
} from '../lib/browser-message-keys'

export type EnrollmentFlowViewHost = {
  panel: HTMLElement
  title: HTMLHeadingElement
  description: HTMLParagraphElement
  translatedMessage: (key: BrowserMessageKey) => string
}

export type EnrollmentPageHints = {
  qr: AuthenticationAuthenticatorSetupObservation
  backupCodes: boolean
}

const ENROLLMENT_SECTION_CLASS = 'enrollment-actions'

type ResetEnrollmentHeadlineArgs = {
  host: EnrollmentFlowViewHost
  hints: EnrollmentPageHints
}

type SetHostDescriptionArgs = {
  host: EnrollmentFlowViewHost
  text: string
}

type AppendButtonRowArgs = {
  container: HTMLElement
  buttons: HTMLButtonElement[]
}

type EnrollmentFlowButtonCreationRequest = {
  host: EnrollmentFlowViewHost
  className: string
  labelKey: BrowserMessageKey
  onClick: (event: MouseEvent) => void
}

type CreatePrimaryButtonArgs = {
  host: EnrollmentFlowViewHost
  labelKey: BrowserMessageKey
  onClick: (event: MouseEvent) => void
}

type CreateSecondaryButtonArgs = {
  host: EnrollmentFlowViewHost
  labelKey: BrowserMessageKey
  onClick: (event: MouseEvent) => void
}

type CreateTextButtonArgs = {
  host: EnrollmentFlowViewHost
  labelKey: BrowserMessageKey
  onClick: (event: MouseEvent) => void
}

/** The editable labels a reviewed enrollment saves; Rust validates them. */
export type ReviewedLabelFields = {
  readonly issuer: HTMLInputElement
  readonly account: HTMLInputElement
}

type PreviewLabelFieldRequest = {
  readonly host: EnrollmentFlowViewHost
  readonly labelKey: BrowserMessageKey
  readonly value: string
}

type PreviewLabelField = {
  readonly row: HTMLLabelElement
  readonly input: HTMLInputElement
}

type RenderPreviewDetailsArgs = {
  container: HTMLElement
  host: EnrollmentFlowViewHost
  preview: AuthenticatorEnrollmentPreview
}

/** Owns this browser host’s resources and interaction lifecycle. */
class EnrollmentFlowRenderer {
  constructor(private readonly browser: typeof globalThis) {}

  resetEnrollmentHeadline({ host, hints }: ResetEnrollmentHeadlineArgs): void {
    switch (hints.qr) {
      case 'present':
        host.title.textContent = host.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetEnrollTitle,
        )
        host.description.textContent = host.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetEnrollDescription,
        )
        return
      case 'absent':
        host.title.textContent = host.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetBackupTitle,
        )
        host.description.textContent = host.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetBackupDescription,
        )
        return
    }
  }

  clearEnrollmentSection(panel: HTMLElement): void {
    panel.querySelector(`.${ENROLLMENT_SECTION_CLASS}`)?.remove()
  }

  createEnrollmentSection(panel: HTMLElement): HTMLElement {
    this.clearEnrollmentSection(panel)
    const section = this.browser.document.createElement('div')
    section.className = ENROLLMENT_SECTION_CLASS
    section.classList.add('account-list')
    panel.append(section)
    return section
  }

  setHostDescription({ host, text }: SetHostDescriptionArgs): void {
    host.description.textContent = text
  }

  appendButtonRow({ container, buttons }: AppendButtonRowArgs): void {
    const row = this.browser.document.createElement('div')
    row.className = 'account-list'
    buttons.forEach((button) => row.append(button))
    container.append(row)
  }

  private createButton({
    host,
    className,
    labelKey,
    onClick,
  }: EnrollmentFlowButtonCreationRequest): HTMLButtonElement {
    const button = this.browser.document.createElement('button')
    button.type = 'button'
    button.className = className
    button.textContent = host.translatedMessage(labelKey)
    button.setAttribute('aria-label', host.translatedMessage(labelKey))
    button.addEventListener('click', onClick)
    return button
  }

  createPrimaryButton({
    host,
    labelKey,
    onClick,
  }: CreatePrimaryButtonArgs): HTMLButtonElement {
    const nookTypedArgs0_0: Parameters<typeof this.createButton>[0] = {
      host,
      className: 'primary-button',
      labelKey,
      onClick,
    }
    return this.createButton(nookTypedArgs0_0)
  }

  createSecondaryButton({
    host,
    labelKey,
    onClick,
  }: CreateSecondaryButtonArgs): HTMLButtonElement {
    const nookTypedArgs0_1: Parameters<typeof this.createButton>[0] = {
      host,
      className: 'secondary-button',
      labelKey,
      onClick,
    }
    return this.createButton(nookTypedArgs0_1)
  }

  createTextButton({
    host,
    labelKey,
    onClick,
  }: CreateTextButtonArgs): HTMLButtonElement {
    const nookTypedArgs0_2: Parameters<typeof this.createButton>[0] = {
      host,
      className: 'text-button',
      labelKey,
      onClick,
    }
    return this.createButton(nookTypedArgs0_2)
  }

  /**
   * Service and account are editable and prefilled from Rust's preview; the
   * reviewed values travel with the stage request and Rust validates them at
   * save. The remaining protocol details stay read-only.
   */
  renderPreviewDetails({
    container,
    host,
    preview,
  }: RenderPreviewDetailsArgs): ReviewedLabelFields {
    const details = this.browser.document.createElement('div')
    details.className = 'account-list'
    const issuerField: PreviewLabelFieldRequest = {
      host,
      labelKey: BROWSER_MESSAGE_KEYS.WidgetEnrollIssuer,
      value: preview.issuer,
    }
    const accountField: PreviewLabelFieldRequest = {
      host,
      labelKey: BROWSER_MESSAGE_KEYS.WidgetEnrollAccount,
      value: preview.account,
    }
    const issuer = this.labelField(issuerField)
    const account = this.labelField(accountField)
    details.append(issuer.row, account.row)
    const rows: Array<[BrowserMessageKey, string]> = [
      [BROWSER_MESSAGE_KEYS.WidgetEnrollOrigin, this.browser.location.origin],
      [BROWSER_MESSAGE_KEYS.WidgetEnrollAlgorithm, preview.algorithm],
      [BROWSER_MESSAGE_KEYS.WidgetEnrollDigits, String(preview.digits)],
      [BROWSER_MESSAGE_KEYS.WidgetEnrollPeriod, String(preview.period)],
    ]
    for (const [key, value] of rows) {
      const line = this.browser.document.createElement('p')
      line.className = 'description'
      line.textContent = `${host.translatedMessage(key)}: ${value}`
      details.append(line)
    }
    container.append(details)
    const fields: ReviewedLabelFields = {
      issuer: issuer.input,
      account: account.input,
    }
    return fields
  }

  private labelField({
    host,
    labelKey,
    value,
  }: PreviewLabelFieldRequest): PreviewLabelField {
    const row = this.browser.document.createElement('label')
    row.className = 'description'
    row.textContent = host.translatedMessage(labelKey)
    const input = this.browser.document.createElement('input')
    input.type = 'text'
    input.className = 'description'
    input.value = value
    input.autocomplete = 'off'
    input.spellcheck = false
    row.append(input)
    const field: PreviewLabelField = { row, input }
    return field
  }
}

export const enrollmentFlowRenderer = new EnrollmentFlowRenderer(globalThis)
