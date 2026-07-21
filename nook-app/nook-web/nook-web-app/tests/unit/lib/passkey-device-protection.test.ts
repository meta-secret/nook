import { describe, expect, it } from 'vitest'
import {
  passkeyCeremonyOutcome,
  sanitizedPasskeyCeremonyData,
} from '$lib/passkey-device-protection'

describe('passkeyCeremonyOutcome', () => {
  it('classifies typed PASSKEY_* failures', () => {
    expect(
      passkeyCeremonyOutcome(new Error('PASSKEY_UNAVAILABLE: no provider')),
    ).toBe('passkey_unavailable')
    expect(
      passkeyCeremonyOutcome(new Error('PASSKEY_PRF_UNAVAILABLE: missing')),
    ).toBe('passkey_prf_unavailable')
    expect(
      passkeyCeremonyOutcome(
        new Error('PASSKEY_CEREMONY_NOT_ALLOWED: cancelled'),
      ),
    ).toBe('passkey_ceremony_not_allowed')
  })

  it('defaults unknown failures to passkey_ceremony_failed', () => {
    expect(passkeyCeremonyOutcome(new Error('boom'))).toBe(
      'passkey_ceremony_failed',
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
      outcome: 'passkey_ceremony_failed',
      errorName: 'SecurityError',
    })

    const unavailable = new Error('PASSKEY_UNAVAILABLE: missing API')
    expect(sanitizedPasskeyCeremonyData(unavailable)).toEqual({
      outcome: 'passkey_unavailable',
    })
  })

  it('does not forward raw error messages', () => {
    const data = sanitizedPasskeyCeremonyData(
      new Error('secret token=abc PASSKEY_UNAVAILABLE'),
    )
    expect(JSON.stringify(data)).not.toContain('secret')
    expect(JSON.stringify(data)).not.toContain('token=abc')
    expect(data.outcome).toBe('passkey_unavailable')
  })
})
