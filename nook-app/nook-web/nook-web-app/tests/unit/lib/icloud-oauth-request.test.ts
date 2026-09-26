import { ok, err } from 'neverthrow'
import { OAuthFailure, OAuthFailureKind } from '$lib/auth/oauth-failure'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ICLOUD_SIGN_IN_TIMEOUT_MS,
  ICloudAccountNameKind,
  type ICloudOAuthTokens,
  type ICloudWebAuthTokenRequest,
  iCloudOAuthSession,
} from '$lib/auth/icloud/oauth'
import type { CloudKitUserIdentity } from '$lib/auth/icloud/cloudkit-runtime'
import { ICloudOAuthTestFixture } from './icloud-oauth-test-fixture'
import { ICLOUD_CONTAINER_ID } from '$lib/auth/icloud/config'

function defaultICloudWebAuthTokenRequest(): ICloudWebAuthTokenRequest {
  return {
    signInTimeoutMs: ICLOUD_SIGN_IN_TIMEOUT_MS,
    clickSignInControl: true,
  }
}

function timedICloudWebAuthTokenRequest(
  signInTimeoutMs: number,
): ICloudWebAuthTokenRequest {
  return { signInTimeoutMs, clickSignInControl: true }
}

function nativeICloudWebAuthTokenRequest(): ICloudWebAuthTokenRequest {
  return {
    signInTimeoutMs: ICLOUD_SIGN_IN_TIMEOUT_MS,
    clickSignInControl: false,
  }
}

function iCloudTokensWithoutAccountName(
  accessToken: string,
): ICloudOAuthTokens {
  return {
    accessToken,
    accountName: { kind: ICloudAccountNameKind.Unavailable },
  }
}

function iCloudTokensWithAccountName(
  accessToken: string,
  accountName: string,
): ICloudOAuthTokens {
  return {
    accessToken,
    accountName: {
      kind: ICloudAccountNameKind.Available,
      value: accountName,
    },
  }
}

function mockPendingCloudKitSignIn(
  setUpAuth = ICloudOAuthTestFixture.resolvedSignedOutIdentity(),
) {
  let resolveSignIn: (value: CloudKitUserIdentity) => void = () => {}
  const signInPromise = new Promise<CloudKitUserIdentity>((resolve) => {
    resolveSignIn = resolve
  })
  const whenUserSignsIn = vi.fn().mockReturnValue(signInPromise)
  ICloudOAuthTestFixture.useContainer({
    setUpAuth,
    whenUserSignsIn,
  })
  return { resolveSignIn, setUpAuth, whenUserSignsIn }
}

describe('icloud-oauth', () => {
  describe('requestICloudWebAuthToken', () => {
    beforeEach(() => {
      iCloudOAuthSession.resetICloudAuthStateForTests()
      document.body.innerHTML =
        '<div id="apple-sign-in-button"><button type="button">Sign in</button></div><div id="apple-sign-out-button"></div>'
      sessionStorage.clear()
      vi.stubGlobal('CloudKit', {
        configure: vi.fn(),
        getDefaultContainer: vi.fn(),
      })
    })

    afterEach(() => {
      vi.unstubAllGlobals()
      Reflect.deleteProperty(navigator, 'brave')
      document.body.innerHTML = ''
      sessionStorage.clear()
    })

    it('returns a stored token when setUpAuth resolves a signed-in user', async () => {
      sessionStorage.setItem(
        `nook.icloud.webAuthToken.${ICLOUD_CONTAINER_ID}`,
        JSON.stringify('existing-token'),
      )
      const whenUserSignsIn = vi.fn()
      const setUpAuth = vi.fn().mockResolvedValue({ lookupInfo: {} })
      ICloudOAuthTestFixture.useContainer({
        setUpAuth,
        whenUserSignsIn,
      })

      const request = defaultICloudWebAuthTokenRequest()
      await expect(
        iCloudOAuthSession.requestICloudWebAuthToken(request),
      ).resolves.toEqual(ok(iCloudTokensWithoutAccountName('existing-token')))
      expect(setUpAuth).toHaveBeenCalledWith({
        grabAuthToken: true,
        persist: true,
      })
      expect(whenUserSignsIn).not.toHaveBeenCalled()
    })

    it('waits for CloudKit sign-in when setUpAuth only completes its effect', async () => {
      let resolveSignIn: (value: CloudKitUserIdentity) => void = () => {}
      const signInPromise = new Promise<CloudKitUserIdentity>((resolve) => {
        resolveSignIn = resolve
      })
      const setUpAuth = ICloudOAuthTestFixture.resolvedSignedOutIdentity()
      const whenUserSignsIn = vi.fn().mockReturnValue(signInPromise)
      ICloudOAuthTestFixture.useContainer({
        setUpAuth,
        whenUserSignsIn,
      })

      const request = defaultICloudWebAuthTokenRequest()
      const pending = iCloudOAuthSession.requestICloudWebAuthToken(request)
      await vi.waitFor(() => {
        expect(ICloudOAuthTestFixture.cloudKit().configure).toHaveBeenCalled()
        expect(whenUserSignsIn).toHaveBeenCalled()
      })

      const config = ICloudOAuthTestFixture.firstConfigureRequest()
      config.services?.authTokenStore?.putToken(
        ICLOUD_CONTAINER_ID,
        'fresh-token',
      )
      resolveSignIn({
        nameComponents: { givenName: 'Fresh', familyName: 'User' },
      })

      await expect(pending).resolves.toEqual(
        ok(iCloudTokensWithAccountName('fresh-token', 'Fresh User')),
      )
    })

    it('resolves from the CloudKit token store when the sign-in callback hangs', async () => {
      const setUpAuth = ICloudOAuthTestFixture.resolvedSignedOutIdentity()
      const whenUserSignsIn = vi.fn().mockReturnValue(new Promise(() => {}))
      ICloudOAuthTestFixture.useContainer({
        setUpAuth,
        whenUserSignsIn,
      })

      const request = timedICloudWebAuthTokenRequest(100)
      const pending = iCloudOAuthSession.requestICloudWebAuthToken(request)
      await vi.waitFor(() => {
        expect(ICloudOAuthTestFixture.cloudKit().configure).toHaveBeenCalled()
        expect(whenUserSignsIn).toHaveBeenCalled()
      })

      const config = ICloudOAuthTestFixture.firstConfigureRequest()
      config.services?.authTokenStore?.putToken(
        ICLOUD_CONTAINER_ID,
        'store-token',
      )

      await expect(pending).resolves.toEqual(
        ok(iCloudTokensWithoutAccountName('store-token')),
      )
    })

    it('clicks the prepared CloudKit sign-in control without re-running setup', async () => {
      const { resolveSignIn, setUpAuth, whenUserSignsIn } =
        mockPendingCloudKitSignIn()
      const signInButton = document.querySelector<HTMLButtonElement>(
        '#apple-sign-in-button button',
      )
      const clickSpy = vi.fn()
      signInButton?.addEventListener('click', clickSpy)

      await iCloudOAuthSession.prepareICloudSignInControl()
      const request = defaultICloudWebAuthTokenRequest()
      const pending =
        iCloudOAuthSession.requestPreparedICloudWebAuthToken(request)

      expect(clickSpy).toHaveBeenCalledOnce()
      expect(setUpAuth).toHaveBeenCalledTimes(1)
      expect(whenUserSignsIn).toHaveBeenCalledOnce()

      const config = ICloudOAuthTestFixture.firstConfigureRequest()
      config.services?.authTokenStore?.putToken(
        ICLOUD_CONTAINER_ID,
        'fresh-token',
      )
      resolveSignIn({ lookupInfo: {} })

      await expect(pending).resolves.toEqual(
        ok(iCloudTokensWithoutAccountName('fresh-token')),
      )
    })

    it('clicks the CloudKit-generated Apple auth div', async () => {
      document.body.innerHTML =
        '<div id="apple-sign-in-button"><div class="apple-auth-button">Sign in</div></div><div id="apple-sign-out-button"></div>'
      const { resolveSignIn } = mockPendingCloudKitSignIn()
      const signInControl = document.querySelector<HTMLElement>(
        '#apple-sign-in-button .apple-auth-button',
      )
      const clickSpy = vi.fn()
      signInControl?.addEventListener('click', clickSpy)

      await iCloudOAuthSession.prepareICloudSignInControl()
      const request = defaultICloudWebAuthTokenRequest()
      const pending =
        iCloudOAuthSession.requestPreparedICloudWebAuthToken(request)

      expect(clickSpy).toHaveBeenCalledOnce()

      const config = ICloudOAuthTestFixture.firstConfigureRequest()
      config.services?.authTokenStore?.putToken(
        ICLOUD_CONTAINER_ID,
        'cloudkit-div-token',
      )
      resolveSignIn({ lookupInfo: {} })

      await expect(pending).resolves.toEqual(
        ok(iCloudTokensWithoutAccountName('cloudkit-div-token')),
      )
    })

    it('can wait for the visible CloudKit control without clicking it', async () => {
      let resolveSignIn: (value: CloudKitUserIdentity) => void = () => {}
      const signInPromise = new Promise<CloudKitUserIdentity>((resolve) => {
        resolveSignIn = resolve
      })
      const signInButton = document.querySelector<HTMLButtonElement>(
        '#apple-sign-in-button button',
      )
      const clickSpy = vi.fn()
      signInButton?.addEventListener('click', clickSpy)
      const setUpAuth = ICloudOAuthTestFixture.resolvedSignedOutIdentity()
      const whenUserSignsIn = vi.fn().mockReturnValue(signInPromise)
      ICloudOAuthTestFixture.useContainer({
        setUpAuth,
        whenUserSignsIn,
      })

      await iCloudOAuthSession.prepareICloudSignInControl()
      const request = nativeICloudWebAuthTokenRequest()
      const pending =
        iCloudOAuthSession.requestPreparedICloudWebAuthToken(request)

      expect(clickSpy).not.toHaveBeenCalled()
      expect(whenUserSignsIn).toHaveBeenCalledOnce()

      const config = ICloudOAuthTestFixture.firstConfigureRequest()
      config.services?.authTokenStore?.putToken(
        ICLOUD_CONTAINER_ID,
        'visible-control-token',
      )
      resolveSignIn({ lookupInfo: {} })

      await expect(pending).resolves.toEqual(
        ok(iCloudTokensWithoutAccountName('visible-control-token')),
      )
    })

    it('waits before the native CloudKit click stores a token', async () => {
      let resolveSignIn: (value: CloudKitUserIdentity) => void = () => {}
      const signInPromise = new Promise<CloudKitUserIdentity>((resolve) => {
        resolveSignIn = resolve
      })
      const signInButton = document.querySelector<HTMLButtonElement>(
        '#apple-sign-in-button button',
      )
      const setUpAuth = ICloudOAuthTestFixture.resolvedSignedOutIdentity()
      const whenUserSignsIn = vi.fn().mockReturnValue(signInPromise)
      ICloudOAuthTestFixture.useContainer({
        setUpAuth,
        whenUserSignsIn,
      })

      await iCloudOAuthSession.prepareICloudSignInControl()
      const config = ICloudOAuthTestFixture.firstConfigureRequest()
      signInButton?.addEventListener('click', () => {
        config.services?.authTokenStore?.putToken(
          ICLOUD_CONTAINER_ID,
          'native-click-token',
        )
        resolveSignIn({ lookupInfo: {} })
      })
      const request = nativeICloudWebAuthTokenRequest()
      const pending =
        iCloudOAuthSession.requestPreparedICloudWebAuthToken(request)
      await vi.waitFor(() => {
        expect(whenUserSignsIn).toHaveBeenCalledOnce()
      })
      signInButton?.click()

      await expect(pending).resolves.toEqual(
        ok(iCloudTokensWithoutAccountName('native-click-token')),
      )
      expect(setUpAuth).toHaveBeenCalledTimes(1)
    })

    it('keeps waiting for the token when CloudKit wraps the auth challenge as UNKNOWN_ERROR', async () => {
      const setUpAuth = ICloudOAuthTestFixture.resolvedSignedOutIdentity()
      const whenUserSignsIn = vi.fn().mockRejectedValue({
        _reason: 'UNKNOWN_ERROR',
      })
      ICloudOAuthTestFixture.useContainer({
        setUpAuth,
        whenUserSignsIn,
      })

      await iCloudOAuthSession.prepareICloudSignInControl()
      const request = nativeICloudWebAuthTokenRequest()
      const pending =
        iCloudOAuthSession.requestPreparedICloudWebAuthToken(request)
      await vi.waitFor(() => {
        expect(whenUserSignsIn).toHaveBeenCalledOnce()
      })

      const config = ICloudOAuthTestFixture.firstConfigureRequest()
      config.services?.authTokenStore?.putToken(
        ICLOUD_CONTAINER_ID,
        'opaque-callback-token',
      )

      await expect(pending).resolves.toEqual(
        ok(iCloudTokensWithoutAccountName('opaque-callback-token')),
      )
    })

    it('returns a CloudKit authentication failure for an unexpected native sign-in rejection', async () => {
      const setUpAuth = ICloudOAuthTestFixture.resolvedSignedOutIdentity()
      const whenUserSignsIn = vi.fn().mockRejectedValue({
        serverErrorCode: 'INTERNAL_ERROR',
        reason: 'unexpected CloudKit sign-in failure',
      })
      ICloudOAuthTestFixture.useContainer({
        setUpAuth,
        whenUserSignsIn,
      })

      await iCloudOAuthSession.prepareICloudSignInControl()
      const request = nativeICloudWebAuthTokenRequest()
      await expect(
        iCloudOAuthSession.requestPreparedICloudWebAuthToken(request),
      ).resolves.toEqual(
        err(new OAuthFailure(OAuthFailureKind.CloudKitAuthentication)),
      )
      expect(whenUserSignsIn).toHaveBeenCalledOnce()
    })

    it('falls back to CloudKit web auth redirect when CloudKit JS hides the auth challenge', async () => {
      const setUpAuth = ICloudOAuthTestFixture.resolvedSignedOutIdentity()
      const whenUserSignsIn = vi.fn().mockRejectedValue({
        _reason: 'UNKNOWN_ERROR',
      })
      ICloudOAuthTestFixture.useContainer({
        setUpAuth,
        whenUserSignsIn,
      })
      const close = vi.fn()
      const open = vi.fn().mockReturnValue({ close })
      vi.stubGlobal('open', open)
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              uuid: 'challenge-id',
              serverErrorCode: 'AUTHENTICATION_REQUIRED',
              reason: 'request needs authorization',
              redirectURL:
                'https://idmsa.apple.com/IDMSWebAuth/auth?oauth_token=test',
            }),
            { status: 421, headers: { 'content-type': 'application/json' } },
          ),
        ),
      )

      await iCloudOAuthSession.prepareICloudSignInControl()
      // Programmatic click path may open the direct Web Services window.
      const request = timedICloudWebAuthTokenRequest(5000)
      const pending =
        iCloudOAuthSession.requestPreparedICloudWebAuthToken(request)

      await vi.waitFor(() => {
        expect(open).toHaveBeenCalledWith(
          'https://idmsa.apple.com/IDMSWebAuth/auth?oauth_token=test',
          'nook-icloud-auth',
          'popup,width=520,height=720',
        )
      })
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://idmsa.apple.com',
          data: { ckWebAuthToken: 'direct-web-auth-token' },
        }),
      )

      await expect(pending).resolves.toEqual(
        ok(iCloudTokensWithoutAccountName('direct-web-auth-token')),
      )
      expect(close).toHaveBeenCalledOnce()
    })

    it('does not open a second Apple window after a native CloudKit button click', async () => {
      Object.defineProperty(navigator, 'brave', {
        configurable: true,
        value: {},
      })
      const setUpAuth = ICloudOAuthTestFixture.resolvedSignedOutIdentity()
      const whenUserSignsIn = vi.fn().mockRejectedValue({
        serverErrorCode: 'AUTHENTICATION_REQUIRED',
        reason: 'request needs authorization',
      })
      ICloudOAuthTestFixture.useContainer({
        setUpAuth,
        whenUserSignsIn,
      })
      const open = vi.fn()
      vi.stubGlobal('open', open)
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('direct auth must not run')),
      )

      await iCloudOAuthSession.prepareICloudSignInControl()
      const request: ICloudWebAuthTokenRequest = {
        clickSignInControl: false,
        signInTimeoutMs: 5000,
      }
      const pending =
        iCloudOAuthSession.requestPreparedICloudWebAuthToken(request)

      await vi.waitFor(() => {
        expect(whenUserSignsIn).toHaveBeenCalledOnce()
      })
      expect(open).not.toHaveBeenCalled()

      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://idmsa.apple.com',
          data: { ckWebAuthToken: 'native-window-token' },
        }),
      )

      await expect(pending).resolves.toEqual(
        ok(iCloudTokensWithoutAccountName('native-window-token')),
      )
      expect(open).not.toHaveBeenCalled()
    })

    it('uses direct web auth as the primary Brave flow to avoid duplicate Apple windows', async () => {
      Object.defineProperty(navigator, 'brave', {
        configurable: true,
        value: {},
      })
      const setUpAuth = ICloudOAuthTestFixture.resolvedSignedOutIdentity()
      const whenUserSignsIn = vi.fn()
      ICloudOAuthTestFixture.useContainer({
        setUpAuth,
        whenUserSignsIn,
      })
      const nativeClick = vi.fn()
      document
        .querySelector('#apple-sign-in-button button')
        ?.addEventListener('click', nativeClick)
      const close = vi.fn()
      const open = vi.fn().mockReturnValue({ close })
      vi.stubGlobal('open', open)
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              uuid: 'challenge-id',
              serverErrorCode: 'AUTHENTICATION_REQUIRED',
              reason: 'request needs authorization',
              redirectURL:
                'https://idmsa.apple.com/IDMSWebAuth/auth?oauth_token=brave',
            }),
            { status: 421, headers: { 'content-type': 'application/json' } },
          ),
        ),
      )

      await iCloudOAuthSession.prepareICloudSignInControl()
      const request = timedICloudWebAuthTokenRequest(5000)
      const pending =
        iCloudOAuthSession.requestPreparedICloudWebAuthToken(request)

      await vi.waitFor(() => {
        expect(open).toHaveBeenCalledWith(
          'https://idmsa.apple.com/IDMSWebAuth/auth?oauth_token=brave',
          'nook-icloud-auth',
          'popup,width=520,height=720',
        )
      })
      expect(nativeClick).not.toHaveBeenCalled()
      expect(whenUserSignsIn).not.toHaveBeenCalled()
      expect(open).toHaveBeenCalledOnce()
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://idmsa.apple.com',
          data: { ckWebAuthToken: 'brave-direct-token' },
        }),
      )

      await expect(pending).resolves.toEqual(
        ok(iCloudTokensWithoutAccountName('brave-direct-token')),
      )
      expect(close).toHaveBeenCalledOnce()
    })

    it('surfaces an invalid CloudKit API token from the direct auth challenge', async () => {
      const setUpAuth = ICloudOAuthTestFixture.resolvedSignedOutIdentity()
      const whenUserSignsIn = vi.fn().mockRejectedValue({
        _reason: 'UNKNOWN_ERROR',
      })
      ICloudOAuthTestFixture.useContainer({
        setUpAuth,
        whenUserSignsIn,
      })
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              uuid: 'invalid-token-id',
              serverErrorCode: 'AUTHENTICATION_FAILED',
              reason:
                'Authentication failed, please check you have the correct API Token for this container',
            }),
            { status: 401, headers: { 'content-type': 'application/json' } },
          ),
        ),
      )

      await iCloudOAuthSession.prepareICloudSignInControl()

      const request = timedICloudWebAuthTokenRequest(5000)
      await expect(
        iCloudOAuthSession.requestPreparedICloudWebAuthToken(request),
      ).resolves.toEqual(
        err(new OAuthFailure(OAuthFailureKind.InvalidChallenge)),
      )
    })

    it('fails when CloudKit sign-in never completes', async () => {
      const setUpAuth = ICloudOAuthTestFixture.resolvedSignedOutIdentity()
      const whenUserSignsIn = vi.fn().mockReturnValue(new Promise(() => {}))
      ICloudOAuthTestFixture.useContainer({
        setUpAuth,
        whenUserSignsIn,
      })

      const request = timedICloudWebAuthTokenRequest(1)
      await expect(
        iCloudOAuthSession.requestICloudWebAuthToken(request),
      ).resolves.toEqual(err(new OAuthFailure(OAuthFailureKind.TimedOut)))
      expect(whenUserSignsIn).toHaveBeenCalled()
    })

    it('treats bare CloudKit 421 setup responses as sign-in required', async () => {
      document.body.innerHTML = '<div id="apple-sign-out-button"></div>'
      const setUpAuth = vi.fn().mockRejectedValue({
        status: 421,
        statusText: 'Misdirected Request',
      })
      const whenUserSignsIn = vi.fn()
      ICloudOAuthTestFixture.useContainer({
        setUpAuth,
        whenUserSignsIn,
      })

      await expect(
        iCloudOAuthSession.prepareICloudSignInControl(),
      ).resolves.toEqual(
        err(new OAuthFailure(OAuthFailureKind.CloudKitAuthentication)),
      )
      expect(whenUserSignsIn).not.toHaveBeenCalled()
    })

    it('treats CloudKit auth-required setup as a prepared sign-in control', async () => {
      const setUpAuth = vi.fn().mockRejectedValue({
        reason: 'request needs authorization',
        serverErrorCode: 'AUTHENTICATION_REQUIRED',
        status: 421,
      })
      const { resolveSignIn, whenUserSignsIn } =
        mockPendingCloudKitSignIn(setUpAuth)

      await iCloudOAuthSession.prepareICloudSignInControl()
      const request = nativeICloudWebAuthTokenRequest()
      const pending =
        iCloudOAuthSession.requestPreparedICloudWebAuthToken(request)
      const config = ICloudOAuthTestFixture.firstConfigureRequest()
      config.services?.authTokenStore?.putToken(
        ICLOUD_CONTAINER_ID,
        'auth-required-token',
      )
      resolveSignIn({ lookupInfo: {} })

      await expect(pending).resolves.toEqual(
        ok(iCloudTokensWithoutAccountName('auth-required-token')),
      )
      expect(whenUserSignsIn).toHaveBeenCalledOnce()
    })

    it('treats opaque CloudKit UNKNOWN_ERROR setup as prepared when the sign-in control exists', async () => {
      const setUpAuth = vi.fn().mockRejectedValue({
        _reason: 'UNKNOWN_ERROR',
      })
      const { resolveSignIn, whenUserSignsIn } =
        mockPendingCloudKitSignIn(setUpAuth)

      await iCloudOAuthSession.prepareICloudSignInControl()
      const request = nativeICloudWebAuthTokenRequest()
      const pending =
        iCloudOAuthSession.requestPreparedICloudWebAuthToken(request)
      const config = ICloudOAuthTestFixture.firstConfigureRequest()
      config.services?.authTokenStore?.putToken(
        ICLOUD_CONTAINER_ID,
        'opaque-setup-token',
      )
      resolveSignIn({ lookupInfo: {} })

      await expect(pending).resolves.toEqual(
        ok(iCloudTokensWithoutAccountName('opaque-setup-token')),
      )
      expect(whenUserSignsIn).toHaveBeenCalledOnce()
    })

    it('expands opaque CloudKit UNKNOWN_ERROR auth failures without a sign-in control', async () => {
      document.body.innerHTML = '<div id="apple-sign-out-button"></div>'
      const setUpAuth = vi.fn().mockRejectedValue({
        _reason: 'UNKNOWN_ERROR',
      })
      const whenUserSignsIn = vi.fn()
      ICloudOAuthTestFixture.useContainer({
        setUpAuth,
        whenUserSignsIn,
      })

      await expect(
        iCloudOAuthSession.prepareICloudSignInControl(),
      ).resolves.toEqual(
        err(new OAuthFailure(OAuthFailureKind.CloudKitAuthentication)),
      )
      expect(whenUserSignsIn).not.toHaveBeenCalled()
    })

    it('detects tokens stored directly in session storage via polling fallback', async () => {
      const setUpAuth = ICloudOAuthTestFixture.resolvedSignedOutIdentity()
      const whenUserSignsIn = vi.fn().mockReturnValue(new Promise(() => {}))
      ICloudOAuthTestFixture.useContainer({
        setUpAuth,
        whenUserSignsIn,
      })

      const request = timedICloudWebAuthTokenRequest(5000)
      const pending = iCloudOAuthSession.requestICloudWebAuthToken(request)
      await vi.waitFor(() => {
        expect(whenUserSignsIn).toHaveBeenCalled()
      })

      // Simulate CloudKit JS writing the token directly to session storage
      // (bypassing the custom authTokenStore putToken callback).
      sessionStorage.setItem(
        `nook.icloud.webAuthToken.${ICLOUD_CONTAINER_ID}`,
        JSON.stringify('cookie-fallback-token'),
      )

      await expect(pending).resolves.toEqual(
        ok(iCloudTokensWithoutAccountName('cookie-fallback-token')),
      )
    })

    it('normalizes tokens with webAuthToken key', async () => {
      const setUpAuth = ICloudOAuthTestFixture.resolvedSignedOutIdentity()
      const whenUserSignsIn = vi.fn().mockReturnValue(new Promise(() => {}))
      ICloudOAuthTestFixture.useContainer({
        setUpAuth,
        whenUserSignsIn,
      })

      const request = timedICloudWebAuthTokenRequest(500)
      const pending = iCloudOAuthSession.requestICloudWebAuthToken(request)
      await vi.waitFor(() => {
        expect(ICloudOAuthTestFixture.cloudKit().configure).toHaveBeenCalled()
        expect(whenUserSignsIn).toHaveBeenCalled()
      })

      const config = ICloudOAuthTestFixture.firstConfigureRequest()
      config.services?.authTokenStore?.putToken(
        ICLOUD_CONTAINER_ID,
        'alt-format-token',
      )

      await expect(pending).resolves.toEqual(
        ok(iCloudTokensWithoutAccountName('alt-format-token')),
      )
    })

    it('allows retry after a sign-in timeout by resetting auth state', async () => {
      const setUpAuth = ICloudOAuthTestFixture.resolvedSignedOutIdentity()
      const whenUserSignsIn = vi.fn().mockReturnValue(new Promise(() => {}))
      ICloudOAuthTestFixture.useContainer({
        setUpAuth,
        whenUserSignsIn,
      })

      // First attempt times out.
      const firstRequest = timedICloudWebAuthTokenRequest(1)
      await expect(
        iCloudOAuthSession.requestICloudWebAuthToken(firstRequest),
      ).resolves.toEqual(err(new OAuthFailure(OAuthFailureKind.TimedOut)))

      // Second attempt should re-run setUpAuth (not reuse stale promise).
      let resolveSignIn: (value: CloudKitUserIdentity) => void = () => {}
      const signInPromise = new Promise<CloudKitUserIdentity>((resolve) => {
        resolveSignIn = resolve
      })
      ICloudOAuthTestFixture.useContainer({
        setUpAuth: ICloudOAuthTestFixture.resolvedSignedOutIdentity(),
        whenUserSignsIn: vi.fn().mockReturnValue(signInPromise),
      })

      const retryRequest = timedICloudWebAuthTokenRequest(5000)
      const pending = iCloudOAuthSession.requestICloudWebAuthToken(retryRequest)

      const config = ICloudOAuthTestFixture.firstConfigureRequest()
      config.services?.authTokenStore?.putToken(
        ICLOUD_CONTAINER_ID,
        'retry-token',
      )
      resolveSignIn({ lookupInfo: {} })

      await expect(pending).resolves.toEqual(
        ok(iCloudTokensWithoutAccountName('retry-token')),
      )
    })
  })
})
