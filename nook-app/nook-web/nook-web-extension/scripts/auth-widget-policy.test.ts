import { describe, expect, test } from 'bun:test'
import {
  authWidgetStartsCollapsed,
  compactProgressState,
  isTrustedAuthAction,
  safeSavedOptionNumber,
  type AuthWidgetPresentationInput,
} from '../src/lib/auth-widget-policy'
describe('Nook Pilot in-page authorization policy', () => {
  test('rejects page-script clicks and accepts browser-trusted gestures', () => {
    expect(isTrustedAuthAction(false)).toBe(false)
    expect(isTrustedAuthAction(true)).toBe(true)
  })

  test('keeps compact progress and its accessible label synchronized', () => {
    const args = {
      pilotLabel: 'Nook Pilot',
      currentStep: 3,
      totalSteps: 3,
    }
    expect(compactProgressState(args)).toEqual({
      badge: '3/3',
      accessibleLabel: 'Nook Pilot · 3/3',
    })
  })
  test('expands confirmed availability and compacts unresolved lookups', () => {
    const emptyMatches: AuthWidgetPresentationInput = {
      savedLoginCapability: 'fill-saved-login',
      loginMatches: {
        kind: 'ready',
        count: 0,
      },
    }
    expect(authWidgetStartsCollapsed(emptyMatches)).toBe(false)
    const savedMatch: AuthWidgetPresentationInput = {
      savedLoginCapability: 'fill-saved-login',
      loginMatches: {
        kind: 'ready',
        count: 1,
      },
    }
    expect(authWidgetStartsCollapsed(savedMatch)).toBe(false)
    const unresolvedStates: AuthWidgetPresentationInput[] = [
      {
        savedLoginCapability: 'fill-saved-login',
        loginMatches: { kind: 'locked' },
      },
      {
        savedLoginCapability: 'fill-saved-login',
        loginMatches: { kind: 'unavailable' },
      },
    ]
    for (const unresolvedMatches of unresolvedStates) {
      expect(authWidgetStartsCollapsed(unresolvedMatches)).toBe(true)
    }
  })

  test('uses non-secret ordinals for enrollment backup choices', () => {
    expect(safeSavedOptionNumber(0)).toBe('1')
    expect(safeSavedOptionNumber(2)).toBe('3')
  })
})
