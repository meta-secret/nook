import { describe, expect, test } from 'bun:test'
import {
  authWidgetAllowsPilotAction,
  authWidgetStartsCollapsed,
  compactProgressState,
  isTrustedAuthAction,
  safeSavedOptionNumber,
  type AuthWidgetPresentationInput,
  type AuthWidgetPilotActionInput,
} from '../src/lib/auth-widget-policy'
describe('Nook Pilot in-page authorization policy', () => {
  test('rejects page-script clicks and accepts browser-trusted gestures', () => {
    expect(isTrustedAuthAction(false)).toBe(false)
    expect(isTrustedAuthAction(true)).toBe(true)
  })

  test('executes Pilot actions only with Rust-owned explicit approval', () => {
    const approvedAction: AuthWidgetPilotActionInput = {
      action: 'continue-with-nook',
      approvalRequirement: 'explicit-user-approval',
    }
    expect(authWidgetAllowsPilotAction(approvedAction)).toBe(true)

    const takeoverRequired: AuthWidgetPilotActionInput = {
      action: 'continue-with-nook',
      approvalRequirement: 'takeover-required',
    }
    expect(authWidgetAllowsPilotAction(takeoverRequired)).toBe(false)

    const manualAction: AuthWidgetPilotActionInput = {
      action: 'take-over',
      approvalRequirement: 'explicit-user-approval',
    }
    expect(authWidgetAllowsPilotAction(manualAction)).toBe(false)
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

  test('starts compact until a fillable login has a confirmed saved match', () => {
    const emptyMatches: AuthWidgetPresentationInput = {
      savedLoginCapability: 'fill-saved-login',
      loginMatches: {
        kind: 'ready',
        count: 0,
      },
    }
    expect(authWidgetStartsCollapsed(emptyMatches)).toBe(true)
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
