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
  })
})
