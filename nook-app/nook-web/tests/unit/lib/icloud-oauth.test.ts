import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isICloudOAuthConfigured,
  oauthTokensToICloudConfig,
  prepareICloudSignInControl,
  requestPreparedICloudWebAuthToken,
  requestICloudWebAuthToken,
  resetICloudAuthStateForTests,
} from '$lib/icloud-oauth'
import {
  ICLOUD_CONTAINER_ID,
  ICLOUD_ENVIRONMENT,
} from '$lib/icloud-oauth-config'

describe('icloud-oauth', () => {
  it('is configured for production CloudKit on nokey.sh', () => {
    expect(isICloudOAuthConfigured()).toBe(true)
    expect(ICLOUD_CONTAINER_ID).toBe('iCloud.metasecret.project.com')
    expect(ICLOUD_ENVIRONMENT).toBe('production')
  })

  it('maps tokens to oauth-file icloud config', () => {
    expect(
      oauthTokensToICloudConfig({
        accessToken: 'ck-web-auth-token',
        accountName: 'Apple User',
      }),
    ).toEqual({
      preset: 'icloud',
      accessToken: 'ck-web-auth-token',
      fileId: undefined,
      fileName: undefined,
      accountEmail: 'Apple User',
      refreshToken: undefined,
      expiresAt: undefined,
    })
  })

  describe('requestICloudWebAuthToken', () => {
    beforeEach(() => {
      resetICloudAuthStateForTests()
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
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth,
        whenUserSignsIn,
      })

      await expect(requestICloudWebAuthToken()).resolves.toEqual({
        accessToken: 'existing-token',
      })
      expect(setUpAuth).toHaveBeenCalledWith({
        grabAuthToken: true,
        persist: true,
      })
      expect(whenUserSignsIn).not.toHaveBeenCalled()
    })

    it('waits for CloudKit sign-in when setUpAuth returns undefined', async () => {
      let resolveSignIn: (value: unknown) => void = () => {}
      const signInPromise = new Promise((resolve) => {
        resolveSignIn = resolve
      })
      const setUpAuth = vi.fn().mockResolvedValue(undefined)
      const whenUserSignsIn = vi.fn().mockReturnValue(signInPromise)
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth,
        whenUserSignsIn,
      })

      const pending = requestICloudWebAuthToken()
      await vi.waitFor(() => {
        expect(window.CloudKit!.configure).toHaveBeenCalled()
        expect(whenUserSignsIn).toHaveBeenCalled()
      })

      const config = vi.mocked(window.CloudKit!.configure).mock.calls[0]![0]
      config.services?.authTokenStore?.putToken(ICLOUD_CONTAINER_ID, {
        ckWebAuthToken: 'fresh-token',
      })
      resolveSignIn({
        nameComponents: { givenName: 'Fresh', familyName: 'User' },
      })

      await expect(pending).resolves.toEqual({
        accessToken: 'fresh-token',
        accountName: 'Fresh User',
      })
    })

    it('resolves from the CloudKit token store when the sign-in callback hangs', async () => {
      const setUpAuth = vi.fn().mockResolvedValue(undefined)
      const whenUserSignsIn = vi.fn().mockReturnValue(new Promise(() => {}))
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth,
        whenUserSignsIn,
      })

      const pending = requestICloudWebAuthToken({ signInTimeoutMs: 100 })
      await vi.waitFor(() => {
        expect(window.CloudKit!.configure).toHaveBeenCalled()
        expect(whenUserSignsIn).toHaveBeenCalled()
      })

      const config = vi.mocked(window.CloudKit!.configure).mock.calls[0]![0]
      config.services?.authTokenStore?.putToken(ICLOUD_CONTAINER_ID, {
        ckWebAuthToken: 'store-token',
      })

      await expect(pending).resolves.toEqual({
        accessToken: 'store-token',
      })
    })

    it('clicks the prepared CloudKit sign-in control without re-running setup', async () => {
      let resolveSignIn: (value: unknown) => void = () => {}
      const signInPromise = new Promise((resolve) => {
        resolveSignIn = resolve
      })
      const signInButton = document.querySelector<HTMLButtonElement>(
        '#apple-sign-in-button button',
      )
      const clickSpy = vi.fn()
      signInButton?.addEventListener('click', clickSpy)
      const setUpAuth = vi.fn().mockResolvedValue(undefined)
      const whenUserSignsIn = vi.fn().mockReturnValue(signInPromise)
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth,
        whenUserSignsIn,
      })

      await prepareICloudSignInControl()
      const pending = requestPreparedICloudWebAuthToken()

      expect(clickSpy).toHaveBeenCalledOnce()
      expect(setUpAuth).toHaveBeenCalledTimes(1)
      expect(whenUserSignsIn).toHaveBeenCalledOnce()

      const config = vi.mocked(window.CloudKit!.configure).mock.calls[0]![0]
      config.services?.authTokenStore?.putToken(ICLOUD_CONTAINER_ID, {
        ckWebAuthToken: 'fresh-token',
      })
      resolveSignIn({ lookupInfo: {} })

      await expect(pending).resolves.toEqual({
        accessToken: 'fresh-token',
      })
    })

    it('clicks the CloudKit-generated Apple auth div', async () => {
      document.body.innerHTML =
        '<div id="apple-sign-in-button"><div class="apple-auth-button">Sign in</div></div><div id="apple-sign-out-button"></div>'
      let resolveSignIn: (value: unknown) => void = () => {}
      const signInPromise = new Promise((resolve) => {
        resolveSignIn = resolve
      })
      const signInControl = document.querySelector<HTMLElement>(
        '#apple-sign-in-button .apple-auth-button',
      )
      const clickSpy = vi.fn()
      signInControl?.addEventListener('click', clickSpy)
      const setUpAuth = vi.fn().mockResolvedValue(undefined)
      const whenUserSignsIn = vi.fn().mockReturnValue(signInPromise)
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth,
        whenUserSignsIn,
      })

      await prepareICloudSignInControl()
      const pending = requestPreparedICloudWebAuthToken()

      expect(clickSpy).toHaveBeenCalledOnce()

      const config = vi.mocked(window.CloudKit!.configure).mock.calls[0]![0]
      config.services?.authTokenStore?.putToken(ICLOUD_CONTAINER_ID, {
        ckWebAuthToken: 'cloudkit-div-token',
      })
      resolveSignIn({ lookupInfo: {} })

      await expect(pending).resolves.toEqual({
        accessToken: 'cloudkit-div-token',
      })
    })

    it('can wait for the visible CloudKit control without clicking it', async () => {
      let resolveSignIn: (value: unknown) => void = () => {}
      const signInPromise = new Promise((resolve) => {
        resolveSignIn = resolve
      })
      const signInButton = document.querySelector<HTMLButtonElement>(
        '#apple-sign-in-button button',
      )
      const clickSpy = vi.fn()
      signInButton?.addEventListener('click', clickSpy)
      const setUpAuth = vi.fn().mockResolvedValue(undefined)
      const whenUserSignsIn = vi.fn().mockReturnValue(signInPromise)
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth,
        whenUserSignsIn,
      })

      await prepareICloudSignInControl()
      const pending = requestPreparedICloudWebAuthToken({
        clickSignInControl: false,
      })

      expect(clickSpy).not.toHaveBeenCalled()
      expect(whenUserSignsIn).toHaveBeenCalledOnce()

      const config = vi.mocked(window.CloudKit!.configure).mock.calls[0]![0]
      config.services?.authTokenStore?.putToken(ICLOUD_CONTAINER_ID, {
        ckWebAuthToken: 'visible-control-token',
      })
      resolveSignIn({ lookupInfo: {} })

      await expect(pending).resolves.toEqual({
        accessToken: 'visible-control-token',
      })
    })

    it('waits before the native CloudKit click stores a token', async () => {
      let resolveSignIn: (value: unknown) => void = () => {}
      const signInPromise = new Promise((resolve) => {
        resolveSignIn = resolve
      })
      const signInButton = document.querySelector<HTMLButtonElement>(
        '#apple-sign-in-button button',
      )
      const setUpAuth = vi.fn().mockResolvedValue(undefined)
      const whenUserSignsIn = vi.fn().mockReturnValue(signInPromise)
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth,
        whenUserSignsIn,
      })

      await prepareICloudSignInControl()
      const config = vi.mocked(window.CloudKit!.configure).mock.calls[0]![0]
      signInButton?.addEventListener('click', () => {
        config.services?.authTokenStore?.putToken(ICLOUD_CONTAINER_ID, {
          ckWebAuthToken: 'native-click-token',
        })
        resolveSignIn({ lookupInfo: {} })
      })
      const pending = requestPreparedICloudWebAuthToken({
        clickSignInControl: false,
      })
      await vi.waitFor(() => {
        expect(whenUserSignsIn).toHaveBeenCalledOnce()
      })
      signInButton?.click()

      await expect(pending).resolves.toEqual({
        accessToken: 'native-click-token',
      })
      expect(setUpAuth).toHaveBeenCalledTimes(1)
    })

    it('keeps waiting for the token when CloudKit wraps the auth challenge as UNKNOWN_ERROR', async () => {
      const setUpAuth = vi.fn().mockResolvedValue(undefined)
      const whenUserSignsIn = vi.fn().mockRejectedValue({
        _reason: 'UNKNOWN_ERROR',
      })
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth,
        whenUserSignsIn,
      })

      await prepareICloudSignInControl()
      const pending = requestPreparedICloudWebAuthToken({
        clickSignInControl: false,
      })
      await vi.waitFor(() => {
        expect(whenUserSignsIn).toHaveBeenCalledOnce()
      })

      const config = vi.mocked(window.CloudKit!.configure).mock.calls[0]![0]
      config.services?.authTokenStore?.putToken(ICLOUD_CONTAINER_ID, {
        ckWebAuthToken: 'opaque-callback-token',
      })

      await expect(pending).resolves.toEqual({
        accessToken: 'opaque-callback-token',
      })
    })

    it('falls back to CloudKit web auth redirect when CloudKit JS hides the auth challenge', async () => {
      const setUpAuth = vi.fn().mockResolvedValue(undefined)
      const whenUserSignsIn = vi.fn().mockRejectedValue({
        _reason: 'UNKNOWN_ERROR',
      })
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
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

      await prepareICloudSignInControl()
      const pending = requestPreparedICloudWebAuthToken({
        clickSignInControl: false,
        signInTimeoutMs: 5000,
      })

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

      await expect(pending).resolves.toEqual({
        accessToken: 'direct-web-auth-token',
      })
      expect(close).toHaveBeenCalledOnce()
    })

    it('uses direct web auth as the primary Brave flow to avoid duplicate Apple windows', async () => {
      Object.defineProperty(navigator, 'brave', {
        configurable: true,
        value: {},
      })
      const setUpAuth = vi.fn().mockResolvedValue(undefined)
      const whenUserSignsIn = vi.fn()
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
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

      await prepareICloudSignInControl()
      const pending = requestPreparedICloudWebAuthToken({
        signInTimeoutMs: 5000,
      })

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

      await expect(pending).resolves.toEqual({
        accessToken: 'brave-direct-token',
      })
      expect(close).toHaveBeenCalledOnce()
    })

    it('surfaces an invalid CloudKit API token from the direct auth challenge', async () => {
      const setUpAuth = vi.fn().mockResolvedValue(undefined)
      const whenUserSignsIn = vi.fn().mockRejectedValue({
        _reason: 'UNKNOWN_ERROR',
      })
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
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

      await prepareICloudSignInControl()

      await expect(
        requestPreparedICloudWebAuthToken({
          clickSignInControl: false,
          signInTimeoutMs: 5000,
        }),
      ).rejects.toThrow('Apple rejected the iCloud API token')
    })

    it('fails when CloudKit sign-in never completes', async () => {
      const setUpAuth = vi.fn().mockResolvedValue(undefined)
      const whenUserSignsIn = vi.fn().mockReturnValue(new Promise(() => {}))
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth,
        whenUserSignsIn,
      })

      await expect(
        requestICloudWebAuthToken({ signInTimeoutMs: 1 }),
      ).rejects.toThrow('Apple sign-in did not complete.')
      expect(whenUserSignsIn).toHaveBeenCalled()
    })

    it('treats bare CloudKit 421 setup responses as sign-in required', async () => {
      document.body.innerHTML = '<div id="apple-sign-out-button"></div>'
      const setUpAuth = vi.fn().mockRejectedValue({
        status: 421,
        statusText: 'Misdirected Request',
      })
      const whenUserSignsIn = vi.fn()
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth,
        whenUserSignsIn,
      })

      await expect(prepareICloudSignInControl()).rejects.toThrow(
        'Apple sign-in is required.',
      )
      expect(whenUserSignsIn).not.toHaveBeenCalled()
    })

    it('treats CloudKit auth-required setup as a prepared sign-in control', async () => {
      let resolveSignIn: (value: unknown) => void = () => {}
      const signInPromise = new Promise((resolve) => {
        resolveSignIn = resolve
      })
      const setUpAuth = vi.fn().mockRejectedValue({
        reason: 'request needs authorization',
        serverErrorCode: 'AUTHENTICATION_REQUIRED',
        status: 421,
      })
      const whenUserSignsIn = vi.fn().mockReturnValue(signInPromise)
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth,
        whenUserSignsIn,
      })

      await expect(prepareICloudSignInControl()).resolves.toBeUndefined()
      const pending = requestPreparedICloudWebAuthToken({
        clickSignInControl: false,
      })
      const config = vi.mocked(window.CloudKit!.configure).mock.calls[0]![0]
      config.services?.authTokenStore?.putToken(ICLOUD_CONTAINER_ID, {
        ckWebAuthToken: 'auth-required-token',
      })
      resolveSignIn({ lookupInfo: {} })

      await expect(pending).resolves.toEqual({
        accessToken: 'auth-required-token',
      })
      expect(whenUserSignsIn).toHaveBeenCalledOnce()
    })

    it('treats opaque CloudKit UNKNOWN_ERROR setup as prepared when the sign-in control exists', async () => {
      let resolveSignIn: (value: unknown) => void = () => {}
      const signInPromise = new Promise((resolve) => {
        resolveSignIn = resolve
      })
      const setUpAuth = vi.fn().mockRejectedValue({
        _reason: 'UNKNOWN_ERROR',
      })
      const whenUserSignsIn = vi.fn().mockReturnValue(signInPromise)
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth,
        whenUserSignsIn,
      })

      await expect(prepareICloudSignInControl()).resolves.toBeUndefined()
      const pending = requestPreparedICloudWebAuthToken({
        clickSignInControl: false,
      })
      const config = vi.mocked(window.CloudKit!.configure).mock.calls[0]![0]
      config.services?.authTokenStore?.putToken(ICLOUD_CONTAINER_ID, {
        ckWebAuthToken: 'opaque-setup-token',
      })
      resolveSignIn({ lookupInfo: {} })

      await expect(pending).resolves.toEqual({
        accessToken: 'opaque-setup-token',
      })
      expect(whenUserSignsIn).toHaveBeenCalledOnce()
    })

    it('expands opaque CloudKit UNKNOWN_ERROR auth failures without a sign-in control', async () => {
      document.body.innerHTML = '<div id="apple-sign-out-button"></div>'
      const setUpAuth = vi.fn().mockRejectedValue({
        _reason: 'UNKNOWN_ERROR',
      })
      const whenUserSignsIn = vi.fn()
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth,
        whenUserSignsIn,
      })

      await expect(prepareICloudSignInControl()).rejects.toThrow(
        'Apple CloudKit returned UNKNOWN_ERROR during sign-in.',
      )
      expect(whenUserSignsIn).not.toHaveBeenCalled()
    })

    it('detects tokens stored directly in session storage via polling fallback', async () => {
      const setUpAuth = vi.fn().mockResolvedValue(undefined)
      const whenUserSignsIn = vi.fn().mockReturnValue(new Promise(() => {}))
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth,
        whenUserSignsIn,
      })

      const pending = requestICloudWebAuthToken({ signInTimeoutMs: 5000 })
      await vi.waitFor(() => {
        expect(whenUserSignsIn).toHaveBeenCalled()
      })

      // Simulate CloudKit JS writing the token directly to session storage
      // (bypassing the custom authTokenStore putToken callback).
      sessionStorage.setItem(
        `nook.icloud.webAuthToken.${ICLOUD_CONTAINER_ID}`,
        JSON.stringify('cookie-fallback-token'),
      )

      await expect(pending).resolves.toEqual({
        accessToken: 'cookie-fallback-token',
      })
    })

    it('normalizes tokens with webAuthToken key', async () => {
      const setUpAuth = vi.fn().mockResolvedValue(undefined)
      const whenUserSignsIn = vi.fn().mockReturnValue(new Promise(() => {}))
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth,
        whenUserSignsIn,
      })

      const pending = requestICloudWebAuthToken({ signInTimeoutMs: 500 })
      await vi.waitFor(() => {
        expect(window.CloudKit!.configure).toHaveBeenCalled()
        expect(whenUserSignsIn).toHaveBeenCalled()
      })

      const config = vi.mocked(window.CloudKit!.configure).mock.calls[0]![0]
      config.services?.authTokenStore?.putToken(ICLOUD_CONTAINER_ID, {
        webAuthToken: 'alt-format-token',
      })

      await expect(pending).resolves.toEqual({
        accessToken: 'alt-format-token',
      })
    })

    it('allows retry after a sign-in timeout by resetting auth state', async () => {
      const setUpAuth = vi.fn().mockResolvedValue(undefined)
      const whenUserSignsIn = vi.fn().mockReturnValue(new Promise(() => {}))
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth,
        whenUserSignsIn,
      })

      // First attempt times out.
      await expect(
        requestICloudWebAuthToken({ signInTimeoutMs: 1 }),
      ).rejects.toThrow('Apple sign-in did not complete.')

      // Second attempt should re-run setUpAuth (not reuse stale promise).
      let resolveSignIn: (value: unknown) => void = () => {}
      const signInPromise = new Promise((resolve) => {
        resolveSignIn = resolve
      })
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth: vi.fn().mockResolvedValue(undefined),
        whenUserSignsIn: vi.fn().mockReturnValue(signInPromise),
      })

      const pending = requestICloudWebAuthToken({ signInTimeoutMs: 5000 })

      const config = vi.mocked(window.CloudKit!.configure).mock.calls[0]![0]
      config.services?.authTokenStore?.putToken(ICLOUD_CONTAINER_ID, {
        ckWebAuthToken: 'retry-token',
      })
      resolveSignIn({ lookupInfo: {} })

      await expect(pending).resolves.toEqual({
        accessToken: 'retry-token',
      })
    })
  })
})
