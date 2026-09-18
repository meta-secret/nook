import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { AuthenticationOutcomeClassifyMessage as AuthenticationOutcomeClassifyMessageSchema } from '../src/lib/outcome-evidence-messages'

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
      Effect.runSync(
        Effect.either(
          AuthenticationOutcomeClassifyMessageSchema.decode({
            type: 'nook:authentication-outcome-classify',
            payload: { observation: validObservation, timeoutMs: 8_000 },
          }),
        ),
      )._tag,
    ).toBe('Right')
  })

  test('rejects secret-bearing or malformed observations', () => {
    expect(
      Effect.runSync(
        Effect.either(
          AuthenticationOutcomeClassifyMessageSchema.decode({
            type: 'nook:authentication-outcome-classify',
            payload: {
              observation: { ...validObservation, elapsedMs: -1 },
            },
          }),
        ),
      )._tag,
    ).toBe('Left')
    expect(
      Effect.runSync(
        Effect.either(
          AuthenticationOutcomeClassifyMessageSchema.decode({
            type: 'nook:authentication-outcome-classify',
            payload: {
              observation: { ...validObservation, password: 'x' },
              timeoutMs: 8_000,
            },
          }),
        ),
      )._tag,
    ).toBe('Right')
  })
})
