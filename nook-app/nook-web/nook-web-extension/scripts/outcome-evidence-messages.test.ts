import { describe, expect, test } from 'bun:test'
import {
  isAuthenticationOutcomeClassifyMessage,
  isAuthenticationOutcomeVerdictName,
} from '../src/lib/outcome-evidence-messages'

const validObservation = {
  navigatedAwayFromAuthPath: true,
  authFieldsPresent: false,
  successMarkerPresent: true,
  errorMarkerPresent: false,
  sameDocumentMutation: false,
  inIframe: false,
  elapsedMs: 400,
}

describe('outcome evidence messages', () => {
  test('accepts a bounded classify payload', () => {
    expect(
      isAuthenticationOutcomeClassifyMessage({
        type: 'nook:authentication-outcome-classify',
        payload: { observation: validObservation, timeoutMs: 8_000 },
      }),
    ).toBe(true)
  })

  test('rejects secret-bearing or malformed observations', () => {
    expect(
      isAuthenticationOutcomeClassifyMessage({
        type: 'nook:authentication-outcome-classify',
        payload: {
          observation: { ...validObservation, elapsedMs: -1 },
        },
      }),
    ).toBe(false)
    expect(
      isAuthenticationOutcomeClassifyMessage({
        type: 'nook:authentication-outcome-classify',
        payload: { observation: { ...validObservation, password: 'x' } },
      }),
    ).toBe(true)
    expect(isAuthenticationOutcomeVerdictName('sufficient')).toBe(true)
    expect(isAuthenticationOutcomeVerdictName('maybe')).toBe(false)
  })
})
