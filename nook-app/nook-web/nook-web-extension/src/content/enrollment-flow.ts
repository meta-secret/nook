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
import { fillOneTimeCode } from '../../../nook-web-shared/src/extension/password-forms'
import type {
  AuthenticationOutcomeObservationView,
  AuthenticationOutcomeVerdictView,
} from '../lib/outcome-evidence-messages'

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

type EnrollStageResponse = {
  ok?: boolean
  stageId?: string
  reason?: string
}

type EnrollCodeResponse = {
  ok?: boolean
  code?: string
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

const ENROLLMENT_EVIDENCE_TIMEOUT_MS = 12_000
const ENROLLMENT_EVIDENCE_POLL_MS = 250

let pendingEnrollmentWatch:
  | {
      stageId: string
      vaultStoreId: string
      startedAt: number
      authPath: string
      sawMutation: boolean
      timer?: number
      observer?: MutationObserver
      host: EnrollmentFlowHost
      section: HTMLElement
    }
  | undefined

function stopPendingEnrollmentWatch(): void {
  if (!pendingEnrollmentWatch) return
  if (pendingEnrollmentWatch.timer !== undefined) {
    window.clearInterval(pendingEnrollmentWatch.timer)
  }
  pendingEnrollmentWatch.observer?.disconnect()
  pendingEnrollmentWatch = undefined
}

function pageLooksLikeAuthPath(pathname: string): boolean {
  return /(?:^|\/)(login|signin|sign-in|log-in|signup|sign-up|register|password|passwd|auth|sso|otp|2fa|mfa|verify|enroll)(?:\/|$)/i.test(
    pathname,
  )
}

function collectEnrollmentOutcomeObservation(
  startedAt: number,
  authPath: string,
  sawMutation: boolean,
): AuthenticationOutcomeObservationView {
  const successMarkerPresent = Boolean(
    document.querySelector(
      '[data-nook-auth-outcome="success"], [data-testid="mock-auth-success"]',
    ),
  )
  const errorMarkerPresent = Boolean(
    document.querySelector(
      '[data-nook-auth-outcome="error"], [role="alert"], .error[role="alert"]',
    ),
  )
  return {
    navigatedAwayFromAuthPath:
      location.pathname !== authPath ||
      !pageLooksLikeAuthPath(location.pathname),
    authFieldsPresent: Boolean(
      document.querySelector(
        'input[autocomplete~="one-time-code" i], input[type="password"], input[type="email"]',
      ),
    ),
    successMarkerPresent,
    errorMarkerPresent,
    sameDocumentMutation: sawMutation,
    inIframe: window !== window.top,
    elapsedMs: Math.max(0, Date.now() - startedAt),
  }
}

async function classifyEnrollmentOutcome(
  host: EnrollmentFlowHost,
  observation: AuthenticationOutcomeObservationView,
): Promise<AuthenticationOutcomeVerdictView | undefined> {
  const response = await host.sendRuntimeMessage<{
    ok?: boolean
    verdict?: AuthenticationOutcomeVerdictView
  }>({
    type: 'nook:authentication-outcome-classify',
    payload: {
      observation,
      timeoutMs: ENROLLMENT_EVIDENCE_TIMEOUT_MS,
    },
  })
  if (!response?.ok || !response.verdict) return undefined
  return response.verdict
}

async function fillStagedEnrollmentCode(
  host: EnrollmentFlowHost,
  stageId: string,
): Promise<boolean> {
  const response = await host.sendRuntimeMessage<EnrollCodeResponse>({
    type: 'nook:website-authenticator-enroll-code',
    payload: { origin: location.origin, stageId },
  })
  if (!response?.ok || typeof response.code !== 'string') return false
  return fillOneTimeCode(response.code)
}

async function commitStagedEnrollment(
  host: EnrollmentFlowHost,
  section: HTMLElement,
  stageId: string,
  vaultStoreId: string,
): Promise<void> {
  setHostDescription(host, host.translatedMessage('widgetEnrollWorking'))
  const confirmResponse = await host.sendRuntimeMessage<EnrollConfirmResponse>({
    type: 'nook:website-authenticator-enroll-confirm',
    payload: {
      origin: location.origin,
      vaultStoreId,
      stageId,
    },
  })
  if (confirmResponse?.ok) {
    setHostDescription(host, host.translatedMessage('widgetEnrollSaved'))
    if (detectEnrollmentHints().backupCodes) {
      renderEnrollmentActions(host, detectEnrollmentHints())
    }
  } else if (confirmResponse?.reason === 'authenticator-locked') {
    setHostDescription(host, lockedEnrollMessage(host))
  } else {
    setHostDescription(host, host.translatedMessage('widgetEnrollFailed'))
  }
  host.setBusy(false)
  section.replaceChildren()
}

async function evaluatePendingEnrollmentEvidence(): Promise<void> {
  const watch = pendingEnrollmentWatch
  if (!watch || watch.stageId === 'pending') return
  const observation = collectEnrollmentOutcomeObservation(
    watch.startedAt,
    watch.authPath,
    watch.sawMutation,
  )
  const verdict = await classifyEnrollmentOutcome(watch.host, observation)
  if (!verdict || pendingEnrollmentWatch?.stageId !== watch.stageId) return

  if (verdict.allowsCredentialCommit) {
    stopPendingEnrollmentWatch()
    await commitStagedEnrollment(
      watch.host,
      watch.section,
      watch.stageId,
      watch.vaultStoreId,
    )
    return
  }

  if (
    verdict.name === 'conflicting' ||
    verdict.name === 'timeout' ||
    (verdict.name === 'insufficient' && observation.errorMarkerPresent)
  ) {
    stopPendingEnrollmentWatch()
    void watch.host.sendRuntimeMessage({
      type: 'nook:website-authenticator-enroll-dismiss',
      payload: { origin: location.origin, stageId: watch.stageId },
    })
    setHostDescription(
      watch.host,
      watch.host.translatedMessage('widgetEnrollFailed'),
    )
    watch.host.setBusy(false)
    renderEnrollmentActions(watch.host, detectEnrollmentHints())
  }
}

function beginEnrollmentEvidenceWatch(
  host: EnrollmentFlowHost,
  section: HTMLElement,
  stageId: string,
  vaultStoreId: string,
): void {
  stopPendingEnrollmentWatch()
  const startedAt = Date.now()
  const authPath = location.pathname
  const watch: NonNullable<typeof pendingEnrollmentWatch> = {
    stageId,
    vaultStoreId,
    startedAt,
    authPath,
    sawMutation: false,
    host,
    section,
  }
  watch.observer = new MutationObserver(() => {
    if (!pendingEnrollmentWatch) return
    pendingEnrollmentWatch.sawMutation = true
    if (stageId !== 'pending') {
      void fillStagedEnrollmentCode(host, stageId)
    }
    void evaluatePendingEnrollmentEvidence()
  })
  watch.observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
  })
  watch.timer = window.setInterval(() => {
    if (stageId !== 'pending') {
      void fillStagedEnrollmentCode(host, stageId)
    }
    void evaluatePendingEnrollmentEvidence()
  }, ENROLLMENT_EVIDENCE_POLL_MS)
  pendingEnrollmentWatch = watch
  void evaluatePendingEnrollmentEvidence()
}

async function beginEnrollmentCeremony(
  host: EnrollmentFlowHost,
  section: HTMLElement,
  vaultStoreId: string,
  otpauthUri: { value: string },
  candidate: DecodedOtpauthCandidate | undefined,
): Promise<void> {
  setHostDescription(host, host.translatedMessage('widgetEnrollStaging'))
  // Arm the watch early so fill-driven mutations cannot re-scan and wipe the UI.
  beginEnrollmentEvidenceWatch(host, section, 'pending', vaultStoreId)
  const stageResponse = await host.sendRuntimeMessage<EnrollStageResponse>({
    type: 'nook:website-authenticator-enroll-stage',
    payload: {
      origin: location.origin,
      vaultStoreId,
      otpauthUri: otpauthUri.value,
    },
  })
  clearOtpauthUri(otpauthUri)
  clearCandidate(candidate)
  if (!stageResponse?.ok || typeof stageResponse.stageId !== 'string') {
    stopPendingEnrollmentWatch()
    setHostDescription(host, host.translatedMessage('widgetEnrollFailed'))
    host.setBusy(false)
    renderEnrollmentActions(host, detectEnrollmentHints())
    return
  }
  // Replace the temporary pending watch with the real stage id.
  beginEnrollmentEvidenceWatch(
    host,
    section,
    stageResponse.stageId,
    vaultStoreId,
  )

  const filled = await fillStagedEnrollmentCode(host, stageResponse.stageId)
  setHostDescription(
    host,
    host.translatedMessage(
      filled ? 'widgetEnrollVerifyFilled' : 'widgetEnrollVerifyPending',
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

export function enrollmentCeremonyActive(): boolean {
  return pendingEnrollmentWatch !== undefined
}

export function renderEnrollmentActions(
  host: EnrollmentFlowHost,
  hints: EnrollmentPageHints,
): void {
  if (enrollmentCeremonyActive()) return
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
