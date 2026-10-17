import { describe, expect, test } from 'vitest'
import {
  advance_sign_in_attempt,
  begin_sign_in_attempt,
  type SignInAttemptAdvanceRequest,
  type SignInAttemptBeginRequest,
  type SignInAttemptTransition,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

/** Structural DTOs of the generated package; the record crosses as an opaque string. */
class SignInAttemptAbiFixture {
  readonly origin = 'https://www.namecheap.com'
  readonly now = 1_800_000_000_000

  begin(): SignInAttemptTransition {
    const request: SignInAttemptBeginRequest = {
      sender_origin: this.origin,
      login: 'store_a/secret_b',
      now: this.now,
    }
    return begin_sign_in_attempt(request)
  }

  record(transition: SignInAttemptTransition): string {
    switch (transition.disposition.kind) {
      case 'Retain':
        return transition.disposition.record
      case 'Close':
        throw new Error('expected a retained record')
    }
  }
}

describe('companion sign-in attempt generated-package ABI', () => {
  test('begins a retained attempt and advances it through a structural event', () => {
    const fixture = new SignInAttemptAbiFixture()
    const begun = fixture.begin()
    expect(begun.presentation.status).toBe('SigningIn')
    expect(begun.presentation.title_key).toBe('widgetSignInSigningIn')
    const request: SignInAttemptAdvanceRequest = {
      record: fixture.record(begun),
      sender_origin: fixture.origin,
      now: fixture.now + 1_000,
      event: { kind: 'UserAction', action: { kind: 'Dismiss' } },
    }
    const advanced = advance_sign_in_attempt(request)
    switch (advanced.kind) {
      case 'Advanced':
        expect(advanced.transition.disposition.kind).toBe('Close')
        expect(advanced.transition.presentation.status).toBe('Dismissed')
        return
      case 'RecordRejected':
      case 'OtherSite':
        throw new Error(`unexpected ${advanced.kind}`)
    }
  })

  test('reports a corrupt record as RecordRejected and another site as OtherSite', () => {
    const fixture = new SignInAttemptAbiFixture()
    const corrupt: SignInAttemptAdvanceRequest = {
      record: '{"v":0}',
      sender_origin: fixture.origin,
      now: fixture.now,
      event: { kind: 'Resumed' },
    }
    expect(advance_sign_in_attempt(corrupt).kind).toBe('RecordRejected')
    const otherSite: SignInAttemptAdvanceRequest = {
      record: fixture.record(fixture.begin()),
      sender_origin: 'https://example.org',
      now: fixture.now,
      event: { kind: 'Resumed' },
    }
    expect(advance_sign_in_attempt(otherSite).kind).toBe('OtherSite')
  })

  test('accepts a legacy secret label with spaces, non-ASCII and a slash', () => {
    const fixture = new SignInAttemptAbiFixture()
    const request: SignInAttemptBeginRequest = {
      sender_origin: fixture.origin,
      login: 'store_a/Mein Konto/Ärger',
      now: fixture.now,
    }
    expect(begin_sign_in_attempt(request).disposition.kind).toBe('Retain')
  })

  test('throws for a malformed request DTO', () => {
    const fixture = new SignInAttemptAbiFixture()
    const request: SignInAttemptBeginRequest = {
      sender_origin: fixture.origin,
      login: 'store_a/',
      now: fixture.now,
    }
    expect(() => begin_sign_in_attempt(request)).toThrow()
  })
})
