import { BROWSER_MESSAGE_KEYS } from '../../lib/browser-message-keys'
import type { LoginCredentials } from '../../../../nook-web-shared/src/extension/password-forms'
import {
  LoginCredentialsLookupKind,
  readLoginCredentials,
  summarizeAuthenticationWorkflowForms,
} from '../../../../nook-web-shared/src/extension/password-forms'
import { AuthenticationOutcomeVerdict } from '../../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { isTrustedAuthAction } from '../../lib/auth-widget-policy'
import {
  NookWebsiteLoginSaveDecision,
  WebsiteLoginSavePendingState,
  type WebsiteLoginSaveOfferView,
  type WebsiteLoginSavePendingResponse,
} from '../../lib/login-save-messages'
import type {
  AuthenticationOutcomeObservationView,
  AuthenticationOutcomeVerdictView,
} from '../../lib/outcome-evidence-messages'
import {
  RuntimeMessageDeliveryKind,
  sendRuntimeMessage,
} from './login-passkey-actions'
import {
  SavePageWatchKind,
  WidgetPlacementKind,
  saveOfferState,
  scanState,
  widgetState,
  type PendingSaveWatch,
} from './state'
import { applyWidgetPosition, attachPointerDrag } from './widget-position'
import { createWidgetMark } from './widget-shell'
import {
  OUTCOME_EVIDENCE_POLL_MS,
  OUTCOME_EVIDENCE_TIMEOUT_MS,
  WIDGET_HOST_ID,
  progressLabel,
  removeWidget,
  translatedMessage,
} from './workflow-ui'

enum LoginSaveOfferResponseStatus {
  Ready = 'ready',
  Locked = 'locked',
  Unavailable = 'unavailable',
}

type LoginSaveOfferResponse = {
  ok?: boolean
  status?:
    | LoginSaveOfferResponseStatus.Ready
    | LoginSaveOfferResponseStatus.Locked
    | LoginSaveOfferResponseStatus.Unavailable
  decision?: NookWebsiteLoginSaveDecision
  offer?: WebsiteLoginSaveOfferView
}

type LoginSaveActionResponse = {
  ok?: boolean
  reason?: string
}

enum AuthenticationOutcomeReadKind {
  Available = 'available',
  Unavailable = 'unavailable',
}

type AuthenticationOutcomeRead =
  | {
      kind: AuthenticationOutcomeReadKind.Available
      verdict: AuthenticationOutcomeVerdictView
    }
  | { kind: AuthenticationOutcomeReadKind.Unavailable }

function stopPendingSaveWatch(): void {
  if (saveOfferState.watch.kind === SavePageWatchKind.Idle) return
  const { watch } = saveOfferState.watch
  if ('timer' in watch) {
    window.clearInterval(watch.timer)
  }
  watch.observer?.disconnect()
  saveOfferState.clearPendingWatch()
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
): Promise<AuthenticationOutcomeRead> {
  const delivery = await sendRuntimeMessage<{
    ok?: boolean
    verdict?: AuthenticationOutcomeVerdictView
  }>({
    type: 'nook:authentication-outcome-classify',
    payload: {
      observation,
      timeoutMs: OUTCOME_EVIDENCE_TIMEOUT_MS,
    },
  })
  if (
    delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
    !delivery.response?.ok ||
    !delivery.response.verdict
  ) {
    return { kind: AuthenticationOutcomeReadKind.Unavailable }
  }
  return {
    kind: AuthenticationOutcomeReadKind.Available,
    verdict: delivery.response.verdict,
  }
}

export async function evaluatePendingSaveEvidence(): Promise<void> {
  if (saveOfferState.watch.kind === SavePageWatchKind.Idle) return
  const { watch } = saveOfferState.watch
  const observation = collectOutcomeObservation(
    watch.startedAt,
    watch.authPath,
    watch.sawMutation,
  )
  const verdictRead = await classifyOutcomeEvidence(observation)
  if (
    verdictRead.kind === AuthenticationOutcomeReadKind.Unavailable ||
    saveOfferState.watch.kind !== SavePageWatchKind.Watching ||
    saveOfferState.watch.watch.offer.offerId !== watch.offer.offerId
  ) {
    return
  }
  const { verdict } = verdictRead
  if (verdict.allowsCredentialCommit) {
    stopPendingSaveWatch()
    if (saveOfferState.dismissedOfferIds.has(watch.offer.offerId)) return
    widgetState.dismissed = false
    saveOfferState.showOffer(watch.offer)
    renderSaveOfferWidget(watch.offer)
    return
  }
  if (
    verdict.verdict === AuthenticationOutcomeVerdict.Conflicting ||
    verdict.verdict === AuthenticationOutcomeVerdict.Timeout ||
    (verdict.verdict === AuthenticationOutcomeVerdict.Insufficient &&
      observation.errorMarkerPresent)
  ) {
    stopPendingSaveWatch()
    void sendRuntimeMessage({
      type: 'nook:website-login-save-dismiss',
      payload: { origin: location.origin, offerId: watch.offer.offerId },
    })
  }
}

export function beginPendingSaveWatch(offer: WebsiteLoginSaveOfferView): void {
  stopPendingSaveWatch()
  const startedAt = Date.now()
  const authPath = location.pathname
  const watch: PendingSaveWatch = {
    offer,
    startedAt,
    authPath,
    sawMutation: false,
  }
  watch.observer = new MutationObserver(() => {
    if (saveOfferState.watch.kind === SavePageWatchKind.Idle) return
    saveOfferState.watch.watch.sawMutation = true
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
  saveOfferState.watchPage(watch)
  void evaluatePendingSaveEvidence()
}

async function stageSaveForCredentials(
  credentials: LoginCredentials,
): Promise<void> {
  const delivery = await sendRuntimeMessage<LoginSaveOfferResponse>({
    type: 'nook:website-login-save-offer',
    payload: {
      origin: location.origin,
      username: credentials.username,
      password: credentials.password,
    },
  })
  credentials.password = ''
  credentials.username = ''
  if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
    return
  }
  const { response } = delivery
  const offer = response.offer
  if (response.ok !== true || !offer) return
  if (saveOfferState.dismissedOfferIds.has(offer.offerId)) return
  beginPendingSaveWatch(offer)
}

export function captureSubmittedLogin(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLFormElement) || widgetState.busy) return
  const observations = summarizeAuthenticationWorkflowForms()
  const workflow = observations.find(
    (candidate) =>
      candidate.formScope.kind === 'owned' &&
      candidate.formScope.owner === target,
  )
  if (!workflow || workflow.summary.passwordFieldCount === 0) return
  const credentials = readLoginCredentials(workflow.root, workflow.formScope)
  if (credentials.kind === LoginCredentialsLookupKind.Absent) return
  void stageSaveForCredentials(credentials.credentials)
}

export enum PendingSaveOfferLoadKind {
  Absent = 'absent',
  Loaded = 'loaded',
}

export type PendingSaveOfferLoad =
  | { kind: PendingSaveOfferLoadKind.Absent }
  | { kind: PendingSaveOfferLoadKind.Loaded; offer: WebsiteLoginSaveOfferView }

export async function loadPendingSaveOffer(): Promise<PendingSaveOfferLoad> {
  const delivery = await sendRuntimeMessage<WebsiteLoginSavePendingResponse>({
    type: 'nook:website-login-save-pending',
    payload: { origin: location.origin },
  })
  if (
    delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
    !delivery.response?.ok ||
    delivery.response.state !== WebsiteLoginSavePendingState.Available
  )
    return { kind: PendingSaveOfferLoadKind.Absent }
  const { response } = delivery
  if (saveOfferState.dismissedOfferIds.has(response.offer.offerId)) {
    return { kind: PendingSaveOfferLoadKind.Absent }
  }
  return { kind: PendingSaveOfferLoadKind.Loaded, offer: response.offer }
}

export function renderSaveOfferWidget(offer: WebsiteLoginSaveOfferView): void {
  removeWidget()
  saveOfferState.showOffer(offer)
  const host = document.createElement('div')
  host.id = WIDGET_HOST_ID
  host.setAttribute('data-testid', 'nook-auth-widget')
  host.setAttribute('role', 'dialog')
  host.setAttribute(
    'aria-label',
    translatedMessage(BROWSER_MESSAGE_KEYS.WidgetPilotLabel),
  )
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
  dismissButton.setAttribute(
    'aria-label',
    translatedMessage(BROWSER_MESSAGE_KEYS.WidgetDismiss),
  )
  dismissButton.addEventListener('click', () => {
    saveOfferState.dismissedOfferIds.add(offer.offerId)
    void sendRuntimeMessage({
      type: 'nook:website-login-save-dismiss',
      payload: { origin: location.origin, offerId: offer.offerId },
    })
    widgetState.dismissed = true
    removeWidget()
  })
  toolbar.append(step, dismissButton)

  const body = document.createElement('div')
  body.className = 'body'

  const mark = createWidgetMark('mark', 52)

  const title = document.createElement('h1')
  title.textContent = translatedMessage(
    offer.decision === NookWebsiteLoginSaveDecision.Update
      ? BROWSER_MESSAGE_KEYS.WidgetUpdateLoginTitle
      : BROWSER_MESSAGE_KEYS.WidgetSaveLoginTitle,
  )

  const site = document.createElement('p')
  site.className = 'site-context'
  site.textContent = location.hostname

  const description = document.createElement('p')
  description.className = 'description'
  description.textContent = translatedMessage(
    offer.decision === NookWebsiteLoginSaveDecision.Update
      ? BROWSER_MESSAGE_KEYS.WidgetUpdateLoginDescription
      : BROWSER_MESSAGE_KEYS.WidgetSaveLoginDescription,
  )
  description.setAttribute('data-testid', 'nook-auth-gate-save-description')

  const saveButton = document.createElement('button')
  saveButton.type = 'button'
  saveButton.className = 'primary-button'
  saveButton.setAttribute('data-testid', 'nook-auth-gate-save')
  saveButton.textContent = translatedMessage(
    offer.decision === NookWebsiteLoginSaveDecision.Update
      ? BROWSER_MESSAGE_KEYS.WidgetUpdateLogin
      : BROWSER_MESSAGE_KEYS.WidgetSaveLogin,
  )
  saveButton.addEventListener('click', (event) => {
    if (!isTrustedAuthAction(event.isTrusted) || widgetState.busy) return
    widgetState.busy = true
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
      .then((delivery) => {
        if (
          delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
          !delivery.response?.ok
        ) {
          description.textContent = translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetSaveLoginFailed,
          )
          saveButton.disabled = false
          return
        }
        title.textContent = translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetSaveLoginSavedTitle,
        )
        title.setAttribute('data-testid', 'nook-auth-gate-save-saved')
        description.textContent = translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetSaveLoginSavedDescription,
        )
        saveButton.hidden = true
        notNowButton.hidden = true
        saveOfferState.clearActiveOffer()
        // Hold confirmation through the dismiss window so formless success
        // pages cannot scan-away "Login saved" before the user sees it.
        saveOfferState.confirmationActive = true
        window.setTimeout(() => {
          widgetState.dismissed = false
          removeWidget()
          scanState.schedule()
        }, 1200)
      })
      .finally(() => {
        widgetState.busy = false
      })
  })

  const notNowButton = document.createElement('button')
  notNowButton.type = 'button'
  notNowButton.className = 'text-button'
  notNowButton.setAttribute('data-testid', 'nook-auth-gate-save-dismiss')
  notNowButton.textContent = translatedMessage(
    BROWSER_MESSAGE_KEYS.WidgetSaveLoginNotNow,
  )
  notNowButton.addEventListener('click', (event) => {
    if (!isTrustedAuthAction(event.isTrusted)) return
    saveOfferState.dismissedOfferIds.add(offer.offerId)
    void sendRuntimeMessage({
      type: 'nook:website-login-save-dismiss',
      payload: { origin: location.origin, offerId: offer.offerId },
    })
    widgetState.dismissed = true
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
  widgetState.attachHost(host)
  widgetState.assignWorkflowKey(`save:${offer.offerId}`)
  attachPointerDrag(host, toolbar)
  if (widgetState.placement.kind === WidgetPlacementKind.Positioned) {
    applyWidgetPosition(host, widgetState.placement.position)
  }
}
