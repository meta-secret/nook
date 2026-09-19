export type CompactProgressStateArgs = {
  pilotLabel: string
  currentStep: number
  totalSteps: number
}

/** The visible and accessible projections of the same progress value. */
export class CompactProgressState {
  readonly badge: string
  readonly accessibleLabel: string

  constructor({
    pilotLabel,
    currentStep,
    totalSteps,
  }: CompactProgressStateArgs) {
    this.badge = `${currentStep}/${totalSteps}`
    this.accessibleLabel = `${pilotLabel} · ${this.badge}`
  }
}

type AuthenticationGestureEvidence = Pick<Event, 'isTrusted'>

/** A browser event's provenance, borrowed only for the current interaction. */
export class AuthenticationGesture {
  constructor(private readonly event: AuthenticationGestureEvidence) {}

  get trusted(): boolean {
    return this.event.isTrusted
  }
}

export enum NamecheapWidgetDisplayEligibility {
  NotNamecheap = 'not-namecheap',
  AwaitingTrustedActivation = 'awaiting-trusted-activation',
  EligibleAfterTrustedActivation = 'eligible-after-trusted-activation',
  EligibleOnAuthenticationRoute = 'eligible-on-authentication-route',
}

type NamecheapWidgetDisplayRequest = {
  readonly hostname: string
  readonly pathname: string
}

/** Owns the narrow, page-lifetime activation required by Namecheap's login drawer. */
export class NamecheapWidgetDisplayGate {
  private activation =
    NamecheapWidgetDisplayEligibility.AwaitingTrustedActivation

  observeSignInGesture(gesture: AuthenticationGesture): void {
    if (!gesture.trusted) return
    this.activation =
      NamecheapWidgetDisplayEligibility.EligibleAfterTrustedActivation
  }

  eligibility({
    hostname,
    pathname,
  }: NamecheapWidgetDisplayRequest): NamecheapWidgetDisplayEligibility {
    const isNamecheap =
      hostname === 'namecheap.com' || hostname.endsWith('.namecheap.com')
    if (!isNamecheap) return NamecheapWidgetDisplayEligibility.NotNamecheap
    if (pathname.toLowerCase().startsWith('/myaccount/login'))
      return NamecheapWidgetDisplayEligibility.EligibleOnAuthenticationRoute
    return this.activation
  }
}

/** A display-only ordinal; it never contains a saved credential. */
export class SavedOptionOrdinal {
  readonly label: string

  constructor(index: number) {
    this.label = String(index + 1)
  }
}
