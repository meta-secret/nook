import { afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { Window } from 'happy-dom'
import { authenticatorHandOff } from '../src/content/autofill/authenticator-hand-off'

type HandOffGlobals = Pick<Window, 'document' | 'location'> & {
  window: Window
}

describe('authenticator hand-off from the login Pilot', () => {
  const browser = new Window({ url: 'https://www.namecheap.com/twofa/' })
  beforeAll(() => {
    const globals: HandOffGlobals = {
      window: browser,
      document: browser.document,
      location: browser.location,
    }
    Object.assign(globalThis, globals)
  })
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

  test('any other user action clears the choice', () => {
    authenticatorHandOff.request()
    browser.dispatchEvent(new browser.KeyboardEvent('keydown'))
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
