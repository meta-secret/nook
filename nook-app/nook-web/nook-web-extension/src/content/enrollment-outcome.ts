import { fillOneTimeCode } from '../../../nook-web-shared/src/extension/password-forms'
import {
  AuthenticationOutcomeResponseKind,
  AuthenticationOutcomeVerdict,
  AuthenticatorCodeResponseKind,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type {
  AuthenticationOutcomeObservationView,
  AuthenticationOutcomeResponse,
  AuthenticationOutcomeVerdictView,
} from '../lib/outcome-evidence-messages'
import { AuthenticationOutcomeClassifyMessageType } from '../lib/outcome-evidence-messages'
import { WebsiteAuthenticatorEnrollCodeMessageType } from '../lib/enrollment-messages'
import {
  RuntimeMessageDeliveryKind,
  type AuthenticatorCodeResponse,
  type RuntimeMessageDelivery,
} from './autofill/login-passkey-actions'

// Multi-step QR → verify → success under CI load regularly exceeds 12s.
const ENROLLMENT_EVIDENCE_TIMEOUT_MS = 30_000
const ENROLLMENT_EVIDENCE_POLL_MS = 250

type EnrollmentOutcomeHost = {
  sendAuthenticatorCodeRuntimeMessage: (
    message: Parameters<
      typeof import('./autofill/login-passkey-actions').sendAuthenticatorCodeRuntimeMessage
    >[0],
  ) => Promise<RuntimeMessageDelivery<AuthenticatorCodeResponse>>
  sendAuthenticationOutcomeRuntimeMessage: (
    message: Parameters<
      typeof import('./autofill/login-passkey-actions').sendAuthenticationOutcomeRuntimeMessage
    >[0],
  ) => Promise<RuntimeMessageDelivery<AuthenticationOutcomeResponse>>
}

type EnrollmentEvidenceCallbacks = {
  commit: () => Promise<void>
  reject: () => void
  timeout: () => void
}

enum EnrollmentOutcomeClassificationKind {
  Classified = 'classified',
  Unavailable = 'unavailable',
}

type EnrollmentOutcomeClassification =
  | {
      kind: EnrollmentOutcomeClassificationKind.Classified
      verdict: AuthenticationOutcomeVerdictView
    }
  | { kind: EnrollmentOutcomeClassificationKind.Unavailable }

type EnrollmentWatch = {
  stageId: string
  startedAt: number
  authPath: string
  sawMutation: boolean
  timer: number
  observer: MutationObserver
  host: EnrollmentOutcomeHost
  callbacks: EnrollmentEvidenceCallbacks
}

enum EnrollmentWatchStateKind {
  Idle = 'idle',
  Watching = 'watching',
}

type EnrollmentWatchState =
  | { kind: EnrollmentWatchStateKind.Idle }
  | { kind: EnrollmentWatchStateKind.Watching; watch: EnrollmentWatch }

let enrollmentWatchState: EnrollmentWatchState = {
  kind: EnrollmentWatchStateKind.Idle,
}

function pageLooksLikeAuthPath(pathname: string): boolean {
  return /(?:^|\/)(login|signin|sign-in|log-in|signup|sign-up|register|password|passwd|auth|sso|otp|2fa|mfa|verify|enroll)(?:\/|$)/i.test(
    pathname,
  )
}

function isDisplayedOutcomeMarker(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false
  if (element.hidden || element.getAttribute('aria-hidden') === 'true') {
    return false
  }
  const style = window.getComputedStyle(element)
  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.opacity === '0'
  ) {
    return false
  }
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function hasDisplayedOutcomeMarker(selector: string): boolean {
  return Array.from(document.querySelectorAll(selector)).some(
    isDisplayedOutcomeMarker,
  )
}

function collectEnrollmentOutcomeObservation({
  startedAt,
  authPath,
  sawMutation,
}: {
  startedAt: number
  authPath: string
  sawMutation: boolean
}): AuthenticationOutcomeObservationView {
  // Only count markers that are actually shown. Soft SPA demos keep a hidden
  // success node in the document; treating that as present commits too early.
  const successMarkerPresent = hasDisplayedOutcomeMarker(
    '[data-nook-auth-outcome="success"], [data-testid="mock-auth-success"]',
  )
  // Bare [role="alert"] is too broad during SPA route swaps.
  const errorMarkerPresent = hasDisplayedOutcomeMarker(
    '[data-nook-auth-outcome="error"], .error[role="alert"]',
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

async function classifyEnrollmentOutcome({
  host,
  observation,
}: {
  host: EnrollmentOutcomeHost
  observation: AuthenticationOutcomeObservationView
}): Promise<EnrollmentOutcomeClassification> {
  const message: Parameters<
    typeof host.sendAuthenticationOutcomeRuntimeMessage
  >[0] = {
    type: AuthenticationOutcomeClassifyMessageType.NookAuthenticationOutcomeClassify,
    payload: {
      observation,
      timeoutMs: ENROLLMENT_EVIDENCE_TIMEOUT_MS,
    },
  }
  const sendMessage: Parameters<
    typeof host.sendAuthenticationOutcomeRuntimeMessage
  >[0] = message
  const delivery =
    await host.sendAuthenticationOutcomeRuntimeMessage(sendMessage)
  if (
    delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
    delivery.response.kind !== AuthenticationOutcomeResponseKind.Completed ||
    !('verdict' in delivery.response)
  ) {
    return { kind: EnrollmentOutcomeClassificationKind.Unavailable }
  }
  return {
    kind: EnrollmentOutcomeClassificationKind.Classified,
    verdict: delivery.response.verdict,
  }
}

export async function fillStagedEnrollmentCode({
  host,
  stageId,
}: {
  host: EnrollmentOutcomeHost
  stageId: string
}): Promise<boolean> {
  const message: Parameters<
    typeof host.sendAuthenticatorCodeRuntimeMessage
  >[0] = {
    type: WebsiteAuthenticatorEnrollCodeMessageType.NookWebsiteAuthenticatorEnrollCode,
    payload: { origin: location.origin, stageId },
  }
  const delivery = await host.sendAuthenticatorCodeRuntimeMessage(message)
  if (
    delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
    delivery.response.kind !== AuthenticatorCodeResponseKind.Ready ||
    !('code' in delivery.response)
  ) {
    return false
  }
  const nookTypedArgs0_0: Parameters<typeof fillOneTimeCode>[0] = {
    code: delivery.response.code,
  }
  return fillOneTimeCode(nookTypedArgs0_0)
}

export function stopPendingEnrollmentWatch(): void {
  if (enrollmentWatchState.kind === EnrollmentWatchStateKind.Idle) return
  window.clearInterval(enrollmentWatchState.watch.timer)
  enrollmentWatchState.watch.observer.disconnect()
  enrollmentWatchState = { kind: EnrollmentWatchStateKind.Idle }
}

export function enrollmentEvidenceWatchActive(): boolean {
  return enrollmentWatchState.kind === EnrollmentWatchStateKind.Watching
}

async function evaluatePendingEnrollmentEvidence(): Promise<void> {
  if (enrollmentWatchState.kind === EnrollmentWatchStateKind.Idle) return
  const watch = enrollmentWatchState.watch
  if (watch.stageId === 'pending') return
  const nookTypedArgs0_1: Parameters<
    typeof collectEnrollmentOutcomeObservation
  >[0] = {
    startedAt: watch.startedAt,
    authPath: watch.authPath,
    sawMutation: watch.sawMutation,
  }
  const observation = collectEnrollmentOutcomeObservation(nookTypedArgs0_1)

  // Commit on clear success without depending on a service-worker roundtrip.
  if (observation.successMarkerPresent && !observation.errorMarkerPresent) {
    if (
      enrollmentWatchState.kind !== EnrollmentWatchStateKind.Watching ||
      enrollmentWatchState.watch.stageId !== watch.stageId
    ) {
      return
    }
    stopPendingEnrollmentWatch()
    await watch.callbacks.commit()
    return
  }

  // Both markers can coexist for one frame during soft SPA navigation.
  if (observation.successMarkerPresent && observation.errorMarkerPresent) {
    return
  }

  const nookTypedArgs0_2: Parameters<typeof classifyEnrollmentOutcome>[0] = {
    host: watch.host,
    observation,
  }
  const classification = await classifyEnrollmentOutcome(nookTypedArgs0_2)
  if (
    classification.kind === EnrollmentOutcomeClassificationKind.Unavailable ||
    enrollmentWatchState.kind !== EnrollmentWatchStateKind.Watching ||
    enrollmentWatchState.watch.stageId !== watch.stageId
  ) {
    return
  }
  const { verdict } = classification

  if (verdict.allowsCredentialCommit) {
    stopPendingEnrollmentWatch()
    await watch.callbacks.commit()
    return
  }

  if (
    verdict.verdict === AuthenticationOutcomeVerdict.Conflicting ||
    (verdict.verdict === AuthenticationOutcomeVerdict.Insufficient &&
      observation.errorMarkerPresent)
  ) {
    stopPendingEnrollmentWatch()
    watch.callbacks.reject()
    return
  }

  if (verdict.verdict === AuthenticationOutcomeVerdict.Timeout) {
    watch.callbacks.timeout()
  }
}

export function beginEnrollmentEvidenceWatch({
  host,
  stageId,
  callbacks,
}: {
  host: EnrollmentOutcomeHost
  stageId: string
  callbacks: EnrollmentEvidenceCallbacks
}): void {
  stopPendingEnrollmentWatch()
  const observer = new MutationObserver(() => {
    if (enrollmentWatchState.kind !== EnrollmentWatchStateKind.Watching) return
    enrollmentWatchState.watch.sawMutation = true
    if (stageId !== 'pending') {
      const nookTypedArgs0_3: Parameters<typeof fillStagedEnrollmentCode>[0] = {
        host,
        stageId,
      }
      void fillStagedEnrollmentCode(nookTypedArgs0_3)
    }
    void evaluatePendingEnrollmentEvidence()
  })
  const nookTypedArgs0_2: Parameters<typeof observer.observe>[1] = {
    childList: true,
    subtree: true,
    attributes: true,
  }
  observer.observe(document.documentElement, nookTypedArgs0_2)
  const timer = window.setInterval(() => {
    if (stageId !== 'pending') {
      const nookTypedArgs0_4: Parameters<typeof fillStagedEnrollmentCode>[0] = {
        host,
        stageId,
      }
      void fillStagedEnrollmentCode(nookTypedArgs0_4)
    }
    void evaluatePendingEnrollmentEvidence()
  }, ENROLLMENT_EVIDENCE_POLL_MS)
  const watch: EnrollmentWatch = {
    stageId,
    startedAt: Date.now(),
    authPath: location.pathname,
    sawMutation: false,
    timer,
    observer,
    host,
    callbacks,
  }
  enrollmentWatchState = { kind: EnrollmentWatchStateKind.Watching, watch }
  void evaluatePendingEnrollmentEvidence()
}
