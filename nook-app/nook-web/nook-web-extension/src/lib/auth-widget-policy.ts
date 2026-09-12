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

/** A display-only ordinal; it never contains a saved credential. */
export class SavedOptionOrdinal {
  readonly label: string

  constructor(index: number) {
    this.label = String(index + 1)
  }
}
