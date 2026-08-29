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

type ExtensionWindowRequest = {
  url: string
}

describe('websiteLoginOptions', () => {
  test('opens one trusted companion surface when Continue finds no grant', async () => {
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    const { websiteLoginOptions } =
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
    const openedUrls: string[] = []
    const extensionRuntimeUrl = mock(
      (path: string) => `chrome-extension://nook/${path}`,
    )
    const openExtensionWindow = mock(({ url }: ExtensionWindowRequest) => {
      openedUrls.push(url)
    })
    const openCompanionLauncherBestEffort = mock(
      (intent: OpenCompanionLauncherIntent) => {
        if (intent !== OpenCompanionLauncherIntent.Default) return
        const extensionWindowRequest: ExtensionWindowRequest = {
          url: extensionRuntimeUrl('popup/index.html'),
        }
        openExtensionWindow(extensionWindowRequest)
      },
    )
    const loginAccountsForOrigin = mock(() =>
      Promise.reject(new Error('unused login options test dependency')),
    )
    const dependencies = {
      availableWebsiteGrants,
      loginAccountsForOrigin,
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
      OpenCompanionLauncherIntent.Default,
    )
    expect(openExtensionWindow).toHaveBeenCalledTimes(1)
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
      dependencies,
    })

    expect(rejectedResponse).toEqual({
      ok: false,
      reason: 'login-forbidden-origin',
    })
    expect(openCompanionLauncherBestEffort).toHaveBeenCalledTimes(1)
    expect(openExtensionWindow).toHaveBeenCalledTimes(1)
    expect(openedUrls).toEqual(['chrome-extension://nook/popup/index.html'])
  })
})
