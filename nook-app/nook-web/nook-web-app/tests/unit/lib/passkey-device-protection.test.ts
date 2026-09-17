import { describe, expect, it } from 'vitest'
import {
  PasskeyCeremonyOutcome,
  PasskeyCeremonyAction,
  PasskeyCeremonyFailure,
  PasskeyFallback,
  passkeyCeremonyOutcome,
  sanitizedPasskeyCeremonyData,
  type PasskeyCeremonyFailureInput,
} from '$lib/auth/passkey-device-protection'

describe('passkeyCeremonyOutcome', () => {
  it('classifies typed PASSKEY_* failures', () => {
    expect(
      passkeyCeremonyOutcome(new Error('PASSKEY_UNAVAILABLE: no provider')),
    ).toBe(PasskeyCeremonyOutcome.PasskeyUnavailable)
    expect(
      passkeyCeremonyOutcome(new Error('PASSKEY_PRF_UNAVAILABLE: missing')),
    ).toBe(PasskeyCeremonyOutcome.PrfUnavailable)
    expect(
      passkeyCeremonyOutcome(
        new Error('PASSKEY_CEREMONY_NOT_ALLOWED: cancelled'),
      ),
    ).toBe(PasskeyCeremonyOutcome.CeremonyNotAllowed)
  })

  it('defaults unknown failures to passkey_ceremony_failed', () => {
    expect(passkeyCeremonyOutcome(new Error('boom'))).toBe(
      PasskeyCeremonyOutcome.CeremonyFailed,
    )
  })
})

describe('sanitizedPasskeyCeremonyData', () => {
  it('keeps only outcome and safe DOMException names', () => {
    const named = new Error(
      'Passkey create ceremony failed (SecurityError: This is an invalid domain.).',
    )
    named.name = 'Error'
    expect(sanitizedPasskeyCeremonyData(named)).toEqual({
      outcome: PasskeyCeremonyOutcome.CeremonyFailed,
      errorName: 'SecurityError',
    })

    const unavailable = new Error('PASSKEY_UNAVAILABLE: missing API')
    expect(sanitizedPasskeyCeremonyData(unavailable)).toEqual({
      outcome: PasskeyCeremonyOutcome.PasskeyUnavailable,
    })
  })

  it('does not forward raw error messages', () => {
    const data = sanitizedPasskeyCeremonyData(
      new Error('secret token=abc PASSKEY_UNAVAILABLE'),
    )
    expect(JSON.stringify(data)).not.toContain('secret')
    expect(JSON.stringify(data)).not.toContain('token=abc')
    expect(data.outcome).toBe(PasskeyCeremonyOutcome.PasskeyUnavailable)
  })
})

describe('passkey failure presentation', () => {
  it('offers a PIN only for setup or recovery capability failures', () => {
    for (const action of [
      PasskeyCeremonyAction.Create,
      PasskeyCeremonyAction.Recover,
    ]) {
      const failureInput: PasskeyCeremonyFailureInput = {
        action,
        diagnostic: sanitizedPasskeyCeremonyData(
          new Error('PASSKEY_PRF_UNAVAILABLE'),
        ),
      }
      const failure = new PasskeyCeremonyFailure(failureInput)
      expect(failure.fallback).toBe(PasskeyFallback.OfferPin)
    }
    const unlockInput: PasskeyCeremonyFailureInput = {
      action: PasskeyCeremonyAction.Unlock,
      diagnostic: sanitizedPasskeyCeremonyData(
        new Error('PASSKEY_PRF_UNAVAILABLE'),
      ),
    }
    const unlock = new PasskeyCeremonyFailure(unlockInput)
    expect(unlock.fallback).toBe(PasskeyFallback.Unchanged)
  })

  it('keeps cancellation distinct and does not retain a native secret-bearing error', () => {
    const failureInput: PasskeyCeremonyFailureInput = {
      action: PasskeyCeremonyAction.Create,
      diagnostic: sanitizedPasskeyCeremonyData(
        new Error('PASSKEY_CEREMONY_NOT_ALLOWED secret=private'),
      ),
    }
    const failure = new PasskeyCeremonyFailure(failureInput)
    expect(failure.fallback).toBe(PasskeyFallback.Unchanged)
    expect(failure.diagnostic.outcome).toBe(
      PasskeyCeremonyOutcome.CeremonyNotAllowed,
    )
    expect(JSON.stringify(failure)).not.toContain('private')
  })
})
