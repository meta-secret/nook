export type CompactProgressState = {
  badge: string
  accessibleLabel: string
}

export function compactProgressState(
  pilotLabel: string,
  currentStep: number,
  totalSteps: number,
): CompactProgressState {
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
