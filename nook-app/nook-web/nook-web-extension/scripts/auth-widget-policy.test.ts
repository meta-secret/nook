import { describe, expect, test } from 'bun:test'
import {
  compactProgressState,
  isTrustedAuthAction,
  safeSavedOptionNumber,
} from '../src/lib/auth-widget-policy'

describe('Nook Pilot in-page authorization policy', () => {
  test('rejects page-script clicks and accepts browser-trusted gestures', () => {
    expect(isTrustedAuthAction(false)).toBe(false)
    expect(isTrustedAuthAction(true)).toBe(true)
  })

  test('keeps compact progress and its accessible label synchronized', () => {
    expect(compactProgressState('Nook Pilot', 3, 3)).toEqual({
      badge: '3/3',
      accessibleLabel: 'Nook Pilot · 3/3',
    })
  })

  test('uses non-secret ordinals for saved choices', () => {
    expect(safeSavedOptionNumber(0)).toBe('1')
    expect(safeSavedOptionNumber(2)).toBe('3')
  })
})
