import { fillOneTimeCode } from '../../../nook-web-shared/src/extension/password-forms'
import { AuthenticationOutcomeVerdict } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type {
  AuthenticationOutcomeObservationView,
  AuthenticationOutcomeVerdictView,
} from '../lib/outcome-evidence-messages'

// Multi-step QR → verify → success under CI load regularly exceeds 12s.
const ENROLLMENT_EVIDENCE_TIMEOUT_MS = 30_000
const ENROLLMENT_EVIDENCE_POLL_MS = 250

type EnrollmentOutcomeHost = {
  sendRuntimeMessage: <T>(message: unknown) => Promise<T | void>
}

type EnrollmentEvidenceCallbacks = {
  commit: () => Promise<void>
  reject: () => void
  timeout: () => void
}

type EnrollCodeResponse = {
  ok?: boolean
  code?: string
}

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

function queryDisplayedOutcomeMarker(selector: string): Element | void {
  return Array.from(document.querySelectorAll(selector)).find(
    isDisplayedOutcomeMarker,
  )
}

function collectEnrollmentOutcomeObservation(
  startedAt: number,
  authPath: string,
  sawMutation: boolean,
): AuthenticationOutcomeObservationView {
  // Only count markers that are actually shown. Soft SPA demos keep a hidden
  // success node in the document; treating that as present commits too early.
  const successMarkerPresent = Boolean(
    queryDisplayedOutcomeMarker(
      '[data-nook-auth-outcome="success"], [data-testid="mock-auth-success"]',
    ),
  )
  // Bare [role="alert"] is too broad during SPA route swaps.
  const errorMarkerPresent = Boolean(
    queryDisplayedOutcomeMarker(
      '[data-nook-auth-outcome="error"], .error[role="alert"]',
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
  host: EnrollmentOutcomeHost,
  observation: AuthenticationOutcomeObservationView,
): Promise<AuthenticationOutcomeVerdictView | void> {
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
  if (!response?.ok || !response.verdict) return
  return response.verdict
}

export async function fillStagedEnrollmentCode(
  host: EnrollmentOutcomeHost,
  stageId: string,
): Promise<boolean> {
  const response = await host.sendRuntimeMessage<EnrollCodeResponse>({
    type: 'nook:website-authenticator-enroll-code',
    payload: { origin: location.origin, stageId },
  })
  if (!response?.ok || typeof response.code !== 'string') return false
  return fillOneTimeCode(response.code)
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
  const observation = collectEnrollmentOutcomeObservation(
    watch.startedAt,
    watch.authPath,
    watch.sawMutation,
  )

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

  const verdict = await classifyEnrollmentOutcome(watch.host, observation)
  if (
    !verdict ||
    enrollmentWatchState.kind !== EnrollmentWatchStateKind.Watching ||
    enrollmentWatchState.watch.stageId !== watch.stageId
  ) {
    return
  }

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

export function beginEnrollmentEvidenceWatch(
  host: EnrollmentOutcomeHost,
  stageId: string,
  callbacks: EnrollmentEvidenceCallbacks,
): void {
  stopPendingEnrollmentWatch()
  const observer = new MutationObserver(() => {
    if (enrollmentWatchState.kind !== EnrollmentWatchStateKind.Watching) return
    enrollmentWatchState.watch.sawMutation = true
    if (stageId !== 'pending') {
      void fillStagedEnrollmentCode(host, stageId)
    }
    void evaluatePendingEnrollmentEvidence()
  })
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
  })
  const timer = window.setInterval(() => {
    if (stageId !== 'pending') {
      void fillStagedEnrollmentCode(host, stageId)
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
