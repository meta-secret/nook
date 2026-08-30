import { describe, expect, mock, test } from 'bun:test'
import { WebsiteAuthenticatorResponseStatus } from '../src/lib/login-fill-messages'
import { OpenCompanionLauncherIntent } from '../../nook-web-shared/src/extension/companion-launcher-message'
import type { StoredExtensionPairingGrant } from '../src/background/pairing-grants'
import { extensionSessionProbeDeadline } from '../src/offscreen/session-request-adapter'

type GrantAccessResponse =
  | {
      response: {
        ok: true
        status:
          | WebsiteAuthenticatorResponseStatus.Unavailable
          | WebsiteAuthenticatorResponseStatus.Locked
      }
    }
  | { response: { ok: false; reason: string } }
  | { grants: [] }

type ExtensionWindowRequest = {
  url: string
}

type LoginAccountAvailabilityRequest = {
  queue: {
    kind: string
    expiresAt?: number
    priority?: string
  }
}

type LoginAccountAvailabilityResponse =
  { ok: true; accounts: [] } | { ok: false }

describe('websiteLoginOptions', () => {
  test('opens one trusted pairing surface when Continue finds no password-filling grant', async () => {
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    const { websiteLoginMatchAvailability, websiteLoginOptions } =
      await import('../src/background/service-worker/account-pickers')
    let grantAccessResponse: GrantAccessResponse = {
      response: {
        ok: true,
        status: WebsiteAuthenticatorResponseStatus.Unavailable,
      },
    }
    const availableWebsiteGrants = mock(() =>
      Promise.resolve(grantAccessResponse),
    )
    const passiveAvailableWebsiteGrants = mock(() =>
      Promise.resolve(grantAccessResponse),
    )
    const openedUrls: string[] = []
    const extensionRuntimeUrl = mock(
      (path: string) => `chrome-extension://nook/${path}`,
    )
    const openExtensionWindow = mock(({ url }: ExtensionWindowRequest) => {
      openedUrls.push(url)
    })
    const openCompanionLauncherBestEffort = mock(
      (intent: OpenCompanionLauncherIntent) => {
        if (intent !== OpenCompanionLauncherIntent.Pair) return
        const extensionWindowRequest: ExtensionWindowRequest = {
          url: extensionRuntimeUrl('popup/index.html?intent=pair'),
        }
        openExtensionWindow(extensionWindowRequest)
      },
    )
    const loginAccountsForOrigin = mock(() => Promise.resolve([]))
    let loginAccountAvailability: LoginAccountAvailabilityResponse = {
      ok: true as const,
      accounts: [],
    }
    const availabilityRequests: LoginAccountAvailabilityRequest[] = []
    const loginAccountAvailabilityForOrigin = mock(
      (request: LoginAccountAvailabilityRequest) => {
        availabilityRequests.push(request)
        return Promise.resolve(loginAccountAvailability)
      },
    )
    const dependencies = {
      availableWebsiteGrants,
      passiveAvailableWebsiteGrants,
      loginAccountsForOrigin,
      loginAccountAvailabilityForOrigin,
      openCompanionLauncherBestEffort,
    }
    const response = await websiteLoginOptions({
      message: { payload: { origin: 'https://example.test' } },
      sender: {
        id: 'nook-extension',
        url: 'https://example.test/login',
        tab: { id: 42 },
      },
      dependencies,
    })

    expect(response).toEqual({
      ok: true,
      status: WebsiteAuthenticatorResponseStatus.Unavailable,
    })
    expect(openCompanionLauncherBestEffort).toHaveBeenCalledTimes(1)
    expect(openCompanionLauncherBestEffort).toHaveBeenCalledWith(
      OpenCompanionLauncherIntent.Pair,
    )
    expect(openExtensionWindow).toHaveBeenCalledTimes(1)
    expect(openedUrls).toEqual([
      'chrome-extension://nook/popup/index.html?intent=pair',
    ])

    grantAccessResponse = {
      response: {
        ok: true,
        status: WebsiteAuthenticatorResponseStatus.Locked,
      },
    }
    const passiveResponse = await websiteLoginMatchAvailability({
      origin: 'https://example.test',
      sender: {
        id: 'nook-extension',
        url: 'https://example.test/login',
        tab: { id: 42 },
      },
      dependencies,
    })
    expect(passiveResponse).toEqual({ kind: 'locked' })
    expect(passiveAvailableWebsiteGrants).toHaveBeenCalledTimes(1)
    expect(availableWebsiteGrants).toHaveBeenCalledTimes(1)
    expect(openCompanionLauncherBestEffort).toHaveBeenCalledTimes(1)

    grantAccessResponse = { grants: [] }
    const unlockedPassiveResponse = await websiteLoginMatchAvailability({
      origin: 'https://example.test',
      sender: {
        id: 'nook-extension',
        url: 'https://example.test/login',
        tab: { id: 42 },
      },
      dependencies,
    })
    expect(unlockedPassiveResponse).toEqual({ kind: 'ready', count: 0 })
    expect(availabilityRequests).toHaveLength(1)
    expect(availabilityRequests[0]?.queue).toMatchObject({
      kind: 'deadline',
      priority: 'probe',
    })
    expect(availabilityRequests[0]?.queue.expiresAt).toBeGreaterThan(Date.now())

    loginAccountAvailability = { ok: false }
    const failedPassiveResponse = await websiteLoginMatchAvailability({
      origin: 'https://example.test',
      sender: {
        id: 'nook-extension',
        url: 'https://example.test/login',
        tab: { id: 42 },
      },
      dependencies,
    })
    expect(failedPassiveResponse).toEqual({ kind: 'unavailable' })

    const failedSessionList = mock(() =>
      Promise.resolve({ ok: false, reason: 'session-list-failed' }),
    )
    const failedListRequest: Parameters<
      typeof loginAccountAvailabilityForOrigin
    >[0] = {
      grants: [
        {
          vaultStoreId: 'vault-1',
          vaultName: 'Personal',
          deviceId: 'device-1',
          devicePublicKey: 'device-public-key',
          deviceSigningPublicKey: 'device-signing-key',
        } as StoredExtensionPairingGrant,
      ],
      origin: 'https://example.test',
      queue: extensionSessionProbeDeadline(Date.now() + 1_000),
      sendMessage: failedSessionList,
    }
    await expect(
      loginAccountAvailabilityForOrigin(failedListRequest),
    ).resolves.toEqual({ ok: false })

    const interactiveResponse = await websiteLoginOptions({
      message: { payload: { origin: 'https://example.test' } },
      sender: {
        id: 'nook-extension',
        url: 'https://example.test/login',
        tab: { id: 42 },
      },
      dependencies,
    })
    expect(interactiveResponse).toEqual({
      ok: true,
      status: 'ready',
      accounts: [],
    })
    expect(loginAccountsForOrigin).toHaveBeenCalledTimes(1)
    expect(availabilityRequests).toHaveLength(3)

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
      dependencies,
    })

    expect(rejectedResponse).toEqual({
      ok: false,
      reason: 'login-forbidden-origin',
    })
    expect(openCompanionLauncherBestEffort).toHaveBeenCalledTimes(1)
    expect(openExtensionWindow).toHaveBeenCalledTimes(1)
    expect(openedUrls).toEqual([
      'chrome-extension://nook/popup/index.html?intent=pair',
    ])
  })
})
