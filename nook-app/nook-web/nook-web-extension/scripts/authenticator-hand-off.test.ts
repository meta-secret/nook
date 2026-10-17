import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { authenticatorHandOff } from '../src/content/autofill/authenticator-hand-off'

describe('authenticator hand-off from the login Pilot', () => {
  afterEach(() => {
    authenticatorHandOff.take()
  })

  test('a fresh Fill 2FA code choice is taken exactly once', () => {
    authenticatorHandOff.request()
    expect(authenticatorHandOff.take()).toBe(true)
    expect(authenticatorHandOff.take()).toBe(false)
  })

  test('nothing is taken without a choice', () => {
    expect(authenticatorHandOff.take()).toBe(false)
  })

  test('a lapsed choice never acts on a later 2FA step', () => {
    const clock = spyOn(Date, 'now').mockReturnValue(1_000)
    try {
      authenticatorHandOff.request()
      clock.mockReturnValue(1_000 + 5_001)
      expect(authenticatorHandOff.take()).toBe(false)
    } finally {
      clock.mockRestore()
    }
  })
})
