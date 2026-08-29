import { describe, expect, mock, test } from 'bun:test'
import { WebsiteAuthenticatorResponseStatus } from '../src/lib/login-fill-messages'
import { OpenCompanionLauncherIntent } from '../../nook-web-shared/src/extension/companion-launcher-message'

type GrantAccessResponse =
  | {
      response: {
        ok: true
        status: WebsiteAuthenticatorResponseStatus.Unavailable
      }
    }
  | { response: { ok: false; reason: string } }

let grantAccessResponse: GrantAccessResponse = {
  response: {
    ok: true,
    status: WebsiteAuthenticatorResponseStatus.Unavailable,
  },
}
const availableWebsiteGrants = mock(() =>
  Promise.resolve(grantAccessResponse),
)
const openedUrls: string[] = []
Object.assign(globalThis, {
  chrome: {
    runtime: {
      getURL: (path: string) => `chrome-extension://nook/${path}`,
    },
    windows: {
      create: ({ url }: Parameters<typeof chrome.windows.create>[0]) => {
        openedUrls.push(url)
        return Promise.resolve({})
      },
    },
  } as typeof chrome,
})
const openCompanionLauncherBestEffort = mock(
  (intent: OpenCompanionLauncherIntent) => {
    if (intent !== OpenCompanionLauncherIntent.Default) return
    void chrome.windows.create({
      url: chrome.runtime.getURL('popup/index.html'),
      type: 'popup',
      focused: true,
    })
  },
)
const unusedAsyncDependency = mock(() =>
  Promise.reject(new Error('unused login options test dependency')),
)

mock.module('../src/background/service-worker/pairing-identity', () => ({
  availableWebsiteGrants,
  getSessionStorage: unusedAsyncDependency,
  isAuthorizedWebsiteSender: mock(() => false),
  passwordPairingGrants: unusedAsyncDependency,
  removeSessionStorage: unusedAsyncDependency,
  sendSessionMessage: unusedAsyncDependency,
  setSessionStorage: unusedAsyncDependency,
}))

mock.module('../src/background/pairing-grants', () => ({
  extensionSessionGrantIdentity: mock(() => ({
    vaultStoreId: 'unused',
    deviceId: 'unused',
  })),
}))

mock.module('../src/offscreen/session-request-adapter', () => ({
  extensionSessionInteractiveDeadline: mock(() => ({
    deadlineMs: 4_000,
  })),
  MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE: { kind: 'default' },
}))

mock.module('../src/background/service-worker/session-lifecycle', () => ({
  SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS: 4_000,
  ensureExtensionSessionDocument: unusedAsyncDependency,
  isUnlockedSessionStatus: mock(() => false),
  openCompanionLauncherBestEffort,
}))

describe('websiteLoginOptions', () => {
  test('opens one trusted companion surface when Continue finds no grant', async () => {
    const { websiteLoginOptions } =
      await import('../src/background/service-worker/account-pickers')
    const response = await websiteLoginOptions({
      message: { payload: { origin: 'https://example.test' } },
      sender: {
        id: 'nook-extension',
        url: 'https://example.test/login',
        tab: { id: 42 },
      },
    })

    expect(response).toEqual({
      ok: true,
      status: WebsiteAuthenticatorResponseStatus.Unavailable,
    })
    expect(openCompanionLauncherBestEffort).toHaveBeenCalledTimes(1)
    expect(openCompanionLauncherBestEffort).toHaveBeenCalledWith(
      OpenCompanionLauncherIntent.Default,
    )
    expect(openedUrls).toEqual(['chrome-extension://nook/popup/index.html'])

    grantAccessResponse = {
      response: { ok: false, reason: 'login-forbidden-origin' },
    }
    const rejectedResponse = await websiteLoginOptions({
      message: { payload: { origin: 'https://example.test' } },
      sender: {
        id: 'foreign-extension',
        url: 'https://example.test/login',
        tab: { id: 42 },
      },
    })

    expect(rejectedResponse).toEqual({
      ok: false,
      reason: 'login-forbidden-origin',
    })
    expect(openCompanionLauncherBestEffort).toHaveBeenCalledTimes(1)
    expect(openedUrls).toEqual(['chrome-extension://nook/popup/index.html'])
  })
})
