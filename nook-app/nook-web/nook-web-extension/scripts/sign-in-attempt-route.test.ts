import { describe, expect, test } from 'bun:test'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import {
  SignInAttemptFailureReason,
  SignInAttemptMessageType,
  SignInAttemptOperation,
  SignInAttemptViewKind,
  type SignInAttemptRuntimeResponse,
} from '../src/lib/sign-in-attempt-messages'
import type { BrowserRuntimeMessageValue } from '../src/lib/browser-runtime-message'
import {
  SignInAttemptRouteFixture,
  type SignInAttemptSenderFixture,
} from './sign-in-attempt-test-support'

await companionWasmReady

const topFrame: SignInAttemptSenderFixture = {
  tab: 7,
  frameId: 0,
  url: 'https://www.namecheap.com/myaccount/login/',
  extensionId: SignInAttemptRouteFixture.EXTENSION_ID,
}
const beginMessage: BrowserRuntimeMessageValue = {
  type: SignInAttemptMessageType.Session,
  payload: { operation: SignInAttemptOperation.Begin, login: 'store_a/secret_b' },
}
const resumeMessage: BrowserRuntimeMessageValue = {
  type: SignInAttemptMessageType.Session,
  payload: { operation: SignInAttemptOperation.Advance, event: { kind: 'Resumed' } },
}
const dismissMessage: BrowserRuntimeMessageValue = {
  type: SignInAttemptMessageType.Session,
  payload: {
    operation: SignInAttemptOperation.Advance,
    event: { kind: 'UserAction', action: { kind: 'Dismiss' } },
  },
}

class RouteExpectation {
  static presented(response: SignInAttemptRuntimeResponse): string {
    switch (response.ok) {
      case false:
        throw new Error(`expected a presentation, received ${response.reason}`)
      case true:
        break
    }
    switch (response.attempt.kind) {
      case SignInAttemptViewKind.None:
        throw new Error('expected a presentation, received no attempt')
      case SignInAttemptViewKind.Presented:
        return String(response.attempt.presentation.status)
    }
  }
}

describe('service-worker sign-in attempt store', () => {
  test('Begin binds the opaque record to the sender tab and Resume returns it', async () => {
    const fixture = await SignInAttemptRouteFixture.create()
    const begun = await fixture.respond({
      message: beginMessage,
      sender: topFrame,
    })
    expect(RouteExpectation.presented(begun)).toBe('SigningIn')
    const stored = fixture.storage.values[fixture.storage.key(7)]
    expect(typeof stored).toBe('string')
    expect(String(stored)).not.toContain('pilot-password')

    const resumed = await fixture.respond({
      message: resumeMessage,
      sender: topFrame,
    })
    expect(RouteExpectation.presented(resumed)).toBe('SigningIn')

    const otherTab: SignInAttemptSenderFixture = { ...topFrame, tab: 8 }
    const fresh = await fixture.respond({
      message: resumeMessage,
      sender: otherTab,
    })
    expect(fresh).toEqual({
      ok: true,
      attempt: { kind: SignInAttemptViewKind.None },
    })
  })

  test('only the top-level frame of this extension and an http(s) tab is admitted', async () => {
    const fixture = await SignInAttemptRouteFixture.create()
    const forbidden = {
      ok: false,
      reason: SignInAttemptFailureReason.ForbiddenSender,
    }
    for (const sender of [
      { ...topFrame, frameId: 3 },
      { ...topFrame, extensionId: 'other-extension' },
      { ...topFrame, url: 'not a url' },
    ]) {
      expect(await fixture.respond({ message: beginMessage, sender })).toEqual(
        forbidden,
      )
    }
    expect(Object.keys(fixture.storage.values)).toEqual([])
  })

  test('the message body cannot choose the origin the attempt binds to', async () => {
    const fixture = await SignInAttemptRouteFixture.create()
    const spoofed: BrowserRuntimeMessageValue = {
      type: SignInAttemptMessageType.Session,
      origin: 'https://attacker.example',
      payload: {
        operation: SignInAttemptOperation.Begin,
        login: 'store_a/secret_b',
      },
    }
    await fixture.respond({ message: spoofed, sender: topFrame })
    const other: SignInAttemptSenderFixture = {
      ...topFrame,
      url: 'https://attacker.example/login',
    }
    const resumed = await fixture.respond({ message: resumeMessage, sender: other })
    expect(resumed).toEqual({
      ok: true,
      attempt: { kind: SignInAttemptViewKind.None },
    })
    expect(typeof fixture.storage.values[fixture.storage.key(7)]).toBe('string')
  })

  test('Close removes the record; a later Resume starts fresh', async () => {
    const fixture = await SignInAttemptRouteFixture.create()
    await fixture.respond({ message: beginMessage, sender: topFrame })
    const dismissed = await fixture.respond({
      message: dismissMessage,
      sender: topFrame,
    })
    expect(RouteExpectation.presented(dismissed)).toBe('Dismissed')
    expect(fixture.storage.key(7) in fixture.storage.values).toBe(false)
    expect(
      await fixture.respond({ message: resumeMessage, sender: topFrame }),
    ).toEqual({ ok: true, attempt: { kind: SignInAttemptViewKind.None } })
  })

  test('a record that fails strict decode is removed and the Pilot starts fresh', async () => {
    const fixture = await SignInAttemptRouteFixture.create()
    for (const corrupt of ['{"version":"future"}', 42]) {
      fixture.storage.values[fixture.storage.key(7)] = corrupt
      const resumed = await fixture.respond({
        message: resumeMessage,
        sender: topFrame,
      })
      expect(resumed).toEqual({
        ok: true,
        attempt: { kind: SignInAttemptViewKind.None },
      })
      expect(fixture.storage.key(7) in fixture.storage.values).toBe(false)
    }
  })

  test('tab removal forgets the attempt', async () => {
    const fixture = await SignInAttemptRouteFixture.create()
    await fixture.respond({ message: beginMessage, sender: topFrame })
    await fixture.route.forgetTab(7)
    expect(fixture.storage.key(7) in fixture.storage.values).toBe(false)
  })

  test('malformed requests are rejected without touching storage', async () => {
    const fixture = await SignInAttemptRouteFixture.create()
    const malformed: BrowserRuntimeMessageValue = {
      type: SignInAttemptMessageType.Session,
      payload: { operation: SignInAttemptOperation.Begin, login: 'has spaces' },
    }
    const response = await fixture.respond({ message: malformed, sender: topFrame })
    expect(response).toEqual({
      ok: false,
      reason: SignInAttemptFailureReason.Unavailable,
    })
    expect(Object.keys(fixture.storage.values)).toEqual([])
  })
})
