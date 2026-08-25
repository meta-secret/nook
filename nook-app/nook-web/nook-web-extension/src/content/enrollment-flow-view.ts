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
  qr: boolean
  backupCodes: boolean
}

const ENROLLMENT_SECTION_CLASS = 'enrollment-actions'

type ResetEnrollmentHeadlineArgs = {
  host: EnrollmentFlowViewHost
  hints: EnrollmentPageHints
}

export function resetEnrollmentHeadline({
  host,
  hints,
}: ResetEnrollmentHeadlineArgs): void {
  const titleKey = hints.qr
    ? BROWSER_MESSAGE_KEYS.WidgetEnrollTitle
    : BROWSER_MESSAGE_KEYS.WidgetBackupTitle
  const descriptionKey = hints.qr
    ? BROWSER_MESSAGE_KEYS.WidgetEnrollDescription
    : BROWSER_MESSAGE_KEYS.WidgetBackupDescription
  host.title.textContent = host.translatedMessage(titleKey)
  host.description.textContent = host.translatedMessage(descriptionKey)
}

export function clearEnrollmentSection(panel: HTMLElement): void {
  panel.querySelector(`.${ENROLLMENT_SECTION_CLASS}`)?.remove()
}

export function hasEnrollmentSection(root: ParentNode): boolean {
  return Boolean(root.querySelector(`.${ENROLLMENT_SECTION_CLASS}`))
}

export function createEnrollmentSection(panel: HTMLElement): HTMLElement {
  clearEnrollmentSection(panel)
  const section = document.createElement('div')
  section.className = ENROLLMENT_SECTION_CLASS
  section.classList.add('account-list')
  panel.append(section)
  return section
}

type SetHostDescriptionArgs = {
  host: EnrollmentFlowViewHost
  text: string
}

export function setHostDescription({
  host,
  text,
}: SetHostDescriptionArgs): void {
  host.description.textContent = text
}

type AppendButtonRowArgs = {
  container: HTMLElement
  buttons: HTMLButtonElement[]
}

export function appendButtonRow({
  container,
  buttons,
}: AppendButtonRowArgs): void {
  const row = document.createElement('div')
  row.className = 'account-list'
  buttons.forEach((button) => row.append(button))
  container.append(row)
}

type EnrollmentFlowButtonCreationRequest = {
  host: EnrollmentFlowViewHost
  className: string
  labelKey: BrowserMessageKey
  onClick: (event: MouseEvent) => void
}

function createButton({
  host,
  className,
  labelKey,
  onClick,
}: EnrollmentFlowButtonCreationRequest): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.textContent = host.translatedMessage(labelKey)
  button.setAttribute('aria-label', host.translatedMessage(labelKey))
  button.addEventListener('click', onClick)
  return button
}

type CreatePrimaryButtonArgs = {
  host: EnrollmentFlowViewHost
  labelKey: BrowserMessageKey
  onClick: (event: MouseEvent) => void
}

export function createPrimaryButton({
  host,
  labelKey,
  onClick,
}: CreatePrimaryButtonArgs): HTMLButtonElement {
  const nookTypedArgs0_0: Parameters<typeof createButton>[0] = {
    host,
    className: 'primary-button',
    labelKey,
    onClick,
  }
  return createButton(nookTypedArgs0_0)
}

type CreateSecondaryButtonArgs = {
  host: EnrollmentFlowViewHost
  labelKey: BrowserMessageKey
  onClick: (event: MouseEvent) => void
}

export function createSecondaryButton({
  host,
  labelKey,
  onClick,
}: CreateSecondaryButtonArgs): HTMLButtonElement {
  const nookTypedArgs0_1: Parameters<typeof createButton>[0] = {
    host,
    className: 'secondary-button',
    labelKey,
    onClick,
  }
  return createButton(nookTypedArgs0_1)
}

type CreateTextButtonArgs = {
  host: EnrollmentFlowViewHost
  labelKey: BrowserMessageKey
  onClick: (event: MouseEvent) => void
}

export function createTextButton({
  host,
  labelKey,
  onClick,
}: CreateTextButtonArgs): HTMLButtonElement {
  const nookTypedArgs0_2: Parameters<typeof createButton>[0] = {
    host,
    className: 'text-button',
    labelKey,
    onClick,
  }
  return createButton(nookTypedArgs0_2)
}

type RenderPreviewDetailsArgs = {
  container: HTMLElement
  host: EnrollmentFlowViewHost
  preview: AuthenticatorEnrollmentPreview
}

export function renderPreviewDetails({
  container,
  host,
  preview,
}: RenderPreviewDetailsArgs): void {
  const details = document.createElement('div')
  details.className = 'account-list'
  const rows: Array<[BrowserMessageKey, string]> = [
    [BROWSER_MESSAGE_KEYS.WidgetEnrollIssuer, preview.issuer],
    [BROWSER_MESSAGE_KEYS.WidgetEnrollAccount, preview.account],
    [BROWSER_MESSAGE_KEYS.WidgetEnrollOrigin, location.origin],
    [BROWSER_MESSAGE_KEYS.WidgetEnrollAlgorithm, preview.algorithm],
    [BROWSER_MESSAGE_KEYS.WidgetEnrollDigits, String(preview.digits)],
    [BROWSER_MESSAGE_KEYS.WidgetEnrollPeriod, String(preview.period)],
  ]
  for (const [key, value] of rows) {
    const line = document.createElement('p')
    line.className = 'description'
    line.textContent = `${host.translatedMessage(key)}: ${value}`
    details.append(line)
  }
  container.append(details)
}
