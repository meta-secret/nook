import { beforeAll, describe, expect, mock, test } from 'bun:test'
import { err, ok } from 'neverthrow'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import {
  ExtensionSessionMessageDispatcher,
  ExtensionSessionMessageType,
  MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
  decodeProviders,
  vaultImportRequest,
} from './session-message-dispatch-test-support'
import type { SessionMessageDispatchContext } from '../src/offscreen/session-message-dispatch'
import type { ExtensionSessionRequest } from '../src/offscreen/session-request-adapter'
import {
  SessionOperationFailure,
  SessionOperationFailureKind,
} from '../src/lib/session-operation-queue'
import { SIDE_PANEL_PAGE_PATH } from '../src/lib/side-panel-site'

type RuntimeListener = Parameters<
  typeof chrome.runtime.onMessage.addListener
>[0]
type RuntimeResponse = Parameters<Parameters<RuntimeListener>[2]>[0]
type GateResponse =
  { readonly ok: true } | { readonly ok: false; readonly error: string }

const extensionId = 'nook-extension'
const extensionUrl = (path: string) =>
  `chrome-extension://${extensionId}/${path}`
const pageTab: chrome.tabs.Tab = {
  id: 5,
  index: 0,
  pinned: false,
  highlighted: true,
  windowId: 7,
  active: true,
  incognito: false,
  selected: true,
  discarded: false,
  autoDiscardable: true,
  frozen: false,
  lastAccessed: 0,
  groupId: -1,
}
const grantIdentity = {
  vaultStoreId: 'store_abcdefghijk',
  deviceId: 'device',
  devicePublicKey: 'public',
  deviceSigningPublicKey: 'signing',
}
const forbidden: GateResponse = {
  ok: false,
  error: 'Forbidden extension session request.',
}

const serviceWorker: chrome.runtime.MessageSender = {
  id: extensionId,
  url: extensionUrl('background/service-worker.js'),
}
const otherSenders: Array<[string, chrome.runtime.MessageSender]> = [
  [
    'side panel',
    {
      id: extensionId,
      url: extensionUrl(SIDE_PANEL_PAGE_PATH),
      origin: `chrome-extension://${extensionId}`,
    },
  ],
  [
    'auth tab',
    {
      id: extensionId,
      url: extensionUrl('popup/index.html'),
      tab: pageTab,
      frameId: 0,
      documentId: 'DOC',
    },
  ],
  [
    'content script',
    {
      id: extensionId,
      url: 'https://example.com/login',
      origin: 'https://example.com',
      tab: pageTab,
      frameId: 0,
      documentId: 'DOC',
    },
  ],
]

/** Requests that release or write vault content; only the worker sends them. */
const workerOnlyRequests: ExtensionSessionRequest[] = [
  {
    type: ExtensionSessionMessageType.RevealLogin,
    payload: {
      ...grantIdentity,
      origin: 'https://example.com',
      secretId: 'secret_login',
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  },
  {
    type: ExtensionSessionMessageType.ListAuthenticators,
    payload: {
      ...grantIdentity,
      query: '',
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  },
  {
    type: ExtensionSessionMessageType.AuthenticatorCode,
    payload: {
      ...grantIdentity,
      secretId: 'secret_totp',
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  },
  vaultImportRequest([]),
]

/** The installed offscreen listener with a recording session behind it. */
class OffscreenGateFixture {
  readonly enqueued = mock((request: ExtensionSessionRequest) => {
    void request
    return Promise.resolve(
      ok<GateResponse, SessionOperationFailure>({ ok: true }),
    )
  })
  readonly handled = mock((request: ExtensionSessionRequest) => {
    void request
    return Promise.resolve(
      ok<GateResponse, SessionOperationFailure>({ ok: true }),
    )
  })
  readonly listener: RuntimeListener

  constructor() {
    Object.assign(globalThis, {
      chrome: { runtime: { id: extensionId, getURL: extensionUrl } },
    })
    const context: SessionMessageDispatchContext<GateResponse> = {
      decodeProviders,
      handleMessage: this.handled,
      handleCompanionIdentityDiscovery: async () =>
        err(
          new SessionOperationFailure(
            SessionOperationFailureKind.InvalidRequest,
          ),
        ),
      handleCompanionIdentityHandoff: async () =>
        err(
          new SessionOperationFailure(
            SessionOperationFailureKind.InvalidRequest,
          ),
        ),
    }
    const dispatcher = new ExtensionSessionMessageDispatcher(context)
    dispatcher.enqueue = this.enqueued
    this.listener = dispatcher.listener()
  }

  send(
    request: ExtensionSessionRequest,
    sender: chrome.runtime.MessageSender,
  ): Promise<RuntimeResponse> {
    const response = Promise.withResolvers<RuntimeResponse>()
    const open = this.listener(request, sender, response.resolve)
    expect(Boolean(open)).toBe(true)
    return response.promise
  }

  forwarded(): number {
    return this.enqueued.mock.calls.length + this.handled.mock.calls.length
  }
}

beforeAll(async () => {
  await companionWasmReady
})

describe('offscreen service-worker-only session gate', () => {
  test('admits secret-releasing and vault-writing requests from the service worker', async () => {
    for (const request of workerOnlyRequests) {
      const fixture = new OffscreenGateFixture()
      expect(await fixture.send(request, serviceWorker)).toEqual({ ok: true })
      expect(fixture.forwarded()).toBe(1)
    }
  })

  test('refuses them from the side panel, the auth tab and content scripts', async () => {
    for (const request of workerOnlyRequests) {
      for (const [, sender] of otherSenders) {
        const fixture = new OffscreenGateFixture()
        expect(await fixture.send(request, sender)).toEqual(forbidden)
        expect(fixture.forwarded()).toBe(0)
      }
    }
  })

  test('keeps the extension-page requests the pages send', async () => {
    const status: ExtensionSessionRequest = {
      type: ExtensionSessionMessageType.Status,
      payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
    }
    const [, sidePanel] = otherSenders[0] ?? []
    if (!sidePanel) throw new Error('side-panel sender fixture')
    const fixture = new OffscreenGateFixture()
    expect(await fixture.send(status, sidePanel)).toEqual({ ok: true })
    expect(fixture.forwarded()).toBe(1)
  })
})
