import {
  clearBackupCodeCandidates,
  extractBackupCodeCandidates,
  pageHasBackupCodeHint,
} from '../lib/backup-code-candidates'
import type { OtpauthEnrollmentPreview } from '../lib/enrollment-messages'
import {
  clearOtpauthCandidate,
  decodeVisibleOtpauthCandidates,
  pageHasQrEnrollmentHint,
  type DecodedOtpauthCandidate,
} from '../lib/page-qr-capture'
import {
  isTrustedAuthAction,
  safeSavedOptionNumber,
} from '../lib/auth-widget-policy'
import type { WebsiteAuthenticatorOption } from '../lib/login-fill-messages'

export type EnrollmentPageHints = {
  qr: boolean
  backupCodes: boolean
}

export function detectEnrollmentHints(): EnrollmentPageHints {
  return {
    qr: pageHasQrEnrollmentHint(),
    backupCodes: pageHasBackupCodeHint(),
  }
}

export type EnrollmentFlowHost = {
  panel: HTMLElement
  step: HTMLParagraphElement
  title: HTMLHeadingElement
  description: HTMLParagraphElement
  continueButton: HTMLButtonElement
  openVaultButton: HTMLButtonElement
  setBusy: (busy: boolean) => void
  isBusy: () => boolean
  sendRuntimeMessage: <T>(message: unknown) => Promise<T | undefined>
  translatedMessage: (key: string) => string
  translatedMessageWithSubstitution: (
    key: string,
    substitution: string,
  ) => string
}

const ENROLLMENT_SECTION_CLASS = 'enrollment-actions'

type AuthenticatorOptionsResponse = {
  ok?: boolean
  status?: 'ready' | 'locked' | 'unavailable'
  accounts?: WebsiteAuthenticatorOption[]
}

type EnrollPreviewResponse = {
  ok?: boolean
  status?: 'ready' | 'unavailable'
  preview?: OtpauthEnrollmentPreview
  vaultStoreId?: string
  reason?: string
}

type EnrollConfirmResponse = {
  ok?: boolean
  reason?: string
}

type BackupAttachResponse = {
  ok?: boolean
  reason?: string
}

function resetEnrollmentHeadline(
  host: EnrollmentFlowHost,
  hints: EnrollmentPageHints,
): void {
  const titleKey = hints.qr ? 'widgetEnrollTitle' : 'widgetBackupTitle'
  const descriptionKey = hints.qr
    ? 'widgetEnrollDescription'
    : 'widgetBackupDescription'
  host.title.textContent = host.translatedMessage(titleKey)
  host.description.textContent = host.translatedMessage(descriptionKey)
}

function clearEnrollmentSection(panel: HTMLElement): void {
  panel.querySelector(`.${ENROLLMENT_SECTION_CLASS}`)?.remove()
}

function createEnrollmentSection(panel: HTMLElement): HTMLElement {
  clearEnrollmentSection(panel)
  const section = document.createElement('div')
  section.className = ENROLLMENT_SECTION_CLASS
  section.classList.add('account-list')
  panel.append(section)
  return section
}

function setHostDescription(host: EnrollmentFlowHost, text: string): void {
  host.description.textContent = text
}

function clearOtpauthUri(uri: { value: string }): void {
  uri.value = ''
}

function clearCandidate(candidate: DecodedOtpauthCandidate | undefined): void {
  if (!candidate) return
  clearOtpauthCandidate(candidate)
}

function unavailableMessage(host: EnrollmentFlowHost): string {
  return host.translatedMessage('widgetConnectVault')
}

function lockedEnrollMessage(host: EnrollmentFlowHost): string {
  return host.translatedMessage('widgetEnrollUnlock')
}

function lockedBackupMessage(host: EnrollmentFlowHost): string {
  return host.translatedMessage('widgetEnrollUnlock')
}

function appendButtonRow(
  container: HTMLElement,
  buttons: HTMLButtonElement[],
): void {
  const row = document.createElement('div')
  row.className = 'account-list'
  buttons.forEach((button) => row.append(button))
  container.append(row)
}

function createPrimaryButton(
  host: EnrollmentFlowHost,
  labelKey: string,
  onClick: (event: MouseEvent) => void,
): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'primary-button'
  button.textContent = host.translatedMessage(labelKey)
  button.setAttribute('aria-label', host.translatedMessage(labelKey))
  button.addEventListener('click', onClick)
  return button
}

function createSecondaryButton(
  host: EnrollmentFlowHost,
  labelKey: string,
  onClick: (event: MouseEvent) => void,
): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'secondary-button'
  button.textContent = host.translatedMessage(labelKey)
  button.setAttribute('aria-label', host.translatedMessage(labelKey))
  button.addEventListener('click', onClick)
  return button
}

function createTextButton(
  host: EnrollmentFlowHost,
  labelKey: string,
  onClick: (event: MouseEvent) => void,
): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'text-button'
  button.textContent = host.translatedMessage(labelKey)
  button.setAttribute('aria-label', host.translatedMessage(labelKey))
  button.addEventListener('click', onClick)
  return button
}

function renderPreviewDetails(
  container: HTMLElement,
  host: EnrollmentFlowHost,
  preview: OtpauthEnrollmentPreview,
): void {
  const details = document.createElement('div')
  details.className = 'account-list'
  const rows: Array<[string, string]> = [
    ['widgetEnrollIssuer', preview.issuer],
    ['widgetEnrollAccount', preview.account],
    ['widgetEnrollOrigin', location.origin],
    ['widgetEnrollAlgorithm', preview.algorithm],
    ['widgetEnrollDigits', String(preview.digits)],
    ['widgetEnrollPeriod', String(preview.period)],
  ]
  for (const [key, value] of rows) {
    const line = document.createElement('p')
    line.className = 'description'
    line.textContent = `${host.translatedMessage(key)}: ${value}`
    details.append(line)
  }
  container.append(details)
}

async function showQrPreview(
  host: EnrollmentFlowHost,
  section: HTMLElement,
  otpauthUri: { value: string },
  candidate: DecodedOtpauthCandidate | undefined,
): Promise<void> {
  section.replaceChildren()
  host.title.textContent = host.translatedMessage('widgetEnrollPreview')
  setHostDescription(host, host.translatedMessage('widgetEnrollWorking'))
  host.setBusy(true)

  try {
    const response = await host.sendRuntimeMessage<EnrollPreviewResponse>({
      type: 'nook:website-authenticator-enroll-preview',
      payload: {
        origin: location.origin,
        otpauthUri: otpauthUri.value,
      },
    })

    if (!response?.ok) {
      setHostDescription(host, host.translatedMessage('widgetEnrollFailed'))
      renderEnrollmentActions(host, detectEnrollmentHints())
      clearOtpauthUri(otpauthUri)
      clearCandidate(candidate)
      return
    }

    if (response.status === 'unavailable') {
      setHostDescription(host, unavailableMessage(host))
      renderEnrollmentActions(host, detectEnrollmentHints())
      clearOtpauthUri(otpauthUri)
      clearCandidate(candidate)
      return
    }

    const preview = response.preview
    const vaultStoreId = response.vaultStoreId
    if (!preview || !vaultStoreId) {
      setHostDescription(host, host.translatedMessage('widgetEnrollFailed'))
      renderEnrollmentActions(host, detectEnrollmentHints())
      clearOtpauthUri(otpauthUri)
      clearCandidate(candidate)
      return
    }

    setHostDescription(host, host.translatedMessage('widgetEnrollPreview'))
    renderPreviewDetails(section, host, preview)

    const confirmButton = createPrimaryButton(
      host,
      'widgetEnrollConfirm',
      (event) => {
        if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
        host.setBusy(true)
        confirmButton.disabled = true
        cancelButton.disabled = true
        setHostDescription(host, host.translatedMessage('widgetEnrollWorking'))
        void host
          .sendRuntimeMessage<EnrollConfirmResponse>({
            type: 'nook:website-authenticator-enroll-confirm',
            payload: {
              origin: location.origin,
              vaultStoreId,
              otpauthUri: otpauthUri.value,
            },
          })
          .then((confirmResponse) => {
            if (confirmResponse?.ok) {
              setHostDescription(
                host,
                host.translatedMessage('widgetEnrollSaved'),
              )
            } else if (confirmResponse?.reason === 'authenticator-locked') {
              setHostDescription(host, lockedEnrollMessage(host))
            } else {
              setHostDescription(
                host,
                host.translatedMessage('widgetEnrollFailed'),
              )
            }
          })
          .finally(() => {
            clearOtpauthUri(otpauthUri)
            clearCandidate(candidate)
            host.setBusy(false)
            renderEnrollmentActions(host, detectEnrollmentHints())
          })
      },
    )

    const cancelButton = createTextButton(
      host,
      'widgetEnrollCancel',
      (event) => {
        if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
        clearOtpauthUri(otpauthUri)
        clearCandidate(candidate)
        resetEnrollmentHeadline(host, detectEnrollmentHints())
        renderEnrollmentActions(host, detectEnrollmentHints())
      },
    )

    appendButtonRow(section, [confirmButton, cancelButton])
  } finally {
    host.setBusy(false)
  }
}

function showQrCandidatePicker(
  host: EnrollmentFlowHost,
  section: HTMLElement,
  candidates: DecodedOtpauthCandidate[],
): void {
  section.replaceChildren()
  setHostDescription(host, host.translatedMessage('widgetEnrollAmbiguous'))
  const list = document.createElement('div')
  list.className = 'account-list'
  candidates.forEach((candidate) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'secondary-button account-button'
    button.textContent = candidate.sourceLabel
    button.setAttribute('aria-label', candidate.sourceLabel)
    button.addEventListener('click', (event) => {
      if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
      const uri = { value: candidate.otpauthUri }
      void showQrPreview(host, section, uri, candidate)
    })
    list.append(button)
  })
  section.append(list)
  const cancelButton = createTextButton(host, 'widgetEnrollCancel', (event) => {
    if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
    candidates.forEach((candidate) => clearCandidate(candidate))
    resetEnrollmentHeadline(host, detectEnrollmentHints())
    renderEnrollmentActions(host, detectEnrollmentHints())
  })
  section.append(cancelButton)
}

async function startQrEnrollment(
  host: EnrollmentFlowHost,
  section: HTMLElement,
): Promise<void> {
  host.title.textContent = host.translatedMessage('widgetEnrollTitle')
  setHostDescription(host, host.translatedMessage('widgetEnrollWorking'))
  host.setBusy(true)
  section.replaceChildren()

  try {
    const result = await decodeVisibleOtpauthCandidates()
    if (result.status === 'unsupported') {
      setHostDescription(
        host,
        host.translatedMessage('widgetEnrollUnsupported'),
      )
      renderEnrollmentActions(host, detectEnrollmentHints())
      return
    }
    if (result.status === 'empty') {
      setHostDescription(host, host.translatedMessage('widgetEnrollNoQr'))
      renderEnrollmentActions(host, detectEnrollmentHints())
      return
    }
    if (result.status === 'ambiguous') {
      showQrCandidatePicker(host, section, result.candidates)
      return
    }
    const candidate = result.candidates[0]
    const uri = { value: candidate?.otpauthUri ?? '' }
    if (!uri.value) {
      setHostDescription(host, host.translatedMessage('widgetEnrollNoQr'))
      renderEnrollmentActions(host, detectEnrollmentHints())
      return
    }
    await showQrPreview(host, section, uri, candidate)
  } finally {
    host.setBusy(false)
  }
}

function mergeBackupCandidates(
  existing: string[],
  incoming: string[],
): string[] {
  const merged = [...existing]
  const seen = new Set(existing)
  for (const code of incoming) {
    if (seen.has(code)) continue
    seen.add(code)
    merged.push(code)
  }
  return merged
}

function showBackupModeChooser(
  host: EnrollmentFlowHost,
  section: HTMLElement,
  account: WebsiteAuthenticatorOption,
  codes: string[],
): void {
  section.replaceChildren()
  setHostDescription(host, host.translatedMessage('widgetBackupReview'))

  const attach = (mode: 'replace' | 'merge') => {
    if (host.isBusy()) return
    host.setBusy(true)
    setHostDescription(host, host.translatedMessage('widgetBackupWorking'))
    void host
      .sendRuntimeMessage<BackupAttachResponse>({
        type: 'nook:website-authenticator-backup-attach',
        payload: {
          origin: location.origin,
          vaultStoreId: account.vaultStoreId,
          secretId: account.secretId,
          codes: [...codes],
          mode,
        },
      })
      .then((response) => {
        if (response?.ok) {
          setHostDescription(host, host.translatedMessage('widgetBackupSaved'))
        } else if (response?.reason === 'authenticator-locked') {
          setHostDescription(host, lockedBackupMessage(host))
        } else {
          setHostDescription(host, host.translatedMessage('widgetBackupFailed'))
        }
      })
      .finally(() => {
        clearBackupCodeCandidates(codes)
        host.setBusy(false)
        renderEnrollmentActions(host, detectEnrollmentHints())
      })
  }

  const replaceButton = createSecondaryButton(
    host,
    'widgetBackupModeReplace',
    (event) => {
      if (!isTrustedAuthAction(event.isTrusted)) return
      attach('replace')
    },
  )
  const mergeButton = createSecondaryButton(
    host,
    'widgetBackupModeMerge',
    (event) => {
      if (!isTrustedAuthAction(event.isTrusted)) return
      attach('merge')
    },
  )
  appendButtonRow(section, [replaceButton, mergeButton])

  const cancelButton = createTextButton(host, 'widgetBackupCancel', (event) => {
    if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
    clearBackupCodeCandidates(codes)
    resetEnrollmentHeadline(host, detectEnrollmentHints())
    renderEnrollmentActions(host, detectEnrollmentHints())
  })
  section.append(cancelButton)
}

function showBackupAuthenticatorChooser(
  host: EnrollmentFlowHost,
  section: HTMLElement,
  accounts: WebsiteAuthenticatorOption[],
  codes: string[],
): void {
  section.replaceChildren()
  setHostDescription(
    host,
    host.translatedMessage('widgetBackupChooseAuthenticator'),
  )
  const list = document.createElement('div')
  list.className = 'account-list'
  accounts.forEach((account, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'secondary-button account-button'
    button.textContent = host.translatedMessageWithSubstitution(
      'widgetSavedAuthenticator',
      safeSavedOptionNumber(index),
    )
    button.addEventListener('click', (event) => {
      if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
      showBackupModeChooser(host, section, account, codes)
    })
    list.append(button)
  })
  section.append(list)

  const cancelButton = createTextButton(host, 'widgetBackupCancel', (event) => {
    if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
    clearBackupCodeCandidates(codes)
    resetEnrollmentHeadline(host, detectEnrollmentHints())
    renderEnrollmentActions(host, detectEnrollmentHints())
  })
  section.append(cancelButton)
}

async function continueBackupWithAuthenticatorOptions(
  host: EnrollmentFlowHost,
  section: HTMLElement,
  codes: string[],
): Promise<void> {
  setHostDescription(host, host.translatedMessage('widgetBackupWorking'))
  host.setBusy(true)

  try {
    const response =
      await host.sendRuntimeMessage<AuthenticatorOptionsResponse>({
        type: 'nook:website-authenticator-options',
        payload: { origin: location.origin },
      })

    if (!response?.ok) {
      setHostDescription(host, host.translatedMessage('widgetBackupFailed'))
      renderEnrollmentActions(host, detectEnrollmentHints())
      clearBackupCodeCandidates(codes)
      return
    }

    if (response.status === 'locked') {
      setHostDescription(host, lockedBackupMessage(host))
      renderEnrollmentActions(host, detectEnrollmentHints())
      clearBackupCodeCandidates(codes)
      return
    }

    if (response.status === 'unavailable') {
      setHostDescription(host, unavailableMessage(host))
      renderEnrollmentActions(host, detectEnrollmentHints())
      clearBackupCodeCandidates(codes)
      return
    }

    const accounts = response.accounts ?? []
    if (accounts.length === 0) {
      setHostDescription(host, host.translatedMessage('widgetBackupFailed'))
      renderEnrollmentActions(host, detectEnrollmentHints())
      clearBackupCodeCandidates(codes)
      return
    }

    if (accounts.length === 1) {
      showBackupModeChooser(host, section, accounts[0], codes)
      return
    }

    showBackupAuthenticatorChooser(host, section, accounts, codes)
  } finally {
    host.setBusy(false)
  }
}

function collectSelectedBackupCodes(list: HTMLElement): string[] {
  const selected: string[] = []
  for (const row of list.children) {
    if (!(row instanceof HTMLLabelElement)) continue
    const checkbox = row.querySelector('input[type="checkbox"]')
    const text = row.querySelector('span')
    if (
      checkbox instanceof HTMLInputElement &&
      checkbox.checked &&
      text instanceof HTMLSpanElement &&
      text.textContent
    ) {
      selected.push(text.textContent)
    }
  }
  return selected
}

function showBackupReview(
  host: EnrollmentFlowHost,
  section: HTMLElement,
  codes: string[],
): void {
  section.replaceChildren()
  host.title.textContent = host.translatedMessage('widgetBackupTitle')
  setHostDescription(host, host.translatedMessage('widgetBackupReview'))

  const list = document.createElement('div')
  list.className = 'account-list'

  const renderCodeRows = (): void => {
    list.replaceChildren()
    codes.forEach((code) => {
      const row = document.createElement('label')
      row.className = 'description'
      row.style.display = 'grid'
      row.style.gridTemplateColumns = 'auto 1fr auto'
      row.style.gap = '8px'
      row.style.textAlign = 'left'

      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.checked = true

      const text = document.createElement('span')
      text.textContent = code

      const removeButton = document.createElement('button')
      removeButton.type = 'button'
      removeButton.className = 'text-button'
      removeButton.textContent = '×'
      removeButton.setAttribute(
        'aria-label',
        host.translatedMessage('widgetBackupCancel'),
      )
      removeButton.addEventListener('click', (event) => {
        if (!isTrustedAuthAction(event.isTrusted)) return
        const index = codes.indexOf(code)
        if (index >= 0) codes.splice(index, 1)
        renderCodeRows()
      })

      row.append(checkbox, text, removeButton)
      list.append(row)
    })
  }

  renderCodeRows()

  const pasteLabel = document.createElement('p')
  pasteLabel.className = 'description'
  pasteLabel.textContent = host.translatedMessage('widgetBackupPaste')

  const pasteArea = document.createElement('textarea')
  pasteArea.className = 'description'
  pasteArea.rows = 4
  pasteArea.setAttribute(
    'aria-label',
    host.translatedMessage('widgetBackupPaste'),
  )
  pasteArea.addEventListener('input', () => {
    const pasted = extractBackupCodeCandidates(pasteArea.value)
    if (pasted.length === 0) return
    const merged = mergeBackupCandidates(codes, pasted)
    codes.length = 0
    merged.forEach((code) => codes.push(code))
    pasteArea.value = ''
    renderCodeRows()
  })

  section.append(list, pasteLabel, pasteArea)

  const confirmButton = createPrimaryButton(
    host,
    'widgetBackupConfirm',
    (event) => {
      if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
      const selected = collectSelectedBackupCodes(list)
      if (selected.length === 0) {
        setHostDescription(host, host.translatedMessage('widgetBackupEmpty'))
        return
      }
      void continueBackupWithAuthenticatorOptions(host, section, selected)
    },
  )

  const cancelButton = createTextButton(host, 'widgetBackupCancel', (event) => {
    if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
    clearBackupCodeCandidates(codes)
    resetEnrollmentHeadline(host, detectEnrollmentHints())
    renderEnrollmentActions(host, detectEnrollmentHints())
  })

  appendButtonRow(section, [confirmButton, cancelButton])
}

async function startBackupEnrollment(
  host: EnrollmentFlowHost,
  section: HTMLElement,
): Promise<void> {
  host.title.textContent = host.translatedMessage('widgetBackupTitle')
  setHostDescription(host, host.translatedMessage('widgetBackupWorking'))
  host.setBusy(true)
  section.replaceChildren()

  try {
    const codes = extractBackupCodeCandidates()
    if (codes.length === 0) {
      setHostDescription(host, host.translatedMessage('widgetBackupEmpty'))
      renderEnrollmentActions(host, detectEnrollmentHints())
      return
    }
    showBackupReview(host, section, codes)
  } finally {
    host.setBusy(false)
  }
}

export function renderEnrollmentActions(
  host: EnrollmentFlowHost,
  hints: EnrollmentPageHints,
): void {
  if (!hints.qr && !hints.backupCodes) {
    clearEnrollmentSection(host.panel)
    return
  }

  const section = createEnrollmentSection(host.panel)
  const buttons: HTMLButtonElement[] = []

  if (hints.qr) {
    buttons.push(
      createSecondaryButton(host, 'widgetAddFromPage', (event) => {
        if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
        void startQrEnrollment(host, section)
      }),
    )
  }

  if (hints.backupCodes) {
    buttons.push(
      createSecondaryButton(host, 'widgetSaveBackupCodes', (event) => {
        if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
        void startBackupEnrollment(host, section)
      }),
    )
  }

  appendButtonRow(section, buttons)
}
