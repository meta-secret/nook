import { type WebsiteLoginMatchAvailability } from './auth-workflow-messages'
import type { AuthenticationSavedLoginCapability } from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
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

export type AuthWidgetPresentationInput = {
  savedLoginCapability: AuthenticationSavedLoginCapability
  loginMatches: WebsiteLoginMatchAvailability
}

export function authWidgetStartsCollapsed({
  savedLoginCapability,
  loginMatches,
}: AuthWidgetPresentationInput): boolean {
  return (
    savedLoginCapability === 'fill-saved-login' &&
    loginMatches.kind === 'ready' &&
    'count' in loginMatches &&
    loginMatches.count === 0
  )
}

export function safeSavedOptionNumber(index: number): string {
  return String(index + 1)
}
