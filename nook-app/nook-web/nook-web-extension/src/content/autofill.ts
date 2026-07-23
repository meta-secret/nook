export {}

import {
  fillGeneratedPassword,
  fillLoginCredentials,
  fillOneTimeCode,
  findPasskeyControl,
  readLoginCredentials,
  submitLoginForm,
  summarizeAuthenticationWorkflowForms,
} from '../../../nook-web-shared/src/extension/password-forms'
import type {
  LoginCredentials,
  PasswordFormObservation,
} from '../../../nook-web-shared/src/extension/password-forms'
import {
  isExtensionReadySetupState,
  setupStorageKey,
} from '../background/pairing-grants'
import { isWebsiteAuthenticatorSelectedMessage } from '../lib/authenticator-picker-messages'
import type { AuthenticationWorkflowSnapshotView } from '../lib/auth-workflow-messages'
import {
  compactProgressState,
  isTrustedAuthAction,
  safeSavedOptionNumber,
} from '../lib/auth-widget-policy'
import type {
  WebsiteAuthenticatorOption,
  WebsiteLoginAccountOption,
} from '../lib/login-fill-messages'
import type { WebsiteLoginSaveOfferView } from '../lib/login-save-messages'
import type {
  AuthenticationOutcomeObservationView,
  AuthenticationOutcomeVerdictView,
} from '../lib/outcome-evidence-messages'
import { isRuntimeNookVaultAppUrl } from '../lib/simple-vault-runtime'
import {
  detectEnrollmentHints,
  enrollmentCeremonyActive,
  renderEnrollmentActions,
  type EnrollmentFlowHost,
  type EnrollmentPageHints,
} from './enrollment-flow'

type PilotVaultConnection = {
  connected: boolean
  vaultName?: string
}

const WIDGET_HOST_ID = 'nook-auth-widget'
const DRAG_THRESHOLD_PX = 4
const MAX_WORKFLOW_OBSERVATIONS = 20

type WidgetPosition = {
  left: number
  top: number
}

let pendingScan: number | undefined
let scanSequence = 0
let widgetHost: HTMLElement | undefined
let renderedWorkflowKey: string | undefined
let renderedWorkflowRoot: PasswordFormObservation | undefined
let dismissed = false
let busy = false
let widgetCollapsed = false
let widgetPosition: WidgetPosition | undefined
let activeSaveOffer: WebsiteLoginSaveOfferView | undefined
let saveOfferDismissedIds = new Set<string>()
let pendingSaveWatch:
  | {
      offer: WebsiteLoginSaveOfferView
      startedAt: number
      authPath: string
      sawMutation: boolean
      timer?: number
      observer?: MutationObserver
    }
  | undefined
const OUTCOME_EVIDENCE_TIMEOUT_MS = 8_000
const OUTCOME_EVIDENCE_POLL_MS = 250

type LoginOptionsResponse = {
  ok?: boolean
  status?: 'ready' | 'locked' | 'unavailable'
  accounts?: WebsiteLoginAccountOption[]
  reason?: string
}

type LoginFillResponse = {
  ok?: boolean
  username?: string
  password?: string
  reason?: string
}

type WorkflowSnapshotResponse = {
  ok?: boolean
  snapshot?: AuthenticationWorkflowSnapshotView
  reason?: string
}

type WorkflowCopy = {
  titleKey: string
  descriptionKey: string
}

function workflowCopy(kind: string): WorkflowCopy {
  switch (kind) {
    case 'login':
      return {
        titleKey: 'widgetLoginTitle',
        descriptionKey: 'widgetLoginDescription',
      }
    case 'signup':
      return {
        titleKey: 'widgetSignupTitle',
        descriptionKey: 'widgetSignupDescription',
      }
    case 'password-change':
      return {
        titleKey: 'widgetPasswordChangeTitle',
        descriptionKey: 'widgetPasswordChangeDescription',
      }
    case 'totp-challenge':
      return {
        titleKey: 'widgetAuthenticatorTitle',
        descriptionKey: 'widgetAuthenticatorDescription',
      }
    default:
      return {
        titleKey: 'widgetManualTitle',
        descriptionKey: 'widgetManualDescription',
      }
  }
}

function progressLabel(currentStep: number, totalSteps: number): string {
  return `${translatedMessage('widgetPilotLabel')} · ${currentStep}/${totalSteps}`
}

function setFlightProgress(
  step: HTMLParagraphElement,
  title: HTMLHeadingElement,
  currentStep: number,
  totalSteps: number,
  titleKey: string,
): void {
  step.textContent = progressLabel(currentStep, totalSteps)
  title.textContent = translatedMessage(titleKey)
  const root = step.getRootNode()
  if (root instanceof ShadowRoot) {
    const compact = compactProgressState(
      translatedMessage('widgetPilotLabel'),
      currentStep,
      totalSteps,
    )
    const collapsedProgress = root.querySelector<HTMLElement>(
      '.collapsed-progress',
    )
    const collapsedLaunch =
      root.querySelector<HTMLButtonElement>('.collapsed-launch')
    if (collapsedProgress) collapsedProgress.textContent = compact.badge
    if (collapsedLaunch) {
      collapsedLaunch.setAttribute(
        'aria-label',
        `${translatedMessage('widgetExpand')}: ${compact.accessibleLabel}`,
      )
    }
  }
}

type AuthenticatorOptionsResponse = {
  ok?: boolean
  status?: 'ready' | 'locked' | 'unavailable'
  requestId?: string
}

type AuthenticatorFillResponse = {
  ok?: boolean
  code?: string
}

type PendingAuthenticatorPicker = {
  requestId: string
  workflow: PasswordFormObservation
  step: HTMLParagraphElement
  title: HTMLHeadingElement
  description: HTMLParagraphElement
  continueButton: HTMLButtonElement
}

let pendingAuthenticatorPicker: PendingAuthenticatorPicker | undefined

function translatedMessage(key: string): string {
  return chrome.i18n.getMessage(key) || 'Nook'
}

function translatedMessageWithSubstitution(
  key: string,
  substitution: string,
): string {
  return chrome.i18n.getMessage(key, substitution) || 'Nook'
}

function loadPilotVaultConnection(): Promise<PilotVaultConnection> {
  return new Promise((resolve) => {
    if (!chrome.storage?.local?.get) {
      resolve({ connected: false })
      return
    }
    chrome.storage.local.get(setupStorageKey, (items) => {
      if (chrome.runtime.lastError) {
        resolve({ connected: false })
        return
      }
      const setup = items[setupStorageKey]
      if (!isExtensionReadySetupState(setup)) {
        resolve({ connected: false })
        return
      }
      resolve({ connected: true, vaultName: setup.selectedVaultName })
    })
  })
}

function vaultConnectionLabel(connection: PilotVaultConnection): string {
  if (connection.connected && connection.vaultName) {
    return translatedMessageWithSubstitution(
      'widgetVaultConnected',
      connection.vaultName,
    )
  }
  return translatedMessage('widgetVaultNotConnected')
}

function removeWidget(): void {
  widgetHost?.remove()
  widgetHost = undefined
  renderedWorkflowKey = undefined
  renderedWorkflowRoot = undefined
  activeSaveOffer = undefined
}

type LoginSaveOfferResponse = {
  ok?: boolean
  status?: 'ready' | 'locked' | 'unavailable'
  decision?: string
  offer?: WebsiteLoginSaveOfferView
}

type LoginSavePendingResponse = {
  ok?: boolean
  offer?: WebsiteLoginSaveOfferView
}

type LoginSaveActionResponse = {
  ok?: boolean
  reason?: string
}

function stopPendingSaveWatch(): void {
  if (!pendingSaveWatch) return
  if (pendingSaveWatch.timer !== undefined) {
    window.clearInterval(pendingSaveWatch.timer)
  }
  pendingSaveWatch.observer?.disconnect()
  pendingSaveWatch = undefined
}

function pageLooksLikeAuthPath(pathname: string): boolean {
  return /(?:^|\/)(login|signin|sign-in|log-in|signup|sign-up|register|password|passwd|auth|sso|otp|2fa|mfa|verify)(?:\/|$)/i.test(
    pathname,
  )
}

function collectOutcomeObservation(
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
  const forms = summarizeAuthenticationWorkflowForms()
  const authFieldsPresent = forms.some(
    (form) =>
      form.summary.passwordFieldCount > 0 ||
      form.summary.usernameFieldCount > 0 ||
      form.summary.oneTimeCodeFieldCount > 0,
  )
  return {
    navigatedAwayFromAuthPath:
      location.pathname !== authPath ||
      !pageLooksLikeAuthPath(location.pathname),
    authFieldsPresent,
    successMarkerPresent,
    errorMarkerPresent,
    sameDocumentMutation: sawMutation,
    inIframe: window !== window.top,
    elapsedMs: Math.max(0, Date.now() - startedAt),
  }
}

async function classifyOutcomeEvidence(
  observation: AuthenticationOutcomeObservationView,
): Promise<AuthenticationOutcomeVerdictView | undefined> {
  const response = await sendRuntimeMessage<{
    ok?: boolean
    verdict?: AuthenticationOutcomeVerdictView
  }>({
    type: 'nook:authentication-outcome-classify',
    payload: {
      observation,
      timeoutMs: OUTCOME_EVIDENCE_TIMEOUT_MS,
    },
  })
  if (!response?.ok || !response.verdict) return undefined
  return response.verdict
}

async function evaluatePendingSaveEvidence(): Promise<void> {
  const watch = pendingSaveWatch
  if (!watch) return
  const observation = collectOutcomeObservation(
    watch.startedAt,
    watch.authPath,
    watch.sawMutation,
  )
  const verdict = await classifyOutcomeEvidence(observation)
  if (!verdict || pendingSaveWatch?.offer.offerId !== watch.offer.offerId) {
    return
  }
  if (verdict.allowsCredentialCommit) {
    stopPendingSaveWatch()
    if (saveOfferDismissedIds.has(watch.offer.offerId)) return
    dismissed = false
    activeSaveOffer = watch.offer
    renderSaveOfferWidget(watch.offer)
    return
  }
  if (
    verdict.name === 'conflicting' ||
    verdict.name === 'timeout' ||
    (verdict.name === 'insufficient' && observation.errorMarkerPresent)
  ) {
    stopPendingSaveWatch()
    void sendRuntimeMessage({
      type: 'nook:website-login-save-dismiss',
      payload: { origin: location.origin, offerId: watch.offer.offerId },
    })
  }
}

function beginPendingSaveWatch(offer: WebsiteLoginSaveOfferView): void {
  stopPendingSaveWatch()
  const startedAt = Date.now()
  const authPath = location.pathname
  const watch: NonNullable<typeof pendingSaveWatch> = {
    offer,
    startedAt,
    authPath,
    sawMutation: false,
  }
  watch.observer = new MutationObserver(() => {
    if (!pendingSaveWatch) return
    pendingSaveWatch.sawMutation = true
    void evaluatePendingSaveEvidence()
  })
  watch.observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
  })
  watch.timer = window.setInterval(() => {
    void evaluatePendingSaveEvidence()
  }, OUTCOME_EVIDENCE_POLL_MS)
  pendingSaveWatch = watch
  void evaluatePendingSaveEvidence()
}

async function stageSaveForCredentials(
  credentials: LoginCredentials,
): Promise<void> {
  const response = await sendRuntimeMessage<LoginSaveOfferResponse>({
    type: 'nook:website-login-save-offer',
    payload: {
      origin: location.origin,
      username: credentials.username,
      password: credentials.password,
    },
  })
  credentials.password = ''
  credentials.username = ''
  if (!response?.ok || !response.offer) return
  if (saveOfferDismissedIds.has(response.offer.offerId)) return
  beginPendingSaveWatch(response.offer)
}

function captureSubmittedLogin(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLFormElement) || busy) return
  const observations = summarizeAuthenticationWorkflowForms()
  const workflow = observations.find(
    (candidate) =>
      candidate.formScope.kind === 'owned' &&
      candidate.formScope.owner === target,
  )
  if (!workflow || workflow.summary.passwordFieldCount === 0) return
  const credentials = readLoginCredentials(workflow.root, workflow.formScope)
  if (!credentials) return
  void stageSaveForCredentials(credentials)
}

async function loadPendingSaveOffer(): Promise<
  WebsiteLoginSaveOfferView | undefined
> {
  const response = await sendRuntimeMessage<LoginSavePendingResponse>({
    type: 'nook:website-login-save-pending',
    payload: { origin: location.origin },
  })
  if (!response?.ok || !response.offer) return undefined
  if (saveOfferDismissedIds.has(response.offer.offerId)) return undefined
  return response.offer
}

function renderSaveOfferWidget(offer: WebsiteLoginSaveOfferView): void {
  removeWidget()
  activeSaveOffer = offer
  const host = document.createElement('div')
  host.id = WIDGET_HOST_ID
  host.setAttribute('data-testid', 'nook-auth-widget')
  host.setAttribute('role', 'dialog')
  host.setAttribute('aria-label', translatedMessage('widgetPilotLabel'))
  host.setAttribute('aria-expanded', 'true')
  const shadow = host.attachShadow({ mode: 'open' })

  const panel = document.createElement('div')
  panel.className = 'panel'
  panel.setAttribute('data-testid', 'nook-auth-gate')

  const toolbar = document.createElement('div')
  toolbar.className = 'toolbar'
  toolbar.setAttribute('data-testid', 'nook-auth-gate-drag')

  const step = document.createElement('p')
  step.className = 'step-label'
  step.textContent = progressLabel(4, 4)

  const dismissButton = document.createElement('button')
  dismissButton.type = 'button'
  dismissButton.className = 'icon-button dismiss-button'
  dismissButton.textContent = '×'
  dismissButton.setAttribute('aria-label', translatedMessage('widgetDismiss'))
  dismissButton.addEventListener('click', () => {
    saveOfferDismissedIds.add(offer.offerId)
    void sendRuntimeMessage({
      type: 'nook:website-login-save-dismiss',
      payload: { origin: location.origin, offerId: offer.offerId },
    })
    dismissed = true
    removeWidget()
  })
  toolbar.append(step, dismissButton)

  const body = document.createElement('div')
  body.className = 'body'

  const mark = createWidgetMark('mark', 52)

  const title = document.createElement('h1')
  title.textContent = translatedMessage(
    offer.decision === 'update'
      ? 'widgetUpdateLoginTitle'
      : 'widgetSaveLoginTitle',
  )

  const site = document.createElement('p')
  site.className = 'site-context'
  site.textContent = location.hostname

  const description = document.createElement('p')
  description.className = 'description'
  description.textContent = translatedMessage(
    offer.decision === 'update'
      ? 'widgetUpdateLoginDescription'
      : 'widgetSaveLoginDescription',
  )
  description.setAttribute('data-testid', 'nook-auth-gate-save-description')

  const saveButton = document.createElement('button')
  saveButton.type = 'button'
  saveButton.className = 'primary-button'
  saveButton.setAttribute('data-testid', 'nook-auth-gate-save')
  saveButton.textContent = translatedMessage(
    offer.decision === 'update' ? 'widgetUpdateLogin' : 'widgetSaveLogin',
  )
  saveButton.addEventListener('click', (event) => {
    if (!isTrustedAuthAction(event.isTrusted) || busy) return
    busy = true
    saveButton.disabled = true
    const evidence = collectOutcomeObservation(
      Date.now(),
      location.pathname,
      false,
    )
    // Commit re-checks the live page; require an explicit success marker now.
    evidence.successMarkerPresent = Boolean(
      document.querySelector(
        '[data-nook-auth-outcome="success"], [data-testid="mock-auth-success"]',
      ),
    )
    evidence.errorMarkerPresent = Boolean(
      document.querySelector(
        '[data-nook-auth-outcome="error"], [role="alert"]',
      ),
    )
    evidence.elapsedMs = 0
    void sendRuntimeMessage<LoginSaveActionResponse>({
      type: 'nook:website-login-save-commit',
      payload: {
        origin: location.origin,
        offerId: offer.offerId,
        evidence,
      },
    })
      .then((response) => {
        if (!response?.ok) {
          description.textContent = translatedMessage('widgetSaveLoginFailed')
          saveButton.disabled = false
          return
        }
        title.textContent = translatedMessage('widgetSaveLoginSavedTitle')
        description.textContent = translatedMessage(
          'widgetSaveLoginSavedDescription',
        )
        saveButton.hidden = true
        notNowButton.hidden = true
        activeSaveOffer = undefined
        window.setTimeout(() => {
          dismissed = false
          removeWidget()
          scheduleScan()
        }, 1200)
      })
      .finally(() => {
        busy = false
      })
  })

  const notNowButton = document.createElement('button')
  notNowButton.type = 'button'
  notNowButton.className = 'text-button'
  notNowButton.setAttribute('data-testid', 'nook-auth-gate-save-dismiss')
  notNowButton.textContent = translatedMessage('widgetSaveLoginNotNow')
  notNowButton.addEventListener('click', (event) => {
    if (!isTrustedAuthAction(event.isTrusted)) return
    saveOfferDismissedIds.add(offer.offerId)
    void sendRuntimeMessage({
      type: 'nook:website-login-save-dismiss',
      payload: { origin: location.origin, offerId: offer.offerId },
    })
    dismissed = true
    removeWidget()
  })

  body.append(mark, site, title, description, saveButton, notNowButton)

  const style = document.createElement('style')
  style.textContent = `
    :host {
      all: initial;
      position: fixed;
      z-index: 2147483647;
      top: 18px;
      right: 18px;
      color-scheme: dark;
    }
    :host(.dragging) {
      cursor: grabbing;
      user-select: none;
    }
    [hidden] { display: none !important; }
    .panel {
      width: min(292px, calc(100vw - 24px));
      border: 1px solid rgb(255 255 255 / 10%);
      border-radius: 18px;
      background: oklch(0.21 0.006 285.885);
      box-shadow: 0 18px 48px rgb(0 0 0 / 35%);
      color: oklch(0.985 0 0);
      font: 400 13px/1.35 Inter, ui-sans-serif, system-ui, sans-serif;
      overflow: hidden;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px 0;
      cursor: grab;
    }
    .step-label {
      flex: 1;
      margin: 0;
      color: oklch(0.705 0.015 286.067);
      font-size: 11px;
      font-weight: 650;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    .icon-button {
      appearance: none;
      width: 28px;
      height: 28px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: oklch(0.705 0.015 286.067);
      cursor: pointer;
      font: 700 16px/1 Inter, ui-sans-serif, system-ui, sans-serif;
    }
    .body {
      display: grid;
      gap: 10px;
      padding: 8px 18px 18px;
      justify-items: center;
      text-align: center;
    }
    .mark { display: block; }
    .site-context {
      margin: 0;
      color: oklch(0.705 0.015 286.067);
      font-size: 12px;
    }
    h1 {
      margin: 0;
      font-size: 18px;
      font-weight: 750;
      letter-spacing: -0.02em;
    }
    .description {
      margin: 0;
      color: oklch(0.85 0.01 286);
      line-height: 1.4;
    }
    button.primary-button {
      appearance: none;
      width: 100%;
      min-height: 40px;
      border-radius: 9px;
      border: 1px solid transparent;
      background: oklch(0.92 0.004 286.32);
      color: oklch(0.21 0.006 285.885);
      cursor: pointer;
      font: inherit;
      font-size: 13px;
      font-weight: 700;
      padding: 9px 12px;
    }
    button.primary-button:hover:not(:disabled) {
      background: color-mix(in oklab, oklch(0.92 0.004 286.32) 90%, black);
    }
    button:disabled { cursor: wait; opacity: 0.68; }
    .text-button {
      appearance: none;
      width: fit-content;
      margin: -4px auto 0;
      padding: 4px 8px;
      border: 0;
      background: transparent;
      color: oklch(0.705 0.015 286.067);
      cursor: pointer;
      font: 650 12px/1.2 Inter, ui-sans-serif, system-ui, sans-serif;
    }
    .text-button:hover { color: oklch(0.985 0 0); }
  `

  panel.append(toolbar, body)
  shadow.append(style, panel)
  document.documentElement.append(host)
  widgetHost = host
  renderedWorkflowKey = `save:${offer.offerId}`
  attachPointerDrag(host, toolbar)
  if (widgetPosition) {
    applyWidgetPosition(host, widgetPosition)
  }
}

function clampWidgetPosition(
  left: number,
  top: number,
  width: number,
  height: number,
): WidgetPosition {
  const margin = 8
  const maxLeft = Math.max(margin, window.innerWidth - width - margin)
  const maxTop = Math.max(margin, window.innerHeight - height - margin)
  return {
    left: Math.min(Math.max(margin, left), maxLeft),
    top: Math.min(Math.max(margin, top), maxTop),
  }
}

function applyWidgetPosition(
  host: HTMLElement,
  position: WidgetPosition,
): void {
  host.style.top = `${position.top}px`
  host.style.left = `${position.left}px`
  host.style.right = 'auto'
}

function attachPointerDrag(
  host: HTMLElement,
  handle: HTMLElement,
  options?: { onTap?: () => void },
): void {
  let pointerId: number | undefined
  let startX = 0
  let startY = 0
  let originLeft = 0
  let originTop = 0
  let dragged = false

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    const target = event.target
    if (
      target instanceof Element &&
      target.closest('button') &&
      !handle.classList.contains('collapsed-launch')
    ) {
      return
    }
    pointerId = event.pointerId
    handle.setPointerCapture(pointerId)
    const rect = host.getBoundingClientRect()
    startX = event.clientX
    startY = event.clientY
    originLeft = rect.left
    originTop = rect.top
    dragged = false
  })

  handle.addEventListener('pointermove', (event) => {
    if (pointerId === undefined || event.pointerId !== pointerId) return
    const dx = event.clientX - startX
    const dy = event.clientY - startY
    if (!dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
    dragged = true
    host.classList.add('dragging')
    widgetPosition = clampWidgetPosition(
      originLeft + dx,
      originTop + dy,
      host.offsetWidth,
      host.offsetHeight,
    )
    applyWidgetPosition(host, widgetPosition)
  })

  const endDrag = (event: PointerEvent) => {
    if (pointerId === undefined || event.pointerId !== pointerId) return
    if (handle.hasPointerCapture(pointerId)) {
      handle.releasePointerCapture(pointerId)
    }
    pointerId = undefined
    host.classList.remove('dragging')
    if (!dragged) options?.onTap?.()
  }

  handle.addEventListener('pointerup', endDrag)
  handle.addEventListener('pointercancel', endDrag)
}

function sendRuntimeMessage<T>(message: unknown): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: T | undefined) => {
      if (chrome.runtime.lastError) {
        resolve(undefined)
        return
      }
      resolve(response)
    })
  })
}

function setStatus(
  description: HTMLParagraphElement,
  continueButton: HTMLButtonElement,
  text: string,
  enableContinue: boolean,
): void {
  description.textContent = text
  continueButton.disabled = !enableContinue || busy
}

async function fillAndSubmitAccount(
  account: WebsiteLoginAccountOption,
  workflow: PasswordFormObservation,
  step: HTMLParagraphElement,
  title: HTMLHeadingElement,
  description: HTMLParagraphElement,
  continueButton: HTMLButtonElement,
): Promise<boolean> {
  const response = await sendRuntimeMessage<LoginFillResponse>({
    type: 'nook:website-login-fill',
    payload: {
      origin: location.origin,
      vaultStoreId: account.vaultStoreId,
      secretId: account.secretId,
    },
  })
  if (!response?.ok || !response.username || response.password === undefined) {
    setFlightProgress(step, title, 1, 3, 'widgetLoginTitle')
    setStatus(
      description,
      continueButton,
      translatedMessage('widgetFillFailed'),
      true,
    )
    return false
  }

  const credentials = {
    username: response.username,
    password: response.password,
  }
  response.password = ''
  const filled = fillLoginCredentials(
    credentials,
    workflow.root,
    workflow.formScope,
  )
  credentials.password = ''
  credentials.username = ''
  if (!filled) {
    setFlightProgress(step, title, 1, 3, 'widgetLoginTitle')
    setStatus(
      description,
      continueButton,
      translatedMessage('widgetFillFailed'),
      true,
    )
    return false
  }
  if (!submitLoginForm(workflow.root, workflow.formScope)) {
    setFlightProgress(step, title, 2, 3, 'widgetFillingTitle')
    description.textContent = translatedMessage('widgetFilledManual')
    continueButton.hidden = true
    return true
  }
  setFlightProgress(step, title, 3, 3, 'widgetVerifyingTitle')
  description.textContent = translatedMessage('widgetSubmitted')
  continueButton.hidden = true
  return true
}

function renderAccountChooser(
  panel: HTMLElement,
  accounts: WebsiteLoginAccountOption[],
  workflow: PasswordFormObservation,
  step: HTMLParagraphElement,
  title: HTMLHeadingElement,
  description: HTMLParagraphElement,
  continueButton: HTMLButtonElement,
  openVaultButton: HTMLButtonElement,
): void {
  continueButton.hidden = true
  openVaultButton.hidden = true
  description.textContent = translatedMessage('widgetChooseAccount')

  const list = document.createElement('div')
  list.className = 'account-list'
  accounts.forEach((account, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'secondary-button account-button'
    button.textContent = translatedMessageWithSubstitution(
      'widgetSavedLogin',
      safeSavedOptionNumber(index),
    )
    button.addEventListener('click', (event) => {
      if (!isTrustedAuthAction(event.isTrusted) || busy) return
      busy = true
      button.disabled = true
      void fillAndSubmitAccount(
        account,
        workflow,
        step,
        title,
        description,
        continueButton,
      )
        .then((submitted) => {
          if (submitted) {
            list.remove()
          } else {
            button.disabled = false
          }
        })
        .finally(() => {
          busy = false
        })
    })
    list.append(button)
  })
  panel.append(list)
}

async function generatePasswordWithNook(
  workflow: PasswordFormObservation,
  step: HTMLParagraphElement,
  title: HTMLHeadingElement,
  description: HTMLParagraphElement,
  continueButton: HTMLButtonElement,
): Promise<void> {
  if (busy) return
  busy = true
  continueButton.disabled = true
  const totalSteps = workflow.summary.currentPasswordFieldCount > 0 ? 4 : 5
  setFlightProgress(step, title, 2, totalSteps, copyTitleForWorkflow(workflow))
  setStatus(
    description,
    continueButton,
    translatedMessage('widgetGeneratePasswordWorking'),
    false,
  )
  try {
    const response = await sendRuntimeMessage<{
      ok?: boolean
      password?: string
      reason?: string
    }>({
      type: 'nook:website-generate-password',
      payload: { origin: location.origin },
    })
    if (!response?.ok || typeof response.password !== 'string') {
      setStatus(
        description,
        continueButton,
        translatedMessage('widgetGeneratePasswordFailed'),
        true,
      )
      return
    }
    const password = response.password
    const filled = fillGeneratedPassword(
      password,
      workflow.root,
      workflow.formScope,
    )
    if (!filled) {
      setStatus(
        description,
        continueButton,
        translatedMessage('widgetGeneratePasswordFailed'),
        true,
      )
      return
    }
    setStatus(
      description,
      continueButton,
      translatedMessage('widgetGeneratedPasswordFilled'),
      false,
    )
    continueButton.hidden = true
  } finally {
    busy = false
    continueButton.disabled = false
  }
}

async function proposePasskeyWithNook(
  description: HTMLParagraphElement,
  continueButton: HTMLButtonElement,
  action: 'use-passkey' | 'create-passkey',
): Promise<void> {
  if (busy) return
  busy = true
  continueButton.disabled = true
  setStatus(
    description,
    continueButton,
    translatedMessage(
      action === 'use-passkey'
        ? 'widgetUsePasskeyWorking'
        : 'widgetCreatePasskeyWorking',
    ),
    false,
  )
  try {
    const control = findPasskeyControl(document)
    if (!control) {
      setStatus(
        description,
        continueButton,
        translatedMessage('widgetPasskeyControlMissing'),
        true,
      )
      return
    }
    control.click()
    setStatus(
      description,
      continueButton,
      translatedMessage('widgetPasskeyCeremonyStarted'),
      false,
    )
    continueButton.hidden = true
  } finally {
    busy = false
    continueButton.disabled = false
  }
}

function copyTitleForWorkflow(workflow: PasswordFormObservation): string {
  if (
    workflow.summary.currentPasswordFieldCount > 0 &&
    workflow.summary.newPasswordFieldCount > 0
  ) {
    return 'widgetPasswordChangeTitle'
  }
  if (workflow.summary.newPasswordFieldCount > 0) {
    return 'widgetSignupTitle'
  }
  return 'widgetLoginTitle'
}

async function continueWithNook(
  step: HTMLParagraphElement,
  title: HTMLHeadingElement,
  description: HTMLParagraphElement,
  continueButton: HTMLButtonElement,
  openVaultButton: HTMLButtonElement,
  panel: HTMLElement,
  workflow: PasswordFormObservation,
): Promise<void> {
  if (busy) return
  busy = true
  continueButton.disabled = true
  setFlightProgress(step, title, 2, 3, 'widgetFillingTitle')
  setStatus(
    description,
    continueButton,
    translatedMessage('widgetWorking'),
    false,
  )

  try {
    const response = await sendRuntimeMessage<LoginOptionsResponse>({
      type: 'nook:website-login-options',
      payload: { origin: location.origin },
    })

    if (!response?.ok) {
      setFlightProgress(step, title, 1, 3, 'widgetLoginTitle')
      setStatus(
        description,
        continueButton,
        translatedMessage('widgetFillFailed'),
        true,
      )
      return
    }

    if (response.status === 'locked') {
      setFlightProgress(step, title, 1, 3, 'widgetLoginTitle')
      setStatus(
        description,
        continueButton,
        translatedMessage('widgetUnlockThenContinue'),
        true,
      )
      return
    }

    if (response.status === 'unavailable') {
      setFlightProgress(step, title, 1, 3, 'widgetLoginTitle')
      setStatus(
        description,
        continueButton,
        translatedMessage('widgetConnectVault'),
        true,
      )
      return
    }

    const accounts = response.accounts ?? []
    if (accounts.length === 0) {
      setFlightProgress(step, title, 1, 3, 'widgetLoginTitle')
      setStatus(
        description,
        continueButton,
        translatedMessage('widgetNoMatch'),
        true,
      )
      return
    }

    if (accounts.length === 1) {
      await fillAndSubmitAccount(
        accounts[0],
        workflow,
        step,
        title,
        description,
        continueButton,
      )
      return
    }

    renderAccountChooser(
      panel,
      accounts,
      workflow,
      step,
      title,
      description,
      continueButton,
      openVaultButton,
    )
  } finally {
    busy = false
    if (continueButton.isConnected && !continueButton.hidden) {
      continueButton.disabled = false
    }
  }
}

async function fillAuthenticatorCode(
  account: Pick<WebsiteAuthenticatorOption, 'vaultStoreId' | 'secretId'>,
  workflow: PasswordFormObservation,
  step: HTMLParagraphElement,
  title: HTMLHeadingElement,
  description: HTMLParagraphElement,
  continueButton: HTMLButtonElement,
): Promise<boolean> {
  const response = await sendRuntimeMessage<AuthenticatorFillResponse>({
    type: 'nook:website-authenticator-fill',
    payload: {
      origin: location.origin,
      vaultStoreId: account.vaultStoreId,
      secretId: account.secretId,
    },
  })
  if (!response?.ok || !response.code) {
    setFlightProgress(step, title, 2, 3, 'widgetAuthenticatorTitle')
    setStatus(
      description,
      continueButton,
      translatedMessage('widgetAuthenticatorFillFailed'),
      true,
    )
    return false
  }
  let code = response.code
  response.code = ''
  const filled = fillOneTimeCode(code, workflow.root, workflow.formScope)
  code = ''
  if (!filled) {
    setFlightProgress(step, title, 2, 3, 'widgetAuthenticatorTitle')
    setStatus(
      description,
      continueButton,
      translatedMessage('widgetAuthenticatorFillFailed'),
      true,
    )
    return false
  }
  setFlightProgress(step, title, 2, 3, 'widgetAuthenticatorTitle')
  description.textContent = translatedMessage('widgetAuthenticatorFilled')
  continueButton.hidden = true
  return true
}

async function continueWithAuthenticator(
  workflow: PasswordFormObservation,
  step: HTMLParagraphElement,
  title: HTMLHeadingElement,
  description: HTMLParagraphElement,
  continueButton: HTMLButtonElement,
): Promise<void> {
  if (busy) return
  busy = true
  continueButton.disabled = true
  setFlightProgress(step, title, 2, 3, 'widgetFillingTitle')
  setStatus(
    description,
    continueButton,
    translatedMessage('widgetAuthenticatorWorking'),
    false,
  )

  try {
    const response = await sendRuntimeMessage<AuthenticatorOptionsResponse>({
      type: 'nook:website-authenticator-picker-open',
      payload: { origin: location.origin },
    })
    if (!response?.ok) {
      setFlightProgress(step, title, 2, 3, 'widgetAuthenticatorTitle')
      setStatus(
        description,
        continueButton,
        translatedMessage('widgetAuthenticatorFillFailed'),
        true,
      )
      return
    }
    if (response.status === 'locked') {
      setFlightProgress(step, title, 2, 3, 'widgetAuthenticatorTitle')
      setStatus(
        description,
        continueButton,
        translatedMessage('widgetAuthenticatorUnlock'),
        true,
      )
      return
    }

    if (response.status === 'unavailable') {
      setFlightProgress(step, title, 2, 3, 'widgetAuthenticatorTitle')
      setStatus(
        description,
        continueButton,
        translatedMessage('widgetConnectVault'),
        true,
      )
      return
    }

    if (!response.requestId) {
      setFlightProgress(step, title, 2, 3, 'widgetAuthenticatorTitle')
      setStatus(
        description,
        continueButton,
        translatedMessage('widgetAuthenticatorFillFailed'),
        true,
      )
      return
    }
    pendingAuthenticatorPicker = {
      requestId: response.requestId,
      workflow,
      step,
      title,
      description,
      continueButton,
    }
    setFlightProgress(step, title, 2, 3, 'widgetAuthenticatorTitle')
    setStatus(
      description,
      continueButton,
      translatedMessage('widgetAuthenticatorPickerOpened'),
      true,
    )
  } finally {
    busy = false
    if (continueButton.isConnected && !continueButton.hidden) {
      continueButton.disabled = false
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (
    sender.id !== chrome.runtime.id ||
    !isWebsiteAuthenticatorSelectedMessage(message) ||
    message.payload.origin !== location.origin ||
    message.payload.requestId !== pendingAuthenticatorPicker?.requestId
  ) {
    return false
  }
  const pending = pendingAuthenticatorPicker
  pendingAuthenticatorPicker = undefined
  busy = true
  pending.continueButton.disabled = true
  void fillAuthenticatorCode(
    message.payload.account,
    pending.workflow,
    pending.step,
    pending.title,
    pending.description,
    pending.continueButton,
  ).finally(() => {
    busy = false
    if (pending.continueButton.isConnected && !pending.continueButton.hidden) {
      pending.continueButton.disabled = false
    }
  })
  return false
})

const WIDGET_PANEL_STYLES = `
    :host {
      all: initial;
      position: fixed;
      z-index: 2147483647;
      top: 18px;
      right: 18px;
      color-scheme: dark;
    }
    :host(.dragging) {
      cursor: grabbing;
      user-select: none;
    }
    [hidden] {
      display: none !important;
    }
    .panel {
      position: relative;
      width: min(320px, calc(100vw - 36px));
      display: grid;
      gap: 12px;
      padding: 14px 14px 16px;
      border: 1px solid rgb(255 255 255 / 10%);
      border-radius: 12px;
      background: oklch(0.141 0.005 285.823);
      color: oklch(0.985 0 0);
      box-shadow: 0 16px 40px rgb(0 0 0 / 35%);
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    }
    .panel.is-collapsed {
      width: auto;
      gap: 0;
      padding: 0;
      border-radius: 16px;
      background: transparent;
      border: 0;
      box-shadow: none;
    }
    .toolbar {
      display: grid;
      grid-template-columns: 1fr auto auto;
      align-items: center;
      gap: 4px;
      cursor: grab;
      touch-action: none;
      user-select: none;
    }
    :host(.dragging) .toolbar {
      cursor: grabbing;
    }
    .icon-button {
      appearance: none;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: oklch(0.705 0.015 286.067);
      cursor: pointer;
      font: inherit;
      font-size: 16px;
      line-height: 1;
      padding: 4px 8px;
    }
    .icon-button:hover { background: oklch(0.274 0.006 286.033); }
    .collapse-button { font-size: 14px; }
    .step-label {
      margin: 0;
      color: oklch(0.705 0.015 286.067);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-align: left;
      text-transform: uppercase;
    }
    .body {
      display: grid;
      gap: 12px;
    }
    .site-context {
      width: fit-content;
      max-width: 100%;
      margin: -4px auto 0;
      overflow: hidden;
      color: oklch(0.82 0.01 286);
      font-size: 11px;
      font-weight: 650;
      letter-spacing: 0.02em;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .vault-status {
      width: fit-content;
      max-width: 100%;
      margin: -8px auto 0;
      overflow: hidden;
      color: oklch(0.705 0.015 286.067);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.01em;
      text-align: center;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .vault-status[data-connected='true'] {
      color: oklch(0.82 0.04 155);
    }
    .vault-status[data-connected='false'] {
      color: oklch(0.78 0.05 70);
    }
    .mark {
      display: block;
      width: 52px;
      height: 52px;
      margin: 0 auto;
      border-radius: 12px;
      object-fit: contain;
    }
    .collapsed-launch {
      appearance: none;
      position: relative;
      display: grid;
      place-items: center;
      width: 56px;
      height: 56px;
      padding: 0;
      border: 1px solid rgb(255 255 255 / 10%);
      border-radius: 16px;
      background: oklch(0.141 0.005 285.823);
      box-shadow: 0 12px 28px rgb(0 0 0 / 35%);
      cursor: grab;
      touch-action: none;
    }
    .collapsed-launch:hover {
      background: oklch(0.21 0.006 285.885);
    }
    .collapsed-mark {
      display: block;
      width: 40px;
      height: 40px;
      border-radius: 10px;
      object-fit: contain;
      pointer-events: none;
    }
    .collapsed-progress {
      position: absolute;
      right: -4px;
      bottom: -4px;
      min-width: 24px;
      padding: 3px 5px;
      border: 1px solid rgb(255 255 255 / 18%);
      border-radius: 999px;
      background: oklch(0.274 0.006 286.033);
      color: oklch(0.985 0 0);
      font: 700 10px/1 Inter, ui-sans-serif, system-ui, sans-serif;
      pointer-events: none;
    }
    h1 {
      margin: 0;
      font-size: 18px;
      line-height: 1.25;
      text-align: center;
    }
    .description {
      margin: 0;
      color: oklch(0.705 0.015 286.067);
      font-size: 13px;
      line-height: 1.4;
      text-align: center;
    }
    .account-list {
      display: grid;
      gap: 8px;
    }
    button.primary-button,
    button.secondary-button {
      appearance: none;
      min-height: 40px;
      border-radius: 9px;
      cursor: pointer;
      font: inherit;
      font-size: 13px;
      font-weight: 700;
      padding: 9px 12px;
    }
    button:disabled {
      cursor: wait;
      opacity: 0.68;
    }
    .primary-button {
      border: 1px solid transparent;
      background: oklch(0.92 0.004 286.32);
      color: oklch(0.21 0.006 285.885);
    }
    .primary-button:hover:not(:disabled) {
      background: color-mix(in oklab, oklch(0.92 0.004 286.32) 90%, black);
    }
    .secondary-button {
      border: 1px solid rgb(255 255 255 / 10%);
      background: transparent;
      color: oklch(0.985 0 0);
    }
    .secondary-button:hover:not(:disabled) {
      background: oklch(0.274 0.006 286.033);
    }
    .text-button {
      appearance: none;
      width: fit-content;
      margin: -4px auto 0;
      padding: 4px 8px;
      border: 0;
      background: transparent;
      color: oklch(0.705 0.015 286.067);
      cursor: pointer;
      font: 650 12px/1.2 Inter, ui-sans-serif, system-ui, sans-serif;
    }
    .text-button:hover { color: oklch(0.985 0 0); }
    button:focus-visible {
      outline: 2px solid rgb(180 186 198 / 45%);
      outline-offset: 2px;
    }
  `

function buildEnrollmentFlowHost(
  panel: HTMLElement,
  step: HTMLParagraphElement,
  title: HTMLHeadingElement,
  description: HTMLParagraphElement,
  continueButton: HTMLButtonElement,
  openVaultButton: HTMLButtonElement,
): EnrollmentFlowHost {
  return {
    panel,
    step,
    title,
    description,
    continueButton,
    openVaultButton,
    setBusy: (value: boolean) => {
      busy = value
    },
    isBusy: () => busy,
    sendRuntimeMessage,
    translatedMessage,
    translatedMessageWithSubstitution,
  }
}

function enrollmentCopy(hints: EnrollmentPageHints): WorkflowCopy {
  if (hints.qr) {
    return {
      titleKey: 'widgetEnrollTitle',
      descriptionKey: 'widgetEnrollDescription',
    }
  }
  return {
    titleKey: 'widgetBackupTitle',
    descriptionKey: 'widgetBackupDescription',
  }
}

interface WidgetShell {
  host: HTMLElement
  panel: HTMLDivElement
  toolbar: HTMLDivElement
  body: HTMLDivElement
  step: HTMLParagraphElement
  title: HTMLHeadingElement
  description: HTMLParagraphElement
  continueButton: HTMLButtonElement
  openVaultButton: HTMLButtonElement
  collapseButton: HTMLButtonElement
  collapsedLaunch: HTMLButtonElement
}

function createWidgetMark(className: string, size: number): HTMLImageElement {
  const mark = document.createElement('img')
  mark.className = className
  mark.src = chrome.runtime.getURL('icons/nook.png')
  mark.alt = ''
  mark.setAttribute('aria-hidden', 'true')
  mark.width = size
  mark.height = size
  return mark
}

function createWidgetShell(
  copy: WorkflowCopy,
  vaultConnection: PilotVaultConnection,
  currentStep: number,
  totalSteps: number,
): WidgetShell {
  const host = document.createElement('aside')
  host.id = WIDGET_HOST_ID
  host.setAttribute('aria-label', translatedMessage('widgetPilotLabel'))

  const panel = document.createElement('div')
  panel.className = 'panel'
  panel.setAttribute('data-testid', 'nook-auth-gate')

  const toolbar = document.createElement('div')
  toolbar.className = 'toolbar'
  toolbar.setAttribute('data-testid', 'nook-auth-gate-drag')

  const step = document.createElement('p')
  step.className = 'step-label'
  step.textContent = progressLabel(currentStep, totalSteps)

  const collapseButton = document.createElement('button')
  collapseButton.type = 'button'
  collapseButton.className = 'icon-button collapse-button'
  collapseButton.textContent = '▾'
  collapseButton.setAttribute('aria-label', translatedMessage('widgetCollapse'))

  const dismissButton = document.createElement('button')
  dismissButton.type = 'button'
  dismissButton.className = 'icon-button dismiss-button'
  dismissButton.textContent = '×'
  dismissButton.setAttribute('aria-label', translatedMessage('widgetDismiss'))
  dismissButton.addEventListener('click', () => {
    dismissed = true
    removeWidget()
  })
  toolbar.append(step, collapseButton, dismissButton)

  const body = document.createElement('div')
  body.className = 'body'

  const mark = createWidgetMark('mark', 52)

  const title = document.createElement('h1')
  title.textContent = translatedMessage(copy.titleKey)

  const site = document.createElement('p')
  site.className = 'site-context'
  site.textContent = location.hostname

  const vaultStatus = document.createElement('p')
  vaultStatus.className = 'vault-status'
  vaultStatus.setAttribute('data-testid', 'nook-auth-gate-vault-status')
  vaultStatus.dataset.connected = vaultConnection.connected ? 'true' : 'false'
  vaultStatus.textContent = vaultConnectionLabel(vaultConnection)

  const description = document.createElement('p')
  description.className = 'description'
  description.textContent = translatedMessage(copy.descriptionKey)

  const continueButton = document.createElement('button')
  continueButton.type = 'button'
  continueButton.className = 'primary-button'

  const openVaultButton = document.createElement('button')
  openVaultButton.type = 'button'
  openVaultButton.className = 'secondary-button'
  openVaultButton.setAttribute(
    'aria-label',
    translatedMessage('widgetOpenVault'),
  )
  openVaultButton.textContent = translatedMessage('widgetOpenVault')
  openVaultButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'nook:open-simple-vault' })
  })

  body.append(
    mark,
    site,
    vaultStatus,
    title,
    description,
    continueButton,
    openVaultButton,
  )

  const collapsedLaunch = document.createElement('button')
  collapsedLaunch.type = 'button'
  collapsedLaunch.className = 'collapsed-launch'
  collapsedLaunch.setAttribute(
    'aria-label',
    `${translatedMessage('widgetExpand')}: ${progressLabel(currentStep, totalSteps)}`,
  )
  collapsedLaunch.setAttribute('data-testid', 'nook-auth-gate-expand')

  const collapsedMark = createWidgetMark('collapsed-mark', 40)
  const collapsedProgress = document.createElement('span')
  collapsedProgress.className = 'collapsed-progress'
  collapsedProgress.textContent = `${currentStep}/${totalSteps}`
  collapsedLaunch.append(collapsedMark, collapsedProgress)

  return {
    host,
    panel,
    toolbar,
    body,
    step,
    title,
    description,
    continueButton,
    openVaultButton,
    collapseButton,
    collapsedLaunch,
  }
}

function mountWidgetShell(
  shell: WidgetShell,
  workflowKey: string,
  workflowRoot: PasswordFormObservation | undefined,
): void {
  const { host, panel, toolbar, body, collapseButton, collapsedLaunch } = shell
  const applyCollapsedState = (): void => {
    panel.classList.toggle('is-collapsed', widgetCollapsed)
    collapseButton.hidden = widgetCollapsed
    toolbar.hidden = widgetCollapsed
    body.hidden = widgetCollapsed
    collapsedLaunch.hidden = !widgetCollapsed
    host.setAttribute('aria-expanded', widgetCollapsed ? 'false' : 'true')
    requestAnimationFrame(() => {
      if (!widgetPosition) return
      widgetPosition = clampWidgetPosition(
        widgetPosition.left,
        widgetPosition.top,
        host.offsetWidth,
        host.offsetHeight,
      )
      applyWidgetPosition(host, widgetPosition)
    })
  }

  collapseButton.addEventListener('click', () => {
    widgetCollapsed = true
    applyCollapsedState()
  })

  const style = document.createElement('style')
  style.textContent = WIDGET_PANEL_STYLES
  panel.append(toolbar, body, collapsedLaunch)
  host.attachShadow({ mode: 'open' }).append(style, panel)
  document.documentElement.append(host)
  widgetHost = host
  renderedWorkflowKey = workflowKey
  renderedWorkflowRoot = workflowRoot

  attachPointerDrag(host, toolbar)
  attachPointerDrag(host, collapsedLaunch, {
    onTap: () => {
      widgetCollapsed = false
      applyCollapsedState()
    },
  })
  applyCollapsedState()
  if (widgetPosition) {
    applyWidgetPosition(host, widgetPosition)
  }
}

function renderEnrollmentWidget(
  hints: EnrollmentPageHints,
  vaultConnection: PilotVaultConnection,
): void {
  if (dismissed) {
    removeWidget()
    return
  }
  const workflowKey = [
    'enrollment',
    hints.qr ? 'qr' : '',
    hints.backupCodes ? 'backup' : '',
    vaultConnection.connected ? 'connected' : 'disconnected',
    vaultConnection.vaultName ?? '',
  ].join(':')
  if (widgetHost && renderedWorkflowKey === workflowKey) {
    return
  }
  if (widgetHost) removeWidget()

  const shell = createWidgetShell(enrollmentCopy(hints), vaultConnection, 1, 1)
  const { body, step, title, description, continueButton, openVaultButton } =
    shell
  continueButton.hidden = true
  openVaultButton.hidden = true
  mountWidgetShell(shell, workflowKey, undefined)

  renderEnrollmentActions(
    buildEnrollmentFlowHost(
      body,
      step,
      title,
      description,
      continueButton,
      openVaultButton,
    ),
    hints,
  )
}

function renderWidget(
  snapshot: AuthenticationWorkflowSnapshotView,
  workflow: PasswordFormObservation,
  vaultConnection: PilotVaultConnection,
): void {
  if (dismissed) {
    removeWidget()
    return
  }
  const workflowKey = [
    snapshot.kind,
    snapshot.stage,
    snapshot.action,
    snapshot.currentStep,
    snapshot.totalSteps,
    snapshot.observationIndex,
    vaultConnection.connected ? 'connected' : 'disconnected',
    vaultConnection.vaultName ?? '',
  ].join(':')
  if (
    widgetHost &&
    renderedWorkflowKey === workflowKey &&
    renderedWorkflowRoot?.root === workflow.root &&
    renderedWorkflowRoot.formScope.kind === workflow.formScope.kind &&
    (renderedWorkflowRoot.formScope.kind !== 'owned' ||
      (workflow.formScope.kind === 'owned' &&
        renderedWorkflowRoot.formScope.owner === workflow.formScope.owner))
  ) {
    return
  }
  if (widgetHost) removeWidget()

  const shell = createWidgetShell(
    workflowCopy(snapshot.kind),
    vaultConnection,
    snapshot.currentStep,
    snapshot.totalSteps,
  )
  const { body, step, title, description, continueButton, openVaultButton } =
    shell
  const canContinueWithNook =
    snapshot.action === 'continue-with-nook' ||
    snapshot.action === 'fill-totp' ||
    snapshot.action === 'generate-password' ||
    snapshot.action === 'use-passkey' ||
    snapshot.action === 'create-passkey'
  const continueMessageKey =
    snapshot.action === 'fill-totp'
      ? 'widgetFillAuthenticator'
      : snapshot.action === 'generate-password'
        ? 'widgetGeneratePassword'
        : snapshot.action === 'use-passkey'
          ? 'widgetUsePasskey'
          : snapshot.action === 'create-passkey'
            ? 'widgetCreatePasskey'
            : canContinueWithNook
              ? 'widgetContinue'
              : 'widgetTakeOver'
  continueButton.setAttribute(
    'aria-label',
    translatedMessage(continueMessageKey),
  )
  continueButton.textContent = translatedMessage(continueMessageKey)

  continueButton.addEventListener('click', (event) => {
    if (!isTrustedAuthAction(event.isTrusted)) return
    if (!canContinueWithNook) {
      dismissed = true
      removeWidget()
      return
    }
    if (snapshot.action === 'fill-totp') {
      void continueWithAuthenticator(
        workflow,
        step,
        title,
        description,
        continueButton,
      )
    } else if (snapshot.action === 'generate-password') {
      void generatePasswordWithNook(
        workflow,
        step,
        title,
        description,
        continueButton,
      )
    } else if (
      snapshot.action === 'use-passkey' ||
      snapshot.action === 'create-passkey'
    ) {
      void proposePasskeyWithNook(description, continueButton, snapshot.action)
    } else {
      void continueWithNook(
        step,
        title,
        description,
        continueButton,
        openVaultButton,
        body,
        workflow,
      )
    }
  })

  const takeOverButton = document.createElement('button')
  takeOverButton.type = 'button'
  takeOverButton.className = 'text-button'
  takeOverButton.textContent = translatedMessage('widgetTakeOver')
  takeOverButton.hidden = !canContinueWithNook
  takeOverButton.addEventListener('click', (event) => {
    if (!isTrustedAuthAction(event.isTrusted)) return
    dismissed = true
    removeWidget()
  })

  body.append(takeOverButton)
  mountWidgetShell(shell, workflowKey, workflow)

  const enrollmentHints = detectEnrollmentHints()
  if (enrollmentHints.qr || enrollmentHints.backupCodes) {
    renderEnrollmentActions(
      buildEnrollmentFlowHost(
        body,
        step,
        title,
        description,
        continueButton,
        openVaultButton,
      ),
      enrollmentHints,
    )
  }
}

async function scanAndRender(): Promise<void> {
  if (dismissed) return
  if (enrollmentCeremonyActive()) return
  const sequence = ++scanSequence
  if (activeSaveOffer) {
    if (renderedWorkflowKey !== `save:${activeSaveOffer.offerId}`) {
      renderSaveOfferWidget(activeSaveOffer)
    }
    return
  }
  if (pendingSaveWatch) {
    void evaluatePendingSaveEvidence()
    return
  }
  const pendingOffer = await loadPendingSaveOffer()
  if (sequence !== scanSequence) return
  if (pendingOffer) {
    beginPendingSaveWatch(pendingOffer)
    return
  }
  const enrollmentHints = detectEnrollmentHints()
  // Setup material starts an enrollment ceremony. Recovery hints remain part
  // of an active OTP challenge so Rust can keep code fill as the primary action.
  if (enrollmentHints.qr) {
    const vaultConnection = await loadPilotVaultConnection()
    if (sequence !== scanSequence) return
    renderEnrollmentWidget(enrollmentHints, vaultConnection)
    return
  }
  const workflowForms = summarizeAuthenticationWorkflowForms().slice(
    0,
    MAX_WORKFLOW_OBSERVATIONS,
  )
  if (workflowForms.length === 0) {
    removeWidget()
    return
  }

  const boundedCount = (count: number) => Math.min(count, 100)
  const response = await sendRuntimeMessage<WorkflowSnapshotResponse>({
    type: 'nook:authentication-workflow-snapshot',
    payload: {
      origin: location.origin,
      observations: workflowForms.map(({ summary }) => ({
        usernameFieldCount: boundedCount(summary.usernameFieldCount),
        currentPasswordFieldCount: boundedCount(
          summary.currentPasswordFieldCount,
        ),
        newPasswordFieldCount: boundedCount(summary.newPasswordFieldCount),
        genericPasswordFieldCount: boundedCount(
          summary.genericPasswordFieldCount,
        ),
        oneTimeCodeFieldCount: boundedCount(summary.oneTimeCodeFieldCount),
        manualCheckpointPresent: summary.manualCheckpointPresent,
        authenticatorSetupHint: detectEnrollmentHints().qr,
        backupCodesHint: detectEnrollmentHints().backupCodes,
        passkeyControlPresent: summary.passkeyControlPresent,
        matchingPasskeyAccountCount: 0,
      })),
    },
  })
  if (sequence !== scanSequence) return
  if (!response?.ok || !response.snapshot) {
    removeWidget()
    return
  }
  const selected = workflowForms[response.snapshot.observationIndex]
  if (!selected) {
    removeWidget()
    return
  }
  const vaultConnection = await loadPilotVaultConnection()
  if (sequence !== scanSequence) return
  renderWidget(response.snapshot, selected, vaultConnection)
}

function scheduleScan() {
  if (pendingScan !== undefined) {
    window.clearTimeout(pendingScan)
  }

  pendingScan = window.setTimeout(() => {
    pendingScan = undefined
    void scanAndRender()
  }, 150)
}

if (!isRuntimeNookVaultAppUrl(location.href)) {
  document.addEventListener('submit', captureSubmittedLogin, true)
  void scanAndRender()

  const observer = new MutationObserver(scheduleScan)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [
      'aria-hidden',
      'autocomplete',
      'class',
      'disabled',
      'hidden',
      'id',
      'name',
      'style',
      'type',
    ],
    childList: true,
    subtree: true,
  })
}
