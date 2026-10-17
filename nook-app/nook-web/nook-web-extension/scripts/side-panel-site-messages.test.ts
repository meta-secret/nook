import { describe, expect, mock, test } from 'bun:test'
import { Effect } from 'effect'
import {
  BrowserRuntimeMessage,
  BrowserRuntimeMessageAdmissionKind,
  type BrowserRuntimeMessageValue,
} from '../src/lib/browser-runtime-message'
import { SIDE_PANEL_PAGE_PATH } from '../src/lib/side-panel-page-path'
import {
  SidePanelLoginFillKind,
  sidePanelSite,
  type SidePanelSiteClient,
  SidePanelSiteListingKind,
  SidePanelSiteMessageType,
  SidePanelSiteMessages,
  type SidePanelLoginFillRequest,
  type SidePanelSiteListing,
} from '../src/lib/side-panel-site'
import {
  SidePanelPageFillMessageType,
  SidePanelPageFillMessages,
  SidePanelPageFillReplyKind,
} from '../src/lib/side-panel-page-fill'

type RuntimeReplyCallback = (response: BrowserRuntimeMessageValue) => void
type SentRuntimeMessage = readonly [
  message: BrowserRuntimeMessageValue,
  callback: RuntimeReplyCallback,
]

/** A panel-side Chrome host whose runtime answers one request at a time. */
class PanelRuntimeFixture {
  readonly sent: SentRuntimeMessage[] = []
  readonly addListener = mock(() => {})
  readonly tabsSendMessage = mock(() => Promise.resolve())
  private readonly runtime = {
    id: 'nook-extension',
    lastError: false,
    onMessage: { addListener: this.addListener },
    sendMessage: (
      message: BrowserRuntimeMessageValue,
      callback: RuntimeReplyCallback,
    ) => {
      this.sent.push([message, callback])
      this.answer(callback)
    },
  }
  private answer: (callback: RuntimeReplyCallback) => void = () => {}

  constructor(private readonly reply: BrowserRuntimeMessageValue) {
    this.answer = (callback) => callback(this.reply)
  }

  withoutReceiver(): this {
    this.answer = (callback) => {
      this.runtime.lastError = true
      callback(this.reply)
      this.runtime.lastError = false
    }
    return this
  }

  client(): SidePanelSiteClient {
    Object.assign(globalThis, {
      chrome: {
        runtime: this.runtime,
        tabs: { sendMessage: this.tabsSendMessage },
      },
    })
    return sidePanelSite
  }
}

class WireFixture {
  static decodes(effect: Effect.Effect<unknown, unknown>): boolean {
    return Effect.runSync(Effect.result(effect))._tag === 'Success'
  }

  /** Admits the value the way the service worker's runtime listener does. */
  static message(value: BrowserRuntimeMessageValue): BrowserRuntimeMessage {
    const admission = BrowserRuntimeMessage.from(value)
    if (admission.kind !== BrowserRuntimeMessageAdmissionKind.Accepted)
      throw new Error('fixture must be a runtime message')
    return admission.message
  }
}

const itemId = { vaultStoreId: 'store_abcdefghijk', secretId: 'secret_login' }

describe('side-panel This-site wire', () => {
  test('names one side-panel page path for the manifest and the sender check', () => {
    expect(SIDE_PANEL_PAGE_PATH).toBe('side-panel/index.html')
  })

  test('a listing request carries only the window selector', () => {
    const admitted = {
      type: SidePanelSiteMessageType.ListLogins,
      payload: { windowId: 7 },
    }
    expect(
      WireFixture.decodes(
        SidePanelSiteMessages.decodeListLogins(WireFixture.message(admitted)),
      ),
    ).toBe(true)
    const rejected: BrowserRuntimeMessageValue[] = [
      { ...admitted, payload: { windowId: 7, origin: 'https://example.com' } },
      { ...admitted, payload: { windowId: 7, url: 'https://example.com/' } },
      { ...admitted, payload: { windowId: 7, tabId: 4 } },
      { ...admitted, payload: { windowId: 7, frameId: 0 } },
      { ...admitted, requestId: 'r', payload: { windowId: 7 } },
      { ...admitted, payload: {} },
      { ...admitted, payload: { windowId: -1 } },
      { ...admitted, payload: { windowId: 1.5 } },
      { ...admitted, payload: { windowId: '7' } },
    ]
    for (const message of rejected) {
      expect(
        WireFixture.decodes(
          SidePanelSiteMessages.decodeListLogins(WireFixture.message(message)),
        ),
      ).toBe(false)
    }
  })

  test('a Fill request carries only the window selector and the opaque item id', () => {
    const admitted = {
      type: SidePanelSiteMessageType.FillLogin,
      payload: { windowId: 7, itemId },
    }
    expect(
      WireFixture.decodes(
        SidePanelSiteMessages.decodeFillLogin(WireFixture.message(admitted)),
      ),
    ).toBe(true)
    const rejected: BrowserRuntimeMessageValue[] = [
      {
        ...admitted,
        payload: { ...admitted.payload, origin: 'https://a.test' },
      },
      { ...admitted, payload: { ...admitted.payload, tabId: 4 } },
      { ...admitted, payload: { ...admitted.payload, username: 'person' } },
      {
        ...admitted,
        payload: {
          windowId: 7,
          itemId: { ...itemId, authorizationGeneration: 'generation' },
        },
      },
      {
        ...admitted,
        payload: { windowId: 7, itemId: { ...itemId, secretId: '' } },
      },
      {
        ...admitted,
        payload: {
          windowId: 7,
          itemId: { ...itemId, secretId: 's'.repeat(257) },
        },
      },
      { ...admitted, payload: { windowId: 7 } },
    ]
    for (const message of rejected) {
      expect(
        WireFixture.decodes(
          SidePanelSiteMessages.decodeFillLogin(WireFixture.message(message)),
        ),
      ).toBe(false)
    }
  })

  test('a listing answer admits no secret, saved URL or extra field', () => {
    const ready = {
      kind: SidePanelSiteListingKind.Ready,
      display_host: 'www.example.com',
      items: [
        { itemId, username: 'person@example.com', vaultLabel: 'Personal' },
      ],
    }
    expect(
      WireFixture.decodes(SidePanelSiteMessages.decodeListing(ready)),
    ).toBe(true)
    const leaking: BrowserRuntimeMessageValue[] = [
      { ...ready, items: [{ ...ready.items[0], password: 'hunter2' }] },
      {
        ...ready,
        items: [{ ...ready.items[0], websiteUrl: 'https://example.com/?t=1' }],
      },
      { ...ready, url: 'https://www.example.com/login' },
      { ...ready, authorizationGeneration: 'generation' },
      { kind: SidePanelSiteListingKind.Locked, reason: 'login-locked' },
      { kind: 'empty' },
    ]
    for (const response of leaking) {
      expect(
        WireFixture.decodes(SidePanelSiteMessages.decodeListing(response)),
      ).toBe(false)
    }
  })

  test('a Fill answer and a page trigger answer carry a kind only', () => {
    expect(
      WireFixture.decodes(
        SidePanelSiteMessages.decodeFillOutcome({
          kind: SidePanelLoginFillKind.Filled,
        }),
      ),
    ).toBe(true)
    expect(
      WireFixture.decodes(
        SidePanelSiteMessages.decodeFillOutcome({
          kind: SidePanelLoginFillKind.Filled,
          username: 'person',
        }),
      ),
    ).toBe(false)
    expect(
      WireFixture.decodes(
        SidePanelPageFillMessages.decodeReply({
          kind: SidePanelPageFillReplyKind.Filled,
          password: 'hunter2',
        }),
      ),
    ).toBe(false)
  })

  test('the page trigger is strict and names the derived origin and generation', () => {
    const trigger = {
      type: SidePanelPageFillMessageType.Fill,
      payload: {
        origin: 'https://www.example.com',
        account: {
          vaultStoreId: itemId.vaultStoreId,
          secretId: itemId.secretId,
          authorizationGeneration: 'generation-1',
        },
      },
    }
    expect(SidePanelPageFillMessages.decode(trigger)._tag).toBe('Success')
    const withUsername = {
      ...trigger,
      payload: {
        ...trigger.payload,
        account: { ...trigger.payload.account, username: 'person' },
      },
    }
    expect(SidePanelPageFillMessages.decode(withUsername)._tag).toBe('Failure')
    expect(
      SidePanelPageFillMessages.decode({ ...trigger, password: 'x' })._tag,
    ).toBe('Failure')
  })
})

describe('side-panel This-site client', () => {
  test('lists through one runtime request and never listens for broadcasts', async () => {
    const expected: SidePanelSiteListing = {
      kind: SidePanelSiteListingKind.Ready,
      display_host: 'www.example.com',
      items: [{ itemId, username: 'person', vaultLabel: 'Personal' }],
    }
    const fixture = new PanelRuntimeFixture({
      kind: SidePanelSiteListingKind.Ready,
      display_host: 'www.example.com',
      items: [{ itemId, username: 'person', vaultLabel: 'Personal' }],
    })

    const listing = await fixture.client().list({ windowId: 7 })

    expect(listing).toEqual(expected)
    expect(fixture.sent.map(([message]) => message)).toEqual([
      { type: SidePanelSiteMessageType.ListLogins, payload: { windowId: 7 } },
    ])
    expect(fixture.addListener).not.toHaveBeenCalled()
    expect(fixture.tabsSendMessage).not.toHaveBeenCalled()
  })

  test('an unanswered or malformed listing is a visible list failure, never an empty list', async () => {
    const unanswered = new PanelRuntimeFixture({
      kind: SidePanelSiteListingKind.Ready,
      display_host: 'a.test',
      items: [],
    }).withoutReceiver()
    const malformed = new PanelRuntimeFixture({ kind: 'ready', items: [] })

    expect(await unanswered.client().list({ windowId: 7 })).toEqual({
      kind: SidePanelSiteListingKind.ListFailed,
    })
    expect(await malformed.client().list({ windowId: 7 })).toEqual({
      kind: SidePanelSiteListingKind.ListFailed,
    })
  })

  test('fills by sending the opaque item id and returns the typed outcome', async () => {
    const fixture = new PanelRuntimeFixture({
      kind: SidePanelLoginFillKind.NoLoginForm,
    })
    const request: SidePanelLoginFillRequest = { windowId: 7, itemId }

    const outcome = await fixture.client().fill(request)

    expect(outcome).toEqual({ kind: SidePanelLoginFillKind.NoLoginForm })
    expect(fixture.sent.map(([message]) => message)).toEqual([
      {
        type: SidePanelSiteMessageType.FillLogin,
        payload: { windowId: 7, itemId },
      },
    ])
    expect(fixture.addListener).not.toHaveBeenCalled()
  })

  test('an unanswered Fill is a typed failure', async () => {
    const fixture = new PanelRuntimeFixture({
      kind: SidePanelLoginFillKind.Filled,
    }).withoutReceiver()

    expect(await fixture.client().fill({ windowId: 7, itemId })).toEqual({
      kind: SidePanelLoginFillKind.FillFailed,
    })
  })
})
