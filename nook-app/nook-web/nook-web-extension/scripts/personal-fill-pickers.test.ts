import { describe, expect, test } from 'bun:test'
import type { StoredExtensionPairingGrant } from '../src/background/pairing-grants'
import {
  PersonalFillGrantAccessKind,
  PersonalFillPickers,
  PersonalFillRecordListingKind,
  type PersonalFillGrantAccess,
  type PersonalFillPageDelivery,
  type PersonalFillPickerDependencies,
  type PersonalFillRecordListing,
  type PersonalFillRecordListingRequest,
  type PersonalFillValueRevealRequest,
} from '../src/background/service-worker/personal-fill-pickers'
import {
  PersonalFillCancelResponseKind,
  PersonalFillMessageType,
  PersonalFillOpenResponseKind,
  PersonalFillPageResponseKind,
  PersonalFillQueryResponseKind,
  PersonalFillRevealResponseKind,
  PersonalFillSelectResponseKind,
  type PersonalFillOpenResponse,
  type PersonalFillRevealResponse,
} from '../src/lib/personal-fill-messages'

const PICKER_URL = 'chrome-extension://nook/personal-picker/index.html'
const EXTENSION_ORIGIN = 'chrome-extension://nook'
const SITE = 'https://shop.example'

/** Stubbed worker capabilities around one tab with a personal picker frame. */
class PersonalPickersFixture {
  static readonly TAB: chrome.tabs.Tab = {
    id: 7,
    index: 0,
    pinned: false,
    highlighted: false,
    windowId: 1,
    active: true,
    incognito: false,
    selected: true,
    discarded: false,
    autoDiscardable: true,
    frozen: false,
    lastAccessed: 0,
    groupId: -1,
  }
  generation = 'generation-1'
  access: PersonalFillGrantAccess
  listing: PersonalFillRecordListing = {
    kind: PersonalFillRecordListingKind.Listed,
    records: [
      { secretId: 'person-1', title: 'Ada Lovelace', summary: 'ada@nook.test' },
    ],
  }
  readonly listed: PersonalFillRecordListingRequest[] = []
  readonly revealed: PersonalFillValueRevealRequest[] = []
  readonly delivered: PersonalFillPageDelivery[] = []
  revealResponse: PersonalFillRevealResponse = {
    kind: PersonalFillRevealResponseKind.Revealed,
    values: [{ kind: 'GivenName', value: 'Ada' }],
  }
  readonly grant: StoredExtensionPairingGrant
  readonly pickers: PersonalFillPickers

  constructor(grant: StoredExtensionPairingGrant) {
    this.grant = grant
    this.access = { kind: PersonalFillGrantAccessKind.Granted, grants: [grant] }
    const dependencies: PersonalFillPickerDependencies = {
      authorizationGeneration: async () => this.generation,
      generationIsCurrent: (generation) => generation === this.generation,
      grantAccess: async () => this.access,
      passwordGrants: async () => [this.grant],
      isWebsiteSender: (request) =>
        request.sender.id === 'nook' &&
        request.sender.url?.startsWith(request.origin) === true,
      listRecords: async (request) => {
        this.listed.push(request)
        return this.listing
      },
      revealValues: async (request) => {
        this.revealed.push(request)
        return this.revealResponse
      },
      sendToPage: async (delivery) => {
        this.delivered.push(delivery)
        return { kind: PersonalFillPageResponseKind.Acknowledged }
      },
      randomNonce: () => 'request-1',
      now: () => 1_000,
      runtimeId: 'nook',
      pickerUrl: PICKER_URL,
      extensionOrigin: EXTENSION_ORIGIN,
    }
    this.pickers = new PersonalFillPickers(dependencies)
  }

  static grantFixture(): StoredExtensionPairingGrant {
    return {
      vaultType: 'simple',
      vaultStoreId: 'vault-1',
      deviceId: 'device',
      devicePublicKey: 'public',
      deviceSigningPublicKey: 'signing',
      vaultName: 'Personal',
      identityLabel: 'Me',
      deviceLabel: 'Laptop',
      approvedAt: 1_786_320_000_000,
      scopes: ['password-filling'],
      syncProviderCount: 0,
      eventCount: 1,
      eventLogHeads: ['event-1'],
      lastLocalSyncAt: '2026-08-10T00:00:00Z',
    }
  }

  page(): chrome.runtime.MessageSender {
    return {
      id: 'nook',
      url: `${SITE}/checkout`,
      tab: PersonalPickersFixture.TAB,
      frameId: 0,
      documentId: 'page-document',
    }
  }

  pickerDocument(documentId = 'picker-document'): chrome.runtime.MessageSender {
    return {
      id: 'nook',
      url: PICKER_URL,
      origin: EXTENSION_ORIGIN,
      tab: PersonalPickersFixture.TAB,
      frameId: 3,
      documentId,
    }
  }

  open(): Promise<PersonalFillOpenResponse> {
    return this.pickers.open({
      message: {
        type: PersonalFillMessageType.Open,
        payload: { origin: SITE, group: 'Person' },
      },
      sender: this.page(),
    })
  }

  query(sender: chrome.runtime.MessageSender) {
    return this.pickers.query({
      message: {
        type: PersonalFillMessageType.Query,
        payload: { requestId: 'request-1', parentOrigin: SITE },
      },
      sender,
    })
  }

  select(sender: chrome.runtime.MessageSender, secretId = 'person-1') {
    return this.pickers.select({
      message: {
        type: PersonalFillMessageType.Select,
        payload: { requestId: 'request-1', vaultStoreId: 'vault-1', secretId },
      },
      sender,
    })
  }

  reveal(sender: chrome.runtime.MessageSender) {
    return this.pickers.reveal({
      message: {
        type: PersonalFillMessageType.Reveal,
        payload: { origin: SITE, requestId: 'request-1', kinds: ['GivenName'] },
      },
      sender,
    })
  }
}

function fixture(): PersonalPickersFixture {
  return new PersonalPickersFixture(PersonalPickersFixture.grantFixture())
}

describe('service-worker personal picker requests', () => {
  test('opens a bound request for an unlocked sender-checked page', async () => {
    const pickers = fixture()
    expect(await pickers.open()).toEqual({
      kind: PersonalFillOpenResponseKind.Ready,
      requestId: 'request-1',
      expiresAt: 1_000 + PersonalFillPickers.TTL_MS,
    })
  })

  test.each([
    [PersonalFillGrantAccessKind.Locked, PersonalFillOpenResponseKind.Locked],
    [
      PersonalFillGrantAccessKind.Unavailable,
      PersonalFillOpenResponseKind.Unavailable,
    ],
    [
      PersonalFillGrantAccessKind.Forbidden,
      PersonalFillOpenResponseKind.Failed,
    ],
  ] as const)('answers %s grant access with %s', async (access, response) => {
    const pickers = fixture()
    pickers.access = { kind: access }
    expect((await pickers.open()).kind).toBe(response)
  })

  test('lists only through the picker document and pins its first document', async () => {
    const pickers = fixture()
    await pickers.open()

    expect(await pickers.query(pickers.page())).toEqual({
      kind: PersonalFillQueryResponseKind.Failed,
    })
    expect(await pickers.query(pickers.pickerDocument())).toEqual({
      kind: PersonalFillQueryResponseKind.Ready,
      records: [
        {
          vaultStoreId: 'vault-1',
          secretId: 'person-1',
          title: 'Ada Lovelace',
          summary: 'ada@nook.test',
        },
      ],
    })
    expect(pickers.listed.map((request) => request.group)).toEqual(['Person'])
    expect(
      await pickers.query(pickers.pickerDocument('another-picker-document')),
    ).toEqual({ kind: PersonalFillQueryResponseKind.Failed })
  })

  test('fails the listing when a grant listing fails instead of listing nothing', async () => {
    const pickers = fixture()
    await pickers.open()
    pickers.listing = { kind: PersonalFillRecordListingKind.Failed }
    expect(await pickers.query(pickers.pickerDocument())).toEqual({
      kind: PersonalFillQueryResponseKind.Failed,
    })
  })

  test('a selection notifies the requesting page and the page reveals it once', async () => {
    const pickers = fixture()
    await pickers.open()
    await pickers.query(pickers.pickerDocument())

    expect(await pickers.select(pickers.pickerDocument())).toEqual({
      kind: PersonalFillSelectResponseKind.Selected,
    })
    expect(pickers.delivered).toEqual([
      {
        tabId: 7,
        frameId: 0,
        documentId: 'page-document',
        message: {
          type: PersonalFillMessageType.Selected,
          payload: { origin: SITE, requestId: 'request-1' },
        },
      },
    ])
    // Another document cannot use the selection.
    expect(await pickers.reveal(pickers.pickerDocument())).toEqual({
      kind: PersonalFillRevealResponseKind.Failed,
    })
    expect(await pickers.reveal(pickers.page())).toEqual(pickers.revealResponse)
    expect(pickers.revealed).toEqual([
      {
        grant: pickers.grant,
        secretId: 'person-1',
        group: 'Person',
        kinds: ['GivenName'],
      },
    ])
    expect(await pickers.reveal(pickers.page())).toEqual({
      kind: PersonalFillRevealResponseKind.Failed,
    })
    expect(pickers.revealed).toHaveLength(1)
  })

  test('rejects a record that is not in the fresh listing and reveals nothing', async () => {
    const pickers = fixture()
    await pickers.open()
    await pickers.query(pickers.pickerDocument())

    expect(await pickers.select(pickers.pickerDocument(), 'person-2')).toEqual({
      kind: PersonalFillSelectResponseKind.Failed,
    })
    expect(pickers.delivered).toEqual([])
    expect(await pickers.reveal(pickers.page())).toEqual({
      kind: PersonalFillRevealResponseKind.Failed,
    })
  })

  test('a lock during the reveal wipes the values and answers locked', async () => {
    const pickers = fixture()
    await pickers.open()
    await pickers.query(pickers.pickerDocument())
    await pickers.select(pickers.pickerDocument())
    const values = [{ kind: 'GivenName', value: 'Ada' }]
    pickers.revealResponse = {
      kind: PersonalFillRevealResponseKind.Revealed,
      values,
    }
    const lockedReveal = pickers.reveal(pickers.page())
    pickers.generation = 'generation-2'

    expect(await lockedReveal).toEqual({
      kind: PersonalFillRevealResponseKind.Locked,
    })
    expect(values).toEqual([{ kind: 'GivenName', value: '' }])
  })

  test('the page cancels its own request and the picker notifies the page', async () => {
    const pickers = fixture()
    await pickers.open()
    expect(
      await pickers.pickers.cancel({
        message: {
          type: PersonalFillMessageType.Cancel,
          payload: { requestId: 'request-1' },
        },
        sender: pickers.pickerDocument(),
      }),
    ).toEqual({ kind: PersonalFillCancelResponseKind.Forbidden })
    await pickers.query(pickers.pickerDocument())
    expect(
      await pickers.pickers.cancel({
        message: {
          type: PersonalFillMessageType.Cancel,
          payload: { requestId: 'request-1' },
        },
        sender: pickers.pickerDocument(),
      }),
    ).toEqual({ kind: PersonalFillCancelResponseKind.Canceled })
    expect(pickers.delivered.map((delivery) => delivery.message.type)).toEqual([
      PersonalFillMessageType.Canceled,
    ])
    expect(await pickers.query(pickers.pickerDocument())).toEqual({
      kind: PersonalFillQueryResponseKind.Failed,
    })
  })
})
