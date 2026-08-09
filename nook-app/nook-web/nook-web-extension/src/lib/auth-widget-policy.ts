export type CompactProgressState = {
  badge: string
  accessibleLabel: string
}

export type CompactProgressStateArgs = {
  pilotLabel: string
  currentStep: number
  totalSteps: number
}

export function compactProgressState(
  args: CompactProgressStateArgs,
): CompactProgressState {
  const { pilotLabel, currentStep, totalSteps } = args
  const badge = `${currentStep}/${totalSteps}`
  return {
    badge,
    accessibleLabel: `${pilotLabel} · ${badge}`,
  }
}

export function isTrustedAuthAction(isTrusted: boolean): boolean {
  return isTrusted
}

export function safeSavedOptionNumber(index: number): string {
  return String(index + 1)
}
