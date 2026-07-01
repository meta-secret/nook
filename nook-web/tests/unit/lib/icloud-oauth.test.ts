import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isICloudOAuthConfigured,
  oauthTokensToICloudConfig,
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
      }),
    ).toEqual({
      preset: 'icloud',
      accessToken: 'ck-web-auth-token',
      fileId: undefined,
      fileName: undefined,
      accountEmail: undefined,
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

    it('waits for CloudKit sign-in when setUpAuth returns null', async () => {
      let resolveSignIn: (value: unknown) => void = () => {}
      const signInPromise = new Promise((resolve) => {
        resolveSignIn = resolve
      })
      const setUpAuth = vi.fn().mockResolvedValue(null)
      const whenUserSignsIn = vi.fn().mockReturnValue(signInPromise)
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth,
        whenUserSignsIn,
      })

      const pending = requestICloudWebAuthToken()
      await vi.waitFor(() => {
        expect(whenUserSignsIn).toHaveBeenCalled()
      })

      sessionStorage.setItem(
        `nook.icloud.webAuthToken.${ICLOUD_CONTAINER_ID}`,
        JSON.stringify('fresh-token'),
      )
      resolveSignIn({ lookupInfo: {} })

      await expect(pending).resolves.toEqual({
        accessToken: 'fresh-token',
      })
    })
  })
})
