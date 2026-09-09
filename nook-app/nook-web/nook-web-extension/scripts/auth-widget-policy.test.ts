import { describe, expect, test } from 'bun:test'
import {
  CompactProgressState,
  AuthenticationGesture,
  SavedOptionOrdinal,
} from '../src/lib/auth-widget-policy'

describe('Nook Pilot in-page authorization policy', () => {
  test('rejects page-script clicks and accepts browser-trusted gestures', () => {
    expect(new AuthenticationGesture({ isTrusted: false }).trusted).toBe(false)
    expect(new AuthenticationGesture({ isTrusted: true }).trusted).toBe(true)
  })

  test('keeps compact progress and its accessible label synchronized', () => {
    const args = {
      pilotLabel: 'Nook Pilot',
      currentStep: 3,
      totalSteps: 3,
    }
    expect(new CompactProgressState(args)).toEqual({
      badge: '3/3',
      accessibleLabel: 'Nook Pilot · 3/3',
    })
  })

  test('uses non-secret ordinals for enrollment backup choices', () => {
    expect(new SavedOptionOrdinal(0).label).toBe('1')
    expect(new SavedOptionOrdinal(2).label).toBe('3')
  })
})
