import {
  BROWSER_MESSAGE_KEYS,
  type BrowserMessageKey,
} from '../lib/browser-message-keys'
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
import {
  beginEnrollmentEvidenceWatch,
  enrollmentEvidenceWatchActive,
  fillStagedEnrollmentCode,
  stopPendingEnrollmentWatch,
} from './enrollment-outcome'
import {
  RuntimeMessageDeliveryKind,
  type RuntimeMessageDelivery,
} from './autofill/login-passkey-actions'

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
  sendRuntimeMessage: <T>(
    message: unknown,
  ) => Promise<RuntimeMessageDelivery<T>>
  translatedMessage: (key: BrowserMessageKey) => string
  translatedMessageWithSubstitution: (
    key: BrowserMessageKey,
    substitution: string,
  ) => string
}

const ENROLLMENT_SECTION_CLASS = 'enrollment-actions'

enum AuthenticatorOptionsResponseStatus {
  Ready = 'ready',
  Locked = 'locked',
  Unavailable = 'unavailable',
}

type AuthenticatorOptionsResponse = {
  ok?: boolean
  status?:
    | AuthenticatorOptionsResponseStatus.Ready
    | AuthenticatorOptionsResponseStatus.Locked
    | AuthenticatorOptionsResponseStatus.Unavailable
  accounts?: WebsiteAuthenticatorOption[]
}

enum EnrollPreviewResponseStatus {
  Ready = 'ready',
  Unavailable = 'unavailable',
}

enum BackupAttachMode {
  Replace = 'replace',
  Merge = 'merge',
}

type EnrollPreviewResponse = {
  ok?: boolean
  status?:
    | EnrollPreviewResponseStatus.Ready
    | EnrollPreviewResponseStatus.Unavailable
  preview?: OtpauthEnrollmentPreview
  vaultStoreId?: string
  reason?: string
}

type EnrollStageResponse = {
  ok?: boolean
  stageId?: string
  reason?: string
}

type EnrollConfirmResponse = {
  ok?: boolean
  secretId?: string
  reason?: string
}

type BackupAttachResponse = {
  ok?: boolean
  reason?: string
}

/** Keep the post-save enrollment widget from being rebuilt by scanAndRender. */
let holdEnrollmentWidgetAfterSave = false

async function commitStagedEnrollment(
  host: EnrollmentFlowHost,
  section: HTMLElement,
  stageId: string,
  vaultStoreId: string,
): Promise<void> {
  setHostDescription(
    host,
    host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollWorking),
  )
  const confirmDelivery = await host.sendRuntimeMessage<EnrollConfirmResponse>({
    type: 'nook:website-authenticator-enroll-confirm',
    payload: {
      origin: location.origin,
      vaultStoreId,
      stageId,
    },
  })
  if (
    confirmDelivery.kind === RuntimeMessageDeliveryKind.Delivered &&
    confirmDelivery.response.ok
  ) {
    setHostDescription(
      host,
      host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollSaved),
    )
    if (detectEnrollmentHints().backupCodes) {
      renderEnrollmentActions(host, detectEnrollmentHints())
    }
    // Success pages often mention backup codes; without this hold, the next
    // MutationObserver scan rebuilds the enrollment CTA and wipes the saved
    // confirmation before the user (or e2e) can observe it.
    holdEnrollmentWidgetAfterSave = true
  } else if (
    confirmDelivery.kind === RuntimeMessageDeliveryKind.Delivered &&
    confirmDelivery.response.reason === 'authenticator-locked'
  ) {
    setHostDescription(host, lockedEnrollMessage(host))
  } else {
    setHostDescription(
      host,
      host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollFailed),
    )
  }
  host.setBusy(false)
  section.replaceChildren()
}

function enrollmentEvidenceCallbacks(
  host: EnrollmentFlowHost,
  section: HTMLElement,
  stageId: string,
  vaultStoreId: string,
) {
  return {
    commit: () => commitStagedEnrollment(host, section, stageId, vaultStoreId),
    reject: () => {
      void host.sendRuntimeMessage({
        type: 'nook:website-authenticator-enroll-dismiss',
        payload: { origin: location.origin, stageId },
      })
      setHostDescription(
        host,
        host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollFailed),
      )
      host.setBusy(false)
      renderEnrollmentActions(host, detectEnrollmentHints())
    },
    timeout: () => {
      // Keep the staged secret; ask the user to finish verification or cancel.
      setHostDescription(
        host,
        host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollVerifyPending),
      )
    },
  }
}

async function beginEnrollmentCeremony(
  host: EnrollmentFlowHost,
  section: HTMLElement,
  vaultStoreId: string,
  otpauthUri: { value: string },
  candidate: DecodedOtpauthCandidate,
): Promise<void> {
  holdEnrollmentWidgetAfterSave = false
  setHostDescription(
    host,
    host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollStaging),
  )
  // Arm the watch early so fill-driven mutations cannot re-scan and wipe the UI.
  beginEnrollmentEvidenceWatch(
    host,
    'pending',
    enrollmentEvidenceCallbacks(host, section, 'pending', vaultStoreId),
  )
  const stageDelivery = await host.sendRuntimeMessage<EnrollStageResponse>({
    type: 'nook:website-authenticator-enroll-stage',
    payload: {
      origin: location.origin,
      vaultStoreId,
      otpauthUri: otpauthUri.value,
    },
  })
  clearOtpauthUri(otpauthUri)
  clearCandidate(candidate)
  if (stageDelivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
    stopPendingEnrollmentWatch()
    setHostDescription(
      host,
      host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollFailed),
    )
    host.setBusy(false)
    renderEnrollmentActions(host, detectEnrollmentHints())
    return
  }
  const { response: stageResponse } = stageDelivery
  const stageId = stageResponse.stageId
  if (stageResponse.ok !== true || typeof stageId !== 'string') {
    stopPendingEnrollmentWatch()
    setHostDescription(
      host,
      host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollFailed),
    )
    host.setBusy(false)
    renderEnrollmentActions(host, detectEnrollmentHints())
    return
  }
  // Replace the temporary pending watch with the real stage id.
  beginEnrollmentEvidenceWatch(
    host,
    stageId,
    enrollmentEvidenceCallbacks(host, section, stageId, vaultStoreId),
  )

  const filled = await fillStagedEnrollmentCode(host, stageId)
  setHostDescription(
    host,
    host.translatedMessage(
      filled
        ? 'widgetEnrollVerifyFilled'
        : BROWSER_MESSAGE_KEYS.WidgetEnrollVerifyPending,
    ),
  )
  section.replaceChildren()
  const cancelButton = createTextButton(host, 'widgetEnrollCancel', (event) => {
    if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
    stopPendingEnrollmentWatch()
    void host.sendRuntimeMessage({
      type: 'nook:website-authenticator-enroll-dismiss',
      payload: {
        origin: location.origin,
        stageId: stageResponse.stageId,
      },
    })
    resetEnrollmentHeadline(host, detectEnrollmentHints())
    renderEnrollmentActions(host, detectEnrollmentHints())
  })
  section.append(cancelButton)
  host.setBusy(false)
}

function resetEnrollmentHeadline(
  host: EnrollmentFlowHost,
  hints: EnrollmentPageHints,
): void {
  const titleKey = hints.qr
    ? BROWSER_MESSAGE_KEYS.WidgetEnrollTitle
    : BROWSER_MESSAGE_KEYS.WidgetBackupTitle
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

function clearCandidate(candidate: DecodedOtpauthCandidate): void {
  clearOtpauthCandidate(candidate)
}

function unavailableMessage(host: EnrollmentFlowHost): string {
  return host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetConnectVault)
}

function lockedEnrollMessage(host: EnrollmentFlowHost): string {
  return host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollUnlock)
}

function lockedBackupMessage(host: EnrollmentFlowHost): string {
  return host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollUnlock)
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
  candidate: DecodedOtpauthCandidate,
): Promise<void> {
  section.replaceChildren()
  host.title.textContent = host.translatedMessage(
    BROWSER_MESSAGE_KEYS.WidgetEnrollPreview,
  )
  setHostDescription(
    host,
    host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollWorking),
  )
  host.setBusy(true)

  try {
    const delivery = await host.sendRuntimeMessage<EnrollPreviewResponse>({
      type: 'nook:website-authenticator-enroll-preview',
      payload: {
        origin: location.origin,
        otpauthUri: otpauthUri.value,
      },
    })

    if (
      delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
      !delivery.response?.ok
    ) {
      setHostDescription(
        host,
        host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollFailed),
      )
      renderEnrollmentActions(host, detectEnrollmentHints())
      clearOtpauthUri(otpauthUri)
      clearCandidate(candidate)
      return
    }
    const { response } = delivery

    if (response.status === EnrollPreviewResponseStatus.Unavailable) {
      setHostDescription(host, unavailableMessage(host))
      renderEnrollmentActions(host, detectEnrollmentHints())
      clearOtpauthUri(otpauthUri)
      clearCandidate(candidate)
      return
    }

    const preview = response.preview
    const vaultStoreId = response.vaultStoreId
    if (!preview || !vaultStoreId) {
      setHostDescription(
        host,
        host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollFailed),
      )
      renderEnrollmentActions(host, detectEnrollmentHints())
      clearOtpauthUri(otpauthUri)
      clearCandidate(candidate)
      return
    }

    setHostDescription(
      host,
      host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollPreview),
    )
    renderPreviewDetails(section, host, preview)

    const confirmButton = createPrimaryButton(
      host,
      'widgetEnrollConfirm',
      (event) => {
        if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
        host.setBusy(true)
        confirmButton.disabled = true
        cancelButton.disabled = true
        void beginEnrollmentCeremony(
          host,
          section,
          vaultStoreId,
          otpauthUri,
          candidate,
        )
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
  setHostDescription(
    host,
    host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollAmbiguous),
  )
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
  host.title.textContent = host.translatedMessage(
    BROWSER_MESSAGE_KEYS.WidgetEnrollTitle,
  )
  setHostDescription(
    host,
    host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollWorking),
  )
  host.setBusy(true)
  section.replaceChildren()

  try {
    const result = await decodeVisibleOtpauthCandidates()
    if (result.status === 'unsupported') {
      setHostDescription(
        host,
        host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollUnsupported),
      )
      renderEnrollmentActions(host, detectEnrollmentHints())
      return
    }
    if (result.status === 'empty') {
      setHostDescription(
        host,
        host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollNoQr),
      )
      renderEnrollmentActions(host, detectEnrollmentHints())
      return
    }
    if (result.status === 'ambiguous') {
      showQrCandidatePicker(host, section, result.candidates)
      return
    }
    const candidate = result.candidates[0]
    if (!candidate || !candidate.otpauthUri) {
      setHostDescription(
        host,
        host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollNoQr),
      )
      renderEnrollmentActions(host, detectEnrollmentHints())
      return
    }
    const uri = { value: candidate.otpauthUri }
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
  setHostDescription(
    host,
    host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetBackupReview),
  )

  const attach = (mode: BackupAttachMode) => {
    if (host.isBusy()) return
    host.setBusy(true)
    setHostDescription(
      host,
      host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetBackupWorking),
    )
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
      .then((delivery) => {
        if (
          delivery.kind === RuntimeMessageDeliveryKind.Delivered &&
          delivery.response?.ok
        ) {
          setHostDescription(
            host,
            host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetBackupSaved),
          )
        } else if (
          delivery.kind === RuntimeMessageDeliveryKind.Delivered &&
          delivery.response?.reason === 'authenticator-locked'
        ) {
          setHostDescription(host, lockedBackupMessage(host))
        } else {
          setHostDescription(
            host,
            host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetBackupFailed),
          )
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
      attach(BackupAttachMode.Replace)
    },
  )
  const mergeButton = createSecondaryButton(
    host,
    'widgetBackupModeMerge',
    (event) => {
      if (!isTrustedAuthAction(event.isTrusted)) return
      attach(BackupAttachMode.Merge)
    },
  )
  appendButtonRow(section, [replaceButton, mergeButton])

  const cancelButton = createTextButton(
    host,
    BROWSER_MESSAGE_KEYS.WidgetBackupCancel,
    (event) => {
      if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
      clearBackupCodeCandidates(codes)
      resetEnrollmentHeadline(host, detectEnrollmentHints())
      renderEnrollmentActions(host, detectEnrollmentHints())
    },
  )
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
    host.translatedMessage(
      BROWSER_MESSAGE_KEYS.WidgetBackupChooseAuthenticator,
    ),
  )
  const list = document.createElement('div')
  list.className = 'account-list'
  accounts.forEach((account, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'secondary-button account-button'
    button.textContent = host.translatedMessageWithSubstitution(
      BROWSER_MESSAGE_KEYS.WidgetSavedAuthenticator,
      safeSavedOptionNumber(index),
    )
    button.addEventListener('click', (event) => {
      if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
      showBackupModeChooser(host, section, account, codes)
    })
    list.append(button)
  })
  section.append(list)

  const cancelButton = createTextButton(
    host,
    BROWSER_MESSAGE_KEYS.WidgetBackupCancel,
    (event) => {
      if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
      clearBackupCodeCandidates(codes)
      resetEnrollmentHeadline(host, detectEnrollmentHints())
      renderEnrollmentActions(host, detectEnrollmentHints())
    },
  )
  section.append(cancelButton)
}

async function continueBackupWithAuthenticatorOptions(
  host: EnrollmentFlowHost,
  section: HTMLElement,
  codes: string[],
): Promise<void> {
  setHostDescription(
    host,
    host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetBackupWorking),
  )
  host.setBusy(true)

  try {
    const delivery =
      await host.sendRuntimeMessage<AuthenticatorOptionsResponse>({
        type: 'nook:website-authenticator-options',
        payload: { origin: location.origin },
      })

    if (
      delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
      !delivery.response?.ok
    ) {
      setHostDescription(
        host,
        host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetBackupFailed),
      )
      renderEnrollmentActions(host, detectEnrollmentHints())
      clearBackupCodeCandidates(codes)
      return
    }
    const { response } = delivery

    if (response.status === AuthenticatorOptionsResponseStatus.Locked) {
      setHostDescription(host, lockedBackupMessage(host))
      renderEnrollmentActions(host, detectEnrollmentHints())
      clearBackupCodeCandidates(codes)
      return
    }

    if (response.status === AuthenticatorOptionsResponseStatus.Unavailable) {
      setHostDescription(host, unavailableMessage(host))
      renderEnrollmentActions(host, detectEnrollmentHints())
      clearBackupCodeCandidates(codes)
      return
    }

    const accounts = response.accounts ?? []
    if (accounts.length === 0) {
      setHostDescription(
        host,
        host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetBackupFailed),
      )
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
  host.title.textContent = host.translatedMessage(
    BROWSER_MESSAGE_KEYS.WidgetBackupTitle,
  )
  setHostDescription(
    host,
    host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetBackupReview),
  )

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
        host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetBackupCancel),
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
  pasteLabel.textContent = host.translatedMessage(
    BROWSER_MESSAGE_KEYS.WidgetBackupPaste,
  )

  const pasteArea = document.createElement('textarea')
  pasteArea.className = 'description'
  pasteArea.rows = 4
  pasteArea.setAttribute(
    'aria-label',
    host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetBackupPaste),
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
        setHostDescription(
          host,
          host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetBackupEmpty),
        )
        return
      }
      void continueBackupWithAuthenticatorOptions(host, section, selected)
    },
  )

  const cancelButton = createTextButton(
    host,
    BROWSER_MESSAGE_KEYS.WidgetBackupCancel,
    (event) => {
      if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
      clearBackupCodeCandidates(codes)
      resetEnrollmentHeadline(host, detectEnrollmentHints())
      renderEnrollmentActions(host, detectEnrollmentHints())
    },
  )

  appendButtonRow(section, [confirmButton, cancelButton])
}

async function startBackupEnrollment(
  host: EnrollmentFlowHost,
  section: HTMLElement,
): Promise<void> {
  host.title.textContent = host.translatedMessage(
    BROWSER_MESSAGE_KEYS.WidgetBackupTitle,
  )
  setHostDescription(
    host,
    host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetBackupWorking),
  )
  host.setBusy(true)
  section.replaceChildren()

  try {
    const codes = extractBackupCodeCandidates()
    if (codes.length === 0) {
      setHostDescription(
        host,
        host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetBackupEmpty),
      )
      renderEnrollmentActions(host, detectEnrollmentHints())
      return
    }
    showBackupReview(host, section, codes)
  } finally {
    host.setBusy(false)
  }
}

export function enrollmentCeremonyActive(): boolean {
  return enrollmentEvidenceWatchActive() || holdEnrollmentWidgetAfterSave
}

export function releaseEnrollmentWidgetHold(): void {
  holdEnrollmentWidgetAfterSave = false
}

export function renderEnrollmentActions(
  host: EnrollmentFlowHost,
  hints: EnrollmentPageHints,
): void {
  if (enrollmentEvidenceWatchActive()) return
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
        releaseEnrollmentWidgetHold()
        void startQrEnrollment(host, section)
      }),
    )
  }

  if (hints.backupCodes) {
    buttons.push(
      createSecondaryButton(host, 'widgetSaveBackupCodes', (event) => {
        if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
        releaseEnrollmentWidgetHold()
        void startBackupEnrollment(host, section)
      }),
    )
  }

  appendButtonRow(section, buttons)
}
