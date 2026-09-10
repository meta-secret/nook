import { ok, err } from 'neverthrow'
import { OAuthFailure, OAuthFailureKind } from '$lib/auth/oauth-failure'
import { cloudKitAuthTokenStore } from '$lib/auth/icloud/cloudkit-runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ICLOUD_SIGN_IN_TIMEOUT_MS,
  ICloudAccountNameKind,
  type ICloudOAuthTokens,
  type ICloudWebAuthTokenRequest,
  iCloudOAuthSession,
} from '$lib/auth/icloud/oauth'
import { oauthConfigurationNotApplicable } from '$lib/auth/providers'

import {
  ICLOUD_CONTAINER_ID,
  ICLOUD_ENVIRONMENT,
} from '$lib/auth/icloud/config'

function resolvedCloudKitEffect() {
  return vi.fn(async (): Promise<void> => {})
}

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

function mockPendingCloudKitSignIn(setUpAuth = resolvedCloudKitEffect()) {
  let resolveSignIn: (value: unknown) => void = () => {}
  const signInPromise = new Promise((resolve) => {
    resolveSignIn = resolve
  })
  const whenUserSignsIn = vi.fn().mockReturnValue(signInPromise)
  vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
    setUpAuth,
    whenUserSignsIn,
  })
  return { resolveSignIn, setUpAuth, whenUserSignsIn }
}

describe('icloud-oauth', () => {
  it('is configured for production CloudKit on nokey.sh', () => {
    expect(iCloudOAuthSession.isICloudOAuthConfigured()).toBe(true)
    expect(ICLOUD_CONTAINER_ID).toBe('iCloud.metasecret.project.com')
    expect(ICLOUD_ENVIRONMENT).toBe('production')
  })

  it('maps tokens to oauth-file icloud config', () => {
    const config = iCloudOAuthSession.oauthTokensToICloudConfig({
      tokens: {
        accessToken: 'ck-web-auth-token',
        accountName: {
          kind: ICloudAccountNameKind.Available,
          value: 'Apple User',
        },
      },
      existing: oauthConfigurationNotApplicable(),
    })
    expect(config.isOk()).toBe(true)
    if (config.isErr()) return
    expect(config.value.preset).toBe('icloud')
    expect(config.value.accessToken).toEqual({
      state: 'accessToken',
      value: 'ck-web-auth-token',
    })
    expect(config.value.accountEmail).toEqual({
      state: 'email',
      value: 'Apple User',
    })
    expect(config.value.driveMode).toBe('private')
    expect(config.value.iCloudMode).toBe('private')
  })

  describe('shared CloudKit target', () => {
    beforeEach(() => {
      iCloudOAuthSession.resetICloudAuthStateForTests()
      sessionStorage.clear()
      vi.stubGlobal('CloudKit', {
        configure: vi.fn(),
        getDefaultContainer: vi.fn(),
      })
    })

    afterEach(() => {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
      sessionStorage.clear()
    })

    it('creates a private custom zone and a private account share for the owner', async () => {
      vi.spyOn(crypto, 'randomUUID').mockReturnValue(
        '11111111-1111-4111-8111-111111111111',
      )
      const saveRecordZones = vi.fn().mockResolvedValue({})
      const saveRecords = vi.fn().mockResolvedValue({
        records: [
          {
            recordType: 'NookVault',
            recordName: 'nook-root-11111111-1111-4111-8111-111111111111',
            shortGUID: 'share-guid',
          },
        ],
      })
      const shareWithUI = vi.fn().mockResolvedValue({})
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth: vi.fn().mockResolvedValue({
          userRecordName: 'owner-record',
        }),
        whenUserSignsIn: vi.fn(),
        privateCloudDatabase: {
          saveRecordZones,
          saveRecords,
          shareWithUI,
        },
      })

      const target =
        await iCloudOAuthSession.createICloudSharedVault('nook-events')

      expect(saveRecordZones).toHaveBeenCalledWith([
        {
          zoneName: 'nook-shared-11111111-1111-4111-8111-111111111111',
        },
      ])
      expect(saveRecords).toHaveBeenCalledWith(
        expect.objectContaining({
          recordType: 'NookVault',
          createShortGUID: true,
        }),
        {
          zoneID: 'nook-shared-11111111-1111-4111-8111-111111111111',
        },
      )
      expect(shareWithUI).toHaveBeenCalledWith(
        expect.objectContaining({
          shareTitle: 'nook-events',
          supportedAccess: ['PRIVATE'],
          supportedPermissions: ['READ_WRITE'],
        }),
      )
      expect(target).toMatchObject(
        ok({
          role: 'owner',
          ownerRecordName: 'owner-record',
          rootRecordName: 'nook-root-11111111-1111-4111-8111-111111111111',
          shortGuid: 'share-guid',
        }),
      )
      expect(target.storageTargetId).toContain('icloud-share-v1:')
      expect(target.storageTargetId).not.toContain('ck-web-auth-token')
    })

    it('keeps an absent current identity signed out', async () => {
      const saveRecordZones = vi.fn()
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth: resolvedCloudKitEffect(),
        whenUserSignsIn: vi.fn(),
        fetchCurrentUserIdentity: resolvedCloudKitEffect(),
        privateCloudDatabase: {
          saveRecordZones,
          saveRecords: vi.fn(),
          shareWithUI: vi.fn(),
        },
      })

      await expect(
        iCloudOAuthSession.createICloudSharedVault('nook-events'),
      ).resolves.toEqual(
        err(new OAuthFailure(OAuthFailureKind.SharedSignInRequired)),
      )
      expect(saveRecordZones).not.toHaveBeenCalled()
    })

    it('accepts the share and persists participant shared-database routing', async () => {
      const fetchRecordInfos = vi.fn().mockResolvedValue({
        results: [{ participantStatus: 'INVITED' }],
      })
      const acceptShares = vi.fn().mockResolvedValue({
        results: [
          {
            zoneID: {
              zoneName: 'shared-zone',
              ownerRecordName: 'owner-record',
            },
            rootRecordName: 'shared-root',
          },
        ],
      })
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth: vi.fn(),
        whenUserSignsIn: vi.fn(),
        acceptShares,
        fetchRecordInfos,
      })

      const target = await iCloudOAuthSession.acceptICloudSharedVault(
        'https://www.icloud.com/share/share-guid',
      )

      expect(fetchRecordInfos).toHaveBeenCalledWith(['share-guid'])
      expect(acceptShares).toHaveBeenCalledWith(['share-guid'])
      expect(target).toMatchObject(
        ok({
          role: 'participant',
          zoneName: 'shared-zone',
          ownerRecordName: 'owner-record',
          rootRecordName: 'shared-root',
          shortGuid: 'share-guid',
        }),
      )
      expect(target.storageTargetId).toContain('icloud-share-v1:')
      expect(target.storageTargetId).not.toContain('ck-web-auth-token')
    })

    it('reuses metadata for a share this account already accepted', async () => {
      const acceptShares = vi.fn()
      const fetchRecordInfos = vi.fn().mockResolvedValue({
        results: [
          {
            participantStatus: 'ACCEPTED',
            zoneID: {
              zoneName: 'shared-zone',
              ownerRecordName: 'owner-record',
            },
            rootRecordName: 'shared-root',
          },
        ],
      })
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth: vi.fn(),
        whenUserSignsIn: vi.fn(),
        acceptShares,
        fetchRecordInfos,
      })

      await expect(
        iCloudOAuthSession.acceptICloudSharedVault('share-guid'),
      ).resolves.toMatchObject(
        ok({
          role: 'participant',
          zoneName: 'shared-zone',
          rootRecordName: 'shared-root',
        }),
      )
      expect(acceptShares).not.toHaveBeenCalled()
    })

    it('preserves owner private-database routing on owner-device enrollment', async () => {
      const acceptShares = vi.fn()
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth: vi.fn().mockResolvedValue({
          userRecordName: 'owner-record',
        }),
        whenUserSignsIn: vi.fn(),
        fetchCurrentUserIdentity: vi.fn().mockResolvedValue({
          userRecordName: 'owner-record',
        }),
        acceptShares,
      })

      const target = await iCloudOAuthSession.acceptICloudSharedVault(
        'icloud-share-v1:{"role":"owner","zoneName":"shared-zone","ownerRecordName":"owner-record","rootRecordName":"shared-root","shortGuid":"share-guid"}',
      )

      expect(target).toMatchObject(
        ok({
          role: 'owner',
          zoneName: 'shared-zone',
          ownerRecordName: 'owner-record',
          rootRecordName: 'shared-root',
          shortGuid: 'share-guid',
        }),
      )
      expect(acceptShares).not.toHaveBeenCalled()
    })
  })

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
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
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
      let resolveSignIn: (value: unknown) => void = () => {}
      const signInPromise = new Promise((resolve) => {
        resolveSignIn = resolve
      })
      const setUpAuth = resolvedCloudKitEffect()
      const whenUserSignsIn = vi.fn().mockReturnValue(signInPromise)
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth,
        whenUserSignsIn,
      })

      const request = defaultICloudWebAuthTokenRequest()
      const pending = iCloudOAuthSession.requestICloudWebAuthToken(request)
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

      await expect(pending).resolves.toEqual(
        ok(iCloudTokensWithAccountName('fresh-token', 'Fresh User')),
      )
    })

    it('resolves from the CloudKit token store when the sign-in callback hangs', async () => {
      const setUpAuth = resolvedCloudKitEffect()
      const whenUserSignsIn = vi.fn().mockReturnValue(new Promise(() => {}))
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth,
        whenUserSignsIn,
      })

      const request = timedICloudWebAuthTokenRequest(100)
      const pending = iCloudOAuthSession.requestICloudWebAuthToken(request)
      await vi.waitFor(() => {
        expect(window.CloudKit!.configure).toHaveBeenCalled()
        expect(whenUserSignsIn).toHaveBeenCalled()
      })

      const config = vi.mocked(window.CloudKit!.configure).mock.calls[0]![0]
      config.services?.authTokenStore?.putToken(ICLOUD_CONTAINER_ID, {
        ckWebAuthToken: 'store-token',
      })

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

      const config = vi.mocked(window.CloudKit!.configure).mock.calls[0]![0]
      config.services?.authTokenStore?.putToken(ICLOUD_CONTAINER_ID, {
        ckWebAuthToken: 'fresh-token',
      })
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

      const config = vi.mocked(window.CloudKit!.configure).mock.calls[0]![0]
      config.services?.authTokenStore?.putToken(ICLOUD_CONTAINER_ID, {
        ckWebAuthToken: 'cloudkit-div-token',
      })
      resolveSignIn({ lookupInfo: {} })

      await expect(pending).resolves.toEqual(
        ok(iCloudTokensWithoutAccountName('cloudkit-div-token')),
      )
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
      const setUpAuth = resolvedCloudKitEffect()
      const whenUserSignsIn = vi.fn().mockReturnValue(signInPromise)
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth,
        whenUserSignsIn,
      })

      await iCloudOAuthSession.prepareICloudSignInControl()
      const request = nativeICloudWebAuthTokenRequest()
      const pending =
        iCloudOAuthSession.requestPreparedICloudWebAuthToken(request)

      expect(clickSpy).not.toHaveBeenCalled()
      expect(whenUserSignsIn).toHaveBeenCalledOnce()

      const config = vi.mocked(window.CloudKit!.configure).mock.calls[0]![0]
      config.services?.authTokenStore?.putToken(ICLOUD_CONTAINER_ID, {
        ckWebAuthToken: 'visible-control-token',
      })
      resolveSignIn({ lookupInfo: {} })

      await expect(pending).resolves.toEqual(
        ok(iCloudTokensWithoutAccountName('visible-control-token')),
      )
    })

    it('waits before the native CloudKit click stores a token', async () => {
      let resolveSignIn: (value: unknown) => void = () => {}
      const signInPromise = new Promise((resolve) => {
        resolveSignIn = resolve
      })
      const signInButton = document.querySelector<HTMLButtonElement>(
        '#apple-sign-in-button button',
      )
      const setUpAuth = resolvedCloudKitEffect()
      const whenUserSignsIn = vi.fn().mockReturnValue(signInPromise)
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth,
        whenUserSignsIn,
      })

      await iCloudOAuthSession.prepareICloudSignInControl()
      const config = vi.mocked(window.CloudKit!.configure).mock.calls[0]![0]
      signInButton?.addEventListener('click', () => {
        config.services?.authTokenStore?.putToken(ICLOUD_CONTAINER_ID, {
          ckWebAuthToken: 'native-click-token',
        })
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
      const setUpAuth = resolvedCloudKitEffect()
      const whenUserSignsIn = vi.fn().mockRejectedValue({
        _reason: 'UNKNOWN_ERROR',
      })
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
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

      const config = vi.mocked(window.CloudKit!.configure).mock.calls[0]![0]
      config.services?.authTokenStore?.putToken(ICLOUD_CONTAINER_ID, {
        ckWebAuthToken: 'opaque-callback-token',
      })

      await expect(pending).resolves.toEqual(
        ok(iCloudTokensWithoutAccountName('opaque-callback-token')),
      )
    })

    it('falls back to CloudKit web auth redirect when CloudKit JS hides the auth challenge', async () => {
      const setUpAuth = resolvedCloudKitEffect()
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
      const setUpAuth = resolvedCloudKitEffect()
      const whenUserSignsIn = vi.fn().mockRejectedValue({
        serverErrorCode: 'AUTHENTICATION_REQUIRED',
        reason: 'request needs authorization',
      })
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
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
      const setUpAuth = resolvedCloudKitEffect()
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
      const setUpAuth = resolvedCloudKitEffect()
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

      await iCloudOAuthSession.prepareICloudSignInControl()

      const request = timedICloudWebAuthTokenRequest(5000)
      await expect(
        iCloudOAuthSession.requestPreparedICloudWebAuthToken(request),
      ).resolves.toEqual(
        err(new OAuthFailure(OAuthFailureKind.CloudKitAuthentication)),
      )
    })

    it('fails when CloudKit sign-in never completes', async () => {
      const setUpAuth = resolvedCloudKitEffect()
      const whenUserSignsIn = vi.fn().mockReturnValue(new Promise(() => {}))
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
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
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
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
      const config = vi.mocked(window.CloudKit!.configure).mock.calls[0]![0]
      config.services?.authTokenStore?.putToken(ICLOUD_CONTAINER_ID, {
        ckWebAuthToken: 'auth-required-token',
      })
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
      const config = vi.mocked(window.CloudKit!.configure).mock.calls[0]![0]
      config.services?.authTokenStore?.putToken(ICLOUD_CONTAINER_ID, {
        ckWebAuthToken: 'opaque-setup-token',
      })
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
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
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
      const setUpAuth = resolvedCloudKitEffect()
      const whenUserSignsIn = vi.fn().mockReturnValue(new Promise(() => {}))
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
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
      const setUpAuth = resolvedCloudKitEffect()
      const whenUserSignsIn = vi.fn().mockReturnValue(new Promise(() => {}))
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth,
        whenUserSignsIn,
      })

      const request = timedICloudWebAuthTokenRequest(500)
      const pending = iCloudOAuthSession.requestICloudWebAuthToken(request)
      await vi.waitFor(() => {
        expect(window.CloudKit!.configure).toHaveBeenCalled()
        expect(whenUserSignsIn).toHaveBeenCalled()
      })

      const config = vi.mocked(window.CloudKit!.configure).mock.calls[0]![0]
      config.services?.authTokenStore?.putToken(ICLOUD_CONTAINER_ID, {
        webAuthToken: 'alt-format-token',
      })

      await expect(pending).resolves.toEqual(
        ok(iCloudTokensWithoutAccountName('alt-format-token')),
      )
    })

    it('allows retry after a sign-in timeout by resetting auth state', async () => {
      const setUpAuth = resolvedCloudKitEffect()
      const whenUserSignsIn = vi.fn().mockReturnValue(new Promise(() => {}))
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth,
        whenUserSignsIn,
      })

      // First attempt times out.
      const firstRequest = timedICloudWebAuthTokenRequest(1)
      await expect(
        iCloudOAuthSession.requestICloudWebAuthToken(firstRequest),
      ).resolves.toEqual(err(new OAuthFailure(OAuthFailureKind.TimedOut)))

      // Second attempt should re-run setUpAuth (not reuse stale promise).
      let resolveSignIn: (value: unknown) => void = () => {}
      const signInPromise = new Promise((resolve) => {
        resolveSignIn = resolve
      })
      vi.mocked(window.CloudKit!.getDefaultContainer).mockReturnValue({
        setUpAuth: resolvedCloudKitEffect(),
        whenUserSignsIn: vi.fn().mockReturnValue(signInPromise),
      })

      const retryRequest = timedICloudWebAuthTokenRequest(5000)
      const pending = iCloudOAuthSession.requestICloudWebAuthToken(retryRequest)

      const config = vi.mocked(window.CloudKit!.configure).mock.calls[0]![0]
      config.services?.authTokenStore?.putToken(ICLOUD_CONTAINER_ID, {
        ckWebAuthToken: 'retry-token',
      })
      resolveSignIn({ lookupInfo: {} })

      await expect(pending).resolves.toEqual(
        ok(iCloudTokensWithoutAccountName('retry-token')),
      )
    })
  })
})

describe('CloudKit token transport decoding', () => {
  it('persists only a decoded token from SDK payloads', () => {
    cloudKitAuthTokenStore.putToken(ICLOUD_CONTAINER_ID, {
      token: ' accepted ',
      unrelated: 'not-persisted',
    })
    expect(cloudKitAuthTokenStore.getToken(ICLOUD_CONTAINER_ID)).toBe(
      'accepted',
    )
    expect(
      sessionStorage.getItem('nook.icloud.webAuthToken.' + ICLOUD_CONTAINER_ID),
    ).toBe(JSON.stringify('accepted'))
  })
  it('rejects malformed persisted JSON and invalid token shapes', () => {
    sessionStorage.setItem(
      'nook.icloud.webAuthToken.' + ICLOUD_CONTAINER_ID,
      '{',
    )
    expect(cloudKitAuthTokenStore.getToken(ICLOUD_CONTAINER_ID)).toEqual(void 0)
    cloudKitAuthTokenStore.putToken(ICLOUD_CONTAINER_ID, { token: 42 })
    expect(cloudKitAuthTokenStore.getToken(ICLOUD_CONTAINER_ID)).toEqual(void 0)
  })
})
