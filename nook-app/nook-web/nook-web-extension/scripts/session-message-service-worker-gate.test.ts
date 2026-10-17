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
  ExtensionSessionRequestAudience,
  ExtensionSessionSenderAdmission,
  ExtensionSessionSenderKind,
  ExtensionSessionSenderPolicy,
} from '../src/offscreen/session-sender-policy'
import {
  SessionOperationFailure,
  SessionOperationFailureKind,
} from '../src/lib/session-operation-queue'
import { SIDE_PANEL_PAGE_PATH } from '../src/lib/side-panel-page-path'

type RuntimeListener = Parameters<
  typeof chrome.runtime.onMessage.addListener
>[0]
type RuntimeResponse = Parameters<Parameters<RuntimeListener>[2]>[0]
type GateResponse =
  { readonly ok: true } | { readonly ok: false; readonly error: string }
type NamedSender = readonly [name: string, sender: chrome.runtime.MessageSender]
type SenderAdmissionCase = {
  readonly sender: chrome.runtime.MessageSender
  readonly type: ExtensionSessionMessageType
}

/** The senders the offscreen session can see, as Chrome reports them. */
class SessionSenders {
  static readonly extensionId = 'nook-extension'
  static readonly forbidden: GateResponse = {
    ok: false,
    error: 'Forbidden extension session request.',
  }
  static readonly grantIdentity = {
    vaultStoreId: 'store_abcdefghijk',
    deviceId: 'device',
    devicePublicKey: 'public',
    deviceSigningPublicKey: 'signing',
  }

  static url(path: string): string {
    return `chrome-extension://${SessionSenders.extensionId}/${path}`
  }

  static tab(): chrome.tabs.Tab {
    return {
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
  }

  static serviceWorker(): chrome.runtime.MessageSender {
    return {
      id: SessionSenders.extensionId,
      url: SessionSenders.url('background/service-worker.js'),
    }
  }

  static sidePanel(): chrome.runtime.MessageSender {
    return {
      id: SessionSenders.extensionId,
      url: SessionSenders.url(SIDE_PANEL_PAGE_PATH),
      origin: `chrome-extension://${SessionSenders.extensionId}`,
    }
  }

  static authTab(): chrome.runtime.MessageSender {
    return {
      id: SessionSenders.extensionId,
      url: SessionSenders.url('popup/index.html'),
      tab: SessionSenders.tab(),
      frameId: 0,
      documentId: 'DOC',
    }
  }

  static contentScript(): chrome.runtime.MessageSender {
    return {
      id: SessionSenders.extensionId,
      url: 'https://example.com/login',
      origin: 'https://example.com',
      tab: SessionSenders.tab(),
      frameId: 0,
      documentId: 'DOC',
    }
  }

  static extensionPages(): readonly NamedSender[] {
    return [
      ['side panel', SessionSenders.sidePanel()],
      ['auth tab', SessionSenders.authTab()],
    ]
  }

  /** What an extension page may expect for a request with this audience. */
  static pageAdmission(
    audience: ExtensionSessionRequestAudience,
  ): ExtensionSessionSenderAdmission {
    switch (audience) {
      case ExtensionSessionRequestAudience.ExtensionPages:
        return ExtensionSessionSenderAdmission.Admitted
      case ExtensionSessionRequestAudience.ServiceWorker:
        return ExtensionSessionSenderAdmission.Forbidden
    }
  }

  static install(): void {
    Object.assign(globalThis, {
      chrome: {
        runtime: { id: SessionSenders.extensionId, getURL: SessionSenders.url },
      },
    })
  }
}

/**
 * Who may send every session request type. Each row is this test's own
 * expectation; changing a type's audience in the policy fails its row, and
 * a new type cannot compile here until it is classified.
 */
const expectedAudiences: Readonly<
  Record<ExtensionSessionMessageType, ExtensionSessionRequestAudience>
> = {
  [ExtensionSessionMessageType.ClassifyGrantAuthority]:
    ExtensionSessionRequestAudience.ServiceWorker,
  [ExtensionSessionMessageType.Reset]:
    ExtensionSessionRequestAudience.ServiceWorker,
  [ExtensionSessionMessageType.MigrateAuthProviders]:
    ExtensionSessionRequestAudience.ServiceWorker,
  [ExtensionSessionMessageType.Status]:
    ExtensionSessionRequestAudience.ExtensionPages,
  [ExtensionSessionMessageType.BeginPasskeySetup]:
    ExtensionSessionRequestAudience.ExtensionPages,
  [ExtensionSessionMessageType.FinishPasskeySetup]:
    ExtensionSessionRequestAudience.ExtensionPages,
  [ExtensionSessionMessageType.RecoverPasskey]:
    ExtensionSessionRequestAudience.ExtensionPages,
  [ExtensionSessionMessageType.UnlockOptions]:
    ExtensionSessionRequestAudience.ExtensionPages,
  [ExtensionSessionMessageType.UnlockPasskey]:
    ExtensionSessionRequestAudience.ExtensionPages,
  [ExtensionSessionMessageType.CreatePin]:
    ExtensionSessionRequestAudience.ExtensionPages,
  [ExtensionSessionMessageType.UnlockPin]:
    ExtensionSessionRequestAudience.ExtensionPages,
  [ExtensionSessionMessageType.SealIdentityHandoff]:
    ExtensionSessionRequestAudience.ServiceWorker,
  [ExtensionSessionMessageType.ImportVault]:
    ExtensionSessionRequestAudience.ServiceWorker,
  [ExtensionSessionMessageType.JoinIdentity]:
    ExtensionSessionRequestAudience.ServiceWorker,
  [ExtensionSessionMessageType.ConnectIdentityVault]:
    ExtensionSessionRequestAudience.ServiceWorker,
  [ExtensionSessionMessageType.RefreshIdentityVaults]:
    ExtensionSessionRequestAudience.ServiceWorker,
  [ExtensionSessionMessageType.BeginIdentityConnection]:
    ExtensionSessionRequestAudience.ExtensionPages,
  [ExtensionSessionMessageType.CancelIdentityConnection]:
    ExtensionSessionRequestAudience.ExtensionPages,
  [ExtensionSessionMessageType.ActivateIdentity]:
    ExtensionSessionRequestAudience.ExtensionPages,
  [ExtensionSessionMessageType.UpdateVault]:
    ExtensionSessionRequestAudience.ServiceWorker,
  [ExtensionSessionMessageType.ExportVaultEventLog]:
    ExtensionSessionRequestAudience.ServiceWorker,
  [ExtensionSessionMessageType.VaultSummary]:
    ExtensionSessionRequestAudience.ExtensionPages,
  [ExtensionSessionMessageType.ListPasskeys]:
    ExtensionSessionRequestAudience.ServiceWorker,
  [ExtensionSessionMessageType.ListLogins]:
    ExtensionSessionRequestAudience.ExtensionPages,
  [ExtensionSessionMessageType.RevealLogin]:
    ExtensionSessionRequestAudience.ServiceWorker,
  [ExtensionSessionMessageType.RevealFocusedLogin]:
    ExtensionSessionRequestAudience.ServiceWorker,
  [ExtensionSessionMessageType.ListAuthenticators]:
    ExtensionSessionRequestAudience.ServiceWorker,
  [ExtensionSessionMessageType.AuthenticatorCode]:
    ExtensionSessionRequestAudience.ServiceWorker,
  [ExtensionSessionMessageType.AuthenticatorEnrollPreview]:
    ExtensionSessionRequestAudience.ServiceWorker,
  [ExtensionSessionMessageType.AuthenticatorEnrollCode]:
    ExtensionSessionRequestAudience.ServiceWorker,
  [ExtensionSessionMessageType.AuthenticatorEnrollConfirm]:
    ExtensionSessionRequestAudience.ServiceWorker,
  [ExtensionSessionMessageType.AuthenticatorBackupAttach]:
    ExtensionSessionRequestAudience.ServiceWorker,
  [ExtensionSessionMessageType.PlanLoginSave]:
    ExtensionSessionRequestAudience.ServiceWorker,
  [ExtensionSessionMessageType.PendingLoginSave]:
    ExtensionSessionRequestAudience.ServiceWorker,
  [ExtensionSessionMessageType.CommitLoginSave]:
    ExtensionSessionRequestAudience.ServiceWorker,
  [ExtensionSessionMessageType.DismissLoginSave]:
    ExtensionSessionRequestAudience.ServiceWorker,
  [ExtensionSessionMessageType.CancelPasskey]:
    ExtensionSessionRequestAudience.ServiceWorker,
  [ExtensionSessionMessageType.RegisterPasskey]:
    ExtensionSessionRequestAudience.ServiceWorker,
  [ExtensionSessionMessageType.AssertPasskey]:
    ExtensionSessionRequestAudience.ServiceWorker,
  [ExtensionSessionMessageType.Lock]:
    ExtensionSessionRequestAudience.ExtensionPages,
}

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
    SessionSenders.install()
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

class SessionRequests {
  static revealLogin(): ExtensionSessionRequest {
    return {
      type: ExtensionSessionMessageType.RevealLogin,
      payload: {
        ...SessionSenders.grantIdentity,
        origin: 'https://example.com',
        secretId: 'secret_login',
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    }
  }

  static workerOnly(): readonly ExtensionSessionRequest[] {
    return [
      SessionRequests.revealLogin(),
      {
        type: ExtensionSessionMessageType.ListAuthenticators,
        payload: {
          ...SessionSenders.grantIdentity,
          query: '',
          queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
        },
      },
      {
        type: ExtensionSessionMessageType.AuthenticatorCode,
        payload: {
          ...SessionSenders.grantIdentity,
          secretId: 'secret_totp',
          queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
        },
      },
      {
        type: ExtensionSessionMessageType.Reset,
        payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
      },
      {
        type: ExtensionSessionMessageType.MigrateAuthProviders,
        payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
      },
      vaultImportRequest([]),
    ]
  }

  static status(): ExtensionSessionRequest {
    return {
      type: ExtensionSessionMessageType.Status,
      payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
    }
  }

  static listLogins(): ExtensionSessionRequest {
    return {
      type: ExtensionSessionMessageType.ListLogins,
      payload: {
        ...SessionSenders.grantIdentity,
        origin: 'https://example.com',
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    }
  }
}

beforeAll(async () => {
  await companionWasmReady
})

describe('offscreen session sender policy', () => {
  test('recognizes the worker, extension pages and content scripts', () => {
    SessionSenders.install()
    const kind = (sender: chrome.runtime.MessageSender) =>
      new ExtensionSessionSenderPolicy(sender).kind()
    expect(kind(SessionSenders.serviceWorker())).toBe(
      ExtensionSessionSenderKind.ServiceWorker,
    )
    expect(kind({ id: SessionSenders.extensionId })).toBe(
      ExtensionSessionSenderKind.ServiceWorker,
    )
    expect(kind(SessionSenders.sidePanel())).toBe(
      ExtensionSessionSenderKind.ExtensionPage,
    )
    expect(kind(SessionSenders.authTab())).toBe(
      ExtensionSessionSenderKind.ExtensionPage,
    )
    expect(kind(SessionSenders.contentScript())).toBe(
      ExtensionSessionSenderKind.Other,
    )
    expect(
      kind({ ...SessionSenders.serviceWorker(), tab: SessionSenders.tab() }),
    ).toBe(ExtensionSessionSenderKind.ExtensionPage)
  })

  test('every session type admits exactly its audience', () => {
    SessionSenders.install()
    const admission = (request: SenderAdmissionCase) =>
      new ExtensionSessionSenderPolicy(request.sender).admission(request.type)
    for (const type of Object.values(ExtensionSessionMessageType)) {
      expect([
        type,
        admission({ sender: SessionSenders.serviceWorker(), type }),
      ]).toEqual([type, ExtensionSessionSenderAdmission.Admitted])
      expect([
        type,
        admission({ sender: SessionSenders.contentScript(), type }),
      ]).toEqual([type, ExtensionSessionSenderAdmission.Forbidden])
      const pageAdmission = SessionSenders.pageAdmission(
        expectedAudiences[type],
      )
      for (const [, sender] of SessionSenders.extensionPages()) {
        expect([type, admission({ sender, type })]).toEqual([
          type,
          pageAdmission,
        ])
      }
    }
  })
})

describe('installed offscreen listener gate', () => {
  test('forwards worker-only requests from the service worker', async () => {
    for (const request of SessionRequests.workerOnly()) {
      const fixture = new OffscreenGateFixture()
      expect(
        await fixture.send(request, SessionSenders.serviceWorker()),
      ).toEqual({
        ok: true,
      })
      expect(fixture.forwarded()).toBe(1)
    }
  })

  test('refuses worker-only requests from extension pages and content scripts', async () => {
    const senders: readonly NamedSender[] = [
      ...SessionSenders.extensionPages(),
      ['content script', SessionSenders.contentScript()],
    ]
    for (const request of SessionRequests.workerOnly()) {
      for (const [, sender] of senders) {
        const fixture = new OffscreenGateFixture()
        expect(await fixture.send(request, sender)).toEqual(
          SessionSenders.forbidden,
        )
        expect(fixture.forwarded()).toBe(0)
      }
    }
  })

  test('keeps page requests for extension pages, including the Nook tab login listing', async () => {
    const sidePanelStatus = new OffscreenGateFixture()
    expect(
      await sidePanelStatus.send(
        SessionRequests.status(),
        SessionSenders.sidePanel(),
      ),
    ).toEqual({ ok: true })
    const authTabListing = new OffscreenGateFixture()
    expect(
      await authTabListing.send(
        SessionRequests.listLogins(),
        SessionSenders.authTab(),
      ),
    ).toEqual({ ok: true })
    expect(sidePanelStatus.forwarded() + authTabListing.forwarded()).toBe(2)
  })

  test('refuses every session request from a content script', async () => {
    for (const request of [
      SessionRequests.status(),
      SessionRequests.listLogins(),
      SessionRequests.revealLogin(),
    ]) {
      const fixture = new OffscreenGateFixture()
      expect(
        await fixture.send(request, SessionSenders.contentScript()),
      ).toEqual(SessionSenders.forbidden)
      expect(fixture.forwarded()).toBe(0)
    }
  })
})
