import { afterEach, describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import type { BrowserRuntimeMessageValue } from '../src/lib/browser-runtime-message'
import {
  SidePanelAuthenticatorSetupMessageType,
  SidePanelPageAddAuthenticatorReplyKind,
  type SidePanelPageAddAuthenticatorReply,
} from '../src/lib/side-panel-authenticator-setup'
import {
  SidePanelPageAddAuthenticatorReceiver,
  SidePanelPageAddAuthenticatorReception,
  type SidePanelEnrollmentStarter,
} from '../src/content/autofill/side-panel-page-authenticator-setup'
import { extensionTestBrowserHost } from './extension-test-browser-host'

const ORIGIN = 'https://dashboard.example.test'

/** Counts starts of the page widget's consented enrollment. */
class RecordingStarter implements SidePanelEnrollmentStarter {
  starts = 0
  constructor(private readonly offered: boolean) {}

  async startFromSidePanel(): Promise<boolean> {
    this.starts += 1
    return this.offered
  }
}

type AddScenario = {
  readonly starter: SidePanelEnrollmentStarter
  readonly message?: BrowserRuntimeMessageValue
  readonly sender?: chrome.runtime.MessageSender
}

class TopDocument {
  constructor() {
    const browser = new Window({ url: `${ORIGIN}/settings/user` })
    Object.assign(globalThis, {
      window: browser,
      location: browser.location,
      chrome: {
        ...extensionTestBrowserHost,
        runtime: { id: 'nook-extension' },
      },
    })
  }

  async add(scenario: AddScenario) {
    const receiver = new SidePanelPageAddAuthenticatorReceiver(scenario.starter)
    const replies = Promise.withResolvers<SidePanelPageAddAuthenticatorReply>()
    const [
      message = {
        type: SidePanelAuthenticatorSetupMessageType.PageAdd,
        payload: { origin: ORIGIN },
      },
    ] = [scenario.message]
    const [sender = { id: 'nook-extension' }] = [scenario.sender]
    const reception = receiver.receive({
      message,
      sender,
      sendResponse: replies.resolve,
    })
    switch (reception) {
      case SidePanelPageAddAuthenticatorReception.Ignored:
        return { reception }
      case SidePanelPageAddAuthenticatorReception.Responding:
        return { reception, reply: await replies.promise }
    }
  }
}

afterEach(() => {
  Object.assign(globalThis, { chrome: extensionTestBrowserHost })
})

describe('side-panel Add 2FA trigger in the top document', () => {
  test("starts the page widget's enrollment and says it started", async () => {
    const starter = new RecordingStarter(true)
    expect(await new TopDocument().add({ starter })).toEqual({
      reception: SidePanelPageAddAuthenticatorReception.Responding,
      reply: { kind: SidePanelPageAddAuthenticatorReplyKind.Started },
    })
    expect(starter.starts).toBe(1)
  })

  test('a page without an offered setup answers no-setup', async () => {
    const starter = new RecordingStarter(false)
    expect((await new TopDocument().add({ starter })).reply).toEqual({
      kind: SidePanelPageAddAuthenticatorReplyKind.NoSetup,
    })
  })

  test('another origin answers tab-changed without starting anything', async () => {
    const starter = new RecordingStarter(true)
    const message = {
      type: SidePanelAuthenticatorSetupMessageType.PageAdd,
      payload: { origin: 'https://other.example.test' },
    }
    expect((await new TopDocument().add({ starter, message })).reply).toEqual({
      kind: SidePanelPageAddAuthenticatorReplyKind.TabChanged,
    })
    expect(starter.starts).toBe(0)
  })

  test('a foreign sender or other message is ignored; a malformed trigger starts nothing', async () => {
    const starter = new RecordingStarter(true)
    const page = new TopDocument()
    expect(
      await page.add({ starter, sender: { id: 'other-extension' } }),
    ).toEqual({ reception: SidePanelPageAddAuthenticatorReception.Ignored })
    expect(
      await page.add({ starter, message: { type: 'nook:other' } }),
    ).toEqual({ reception: SidePanelPageAddAuthenticatorReception.Ignored })
    const malformed = {
      type: SidePanelAuthenticatorSetupMessageType.PageAdd,
      payload: { origin: ORIGIN, otpauthUri: 'otpauth://totp/x' },
    }
    expect((await page.add({ starter, message: malformed })).reply).toEqual({
      kind: SidePanelPageAddAuthenticatorReplyKind.NoSetup,
    })
    expect(starter.starts).toBe(0)
  })
})
