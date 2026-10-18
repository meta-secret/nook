import { describe, expect, mock, test } from 'bun:test'
import { I18N_KEYS } from '../../nook-web-shared/src/generated/i18n-keys'
import type {
  SiteSecretListing,
  SiteSecretRow,
  SiteSecretSection,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { Effect } from 'effect'
import {
  BrowserRuntimeMessage,
  BrowserRuntimeMessageAdmissionKind,
  type BrowserRuntimeMessageValue,
} from '../src/lib/browser-runtime-message'
import { SIDE_PANEL_PAGE_PATH } from '../src/lib/side-panel-page-path'
import {
  SidePanelCodeFillKind,
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
    const row = {
      kind: 'Login',
      item_id: {
        vault_store_id: 'store_abcdefghijk',
        secret_id: 'secret_login',
      },
      type_label_key: I18N_KEYS.VaultTypesLogin,
      title: 'www.example.com',
      account: 'person@example.com',
      saved_host: 'www.example.com',
      action: {
        kind: 'FillLogin',
        label_key: I18N_KEYS.ExtensionActionFill,
        accessible_label_key: I18N_KEYS.ExtensionActionFillLogin,
      },
    }
    const section = {
      vault_store_id: 'store_abcdefghijk',
      identity: { kind: 'Named', name: 'Personal' },
      vault: { kind: 'Named', name: 'test' },
      content: { kind: 'Listed', rows: [row] },
    }
    const ready = {
      kind: SidePanelSiteListingKind.Ready,
      display_host: 'www.example.com',
      listing: { summary: { kind: 'Listed' }, sections: [section] },
    }
    const empty = {
      kind: SidePanelSiteListingKind.Ready,
      display_host: 'www.example.com',
      listing: {
        summary: {
          kind: 'Empty',
          message_key: I18N_KEYS.ExtensionActionSiteEmptyAny,
          hint: {
            kind: 'Shown',
            message_key: I18N_KEYS.ExtensionActionSiteEmptyHint,
          },
        },
        sections: [
          {
            ...section,
            content: {
              kind: 'Empty',
              message_key: I18N_KEYS.ExtensionActionSiteVaultEmpty,
            },
          },
        ],
      },
    }
    for (const admitted of [ready, empty]) {
      expect(
        WireFixture.decodes(SidePanelSiteMessages.decodeListing(admitted)),
      ).toBe(true)
    }
    const withRow = (extra: BrowserRuntimeMessageValue) => ({
      ...ready,
      listing: {
        ...ready.listing,
        sections: [{ ...section, content: { kind: 'Listed', rows: [extra] } }],
      },
    })
    const leaking: BrowserRuntimeMessageValue[] = [
      withRow({ ...row, password: 'hunter2' }),
      withRow({ ...row, code: '123456' }),
      withRow({ ...row, websiteUrl: 'https://example.com/?t=1' }),
      withRow({ ...row, action: { kind: 'Reveal' } }),
      // The section names the vault; a row naming it again is refused.
      withRow({ ...row, vault: { kind: 'Named', name: 'test' } }),
      { ...ready, items: [] },
      { ...ready, url: 'https://www.example.com/login' },
      { ...ready, authorizationGeneration: 'generation' },
      // No device key or id travels with a section.
      {
        ...ready,
        listing: {
          ...ready.listing,
          sections: [{ ...section, device_id: 'device-personal' }],
        },
      },
      { ...empty, listing: { ...empty.listing, host: 'www.example.com' } },
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
  const row = {
    kind: 'Authenticator',
    item_id: { vault_store_id: 'store_abcdefghijk', secret_id: 'totp_one' },
    type_label_key: I18N_KEYS.VaultTypesAuthenticator,
    title: 'Namecheap',
    account: 'person',
    saved_host: 'www.namecheap.com',
    action: {
      kind: 'FillCode',
      label_key: I18N_KEYS.ExtensionActionFillCode,
      accessible_label_key: I18N_KEYS.ExtensionActionFillCodeFor,
    },
  } satisfies SiteSecretRow
  const section = {
    vault_store_id: 'store_abcdefghijk',
    identity: { kind: 'Named', name: 'work' },
    vault: { kind: 'Named', name: 'Personal' },
    content: { kind: 'Listed', rows: [row] },
  } satisfies SiteSecretSection
  const emptySection = {
    vault_store_id: 'store_bcdefghijkl',
    identity: {
      kind: 'Unnamed',
      message_key: I18N_KEYS.ExtensionCompanionOtherVaults,
    },
    vault: { kind: 'Unnamed', message_key: I18N_KEYS.LoginVaultPickerUnnamed },
    content: {
      kind: 'Empty',
      message_key: I18N_KEYS.ExtensionActionSiteVaultEmpty,
    },
  } satisfies SiteSecretSection
  const listed = {
    summary: { kind: 'Listed' },
    sections: [section, emptySection],
  } satisfies SiteSecretListing

  test('lists through one runtime request and never listens for broadcasts', async () => {
    const expected: SidePanelSiteListing = {
      kind: SidePanelSiteListingKind.Ready,
      display_host: 'www.example.com',
      listing: listed,
    }
    const fixture = new PanelRuntimeFixture({
      kind: SidePanelSiteListingKind.Ready,
      display_host: 'www.example.com',
      listing: listed,
    })

    const listing = await fixture.client().list({ windowId: 7 })

    expect(listing).toEqual(expected)
    expect(fixture.sent.map(([message]) => message)).toEqual([
      { type: SidePanelSiteMessageType.ListLogins, payload: { windowId: 7 } },
    ])
    expect(fixture.addListener).not.toHaveBeenCalled()
    expect(fixture.tabsSendMessage).not.toHaveBeenCalled()
  })

  test("decodes Rust's empty state above every section's muted line", async () => {
    const empty = {
      summary: {
        kind: 'Empty',
        message_key: I18N_KEYS.ExtensionActionSiteEmptyAny,
        hint: {
          kind: 'Shown',
          message_key: I18N_KEYS.ExtensionActionSiteEmptyHint,
        },
      },
      sections: [emptySection],
    } satisfies SiteSecretListing
    const expected: SidePanelSiteListing = {
      kind: SidePanelSiteListingKind.Ready,
      display_host: 'news.example.org',
      listing: empty,
    }
    const fixture = new PanelRuntimeFixture({
      kind: SidePanelSiteListingKind.Ready,
      display_host: 'news.example.org',
      listing: empty,
    })

    expect(await fixture.client().list({ windowId: 7 })).toEqual(expected)
  })

  test('refuses a row naming its vault, the former groups shape, and an unbounded section', async () => {
    const refused = [
      // The section header names the vault; a row carries no vault.
      {
        ...listed,
        sections: [
          {
            ...section,
            content: {
              kind: 'Listed',
              rows: [{ ...row, vault: { kind: 'Named', name: 'Personal' } }],
            },
          },
        ],
      },
      { kind: 'Listed', groups: [{ header: section.identity, rows: [row] }] },
      { ...listed, sections: [{ ...section, vault_store_id: '' }] },
      {
        ...listed,
        sections: [{ ...emptySection, content: { kind: 'Empty' } }],
      },
      { summary: { kind: 'Empty' }, sections: [] },
    ]
    for (const listing of refused) {
      const fixture = new PanelRuntimeFixture({
        kind: SidePanelSiteListingKind.Ready,
        display_host: 'a.test',
        listing,
      })
      expect(await fixture.client().list({ windowId: 7 })).toEqual({
        kind: SidePanelSiteListingKind.ListFailed,
      })
    }
  })

  test('an unanswered or malformed listing is a visible list failure, never an empty list', async () => {
    const unanswered = new PanelRuntimeFixture({
      kind: SidePanelSiteListingKind.Ready,
      display_host: 'a.test',
      listing: listed,
    }).withoutReceiver()
    const malformed = new PanelRuntimeFixture({ kind: 'ready', items: [] })
    // A row carrying anything beyond Rust's display fields is refused.
    const leaky = new PanelRuntimeFixture({
      kind: SidePanelSiteListingKind.Ready,
      display_host: 'a.test',
      listing: {
        ...listed,
        sections: [
          {
            ...section,
            content: { kind: 'Listed', rows: [{ ...row, code: '123456' }] },
          },
        ],
      },
    })
    const unknownKind = new PanelRuntimeFixture({
      kind: SidePanelSiteListingKind.Ready,
      display_host: 'a.test',
      listing: {
        ...listed,
        sections: [
          {
            ...section,
            content: { kind: 'Listed', rows: [{ ...row, kind: 'CreditCard' }] },
          },
        ],
      },
    })
    for (const fixture of [leaky, unknownKind]) {
      expect(await fixture.client().list({ windowId: 7 })).toEqual({
        kind: SidePanelSiteListingKind.ListFailed,
      })
    }

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

  test('fills a code by sending the opaque item id and returns the typed outcome', async () => {
    const fixture = new PanelRuntimeFixture({
      kind: SidePanelCodeFillKind.NoCodeField,
    })
    const request: SidePanelLoginFillRequest = { windowId: 7, itemId }

    expect(await fixture.client().fillCode(request)).toEqual({
      kind: SidePanelCodeFillKind.NoCodeField,
    })
    expect(fixture.sent.map(([message]) => message)).toEqual([
      {
        type: SidePanelSiteMessageType.FillCode,
        payload: { windowId: 7, itemId },
      },
    ])
    const unanswered = new PanelRuntimeFixture({
      kind: SidePanelCodeFillKind.Filled,
    }).withoutReceiver()
    expect(await unanswered.client().fillCode(request)).toEqual({
      kind: SidePanelCodeFillKind.FillFailed,
    })
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
