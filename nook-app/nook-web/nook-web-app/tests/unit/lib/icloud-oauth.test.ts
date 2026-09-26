import { ok, err } from 'neverthrow'
import { OAuthFailure, OAuthFailureKind } from '$lib/auth/oauth-failure'
import { cloudKitAuthTokenStore } from '$lib/auth/icloud/cloudkit-runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ICloudAccountNameKind,
  iCloudOAuthSession,
} from '$lib/auth/icloud/oauth'
import { oauthConfigurationNotApplicable } from '$lib/auth/providers'
import { ICloudOAuthTestFixture } from './icloud-oauth-test-fixture'

import {
  ICLOUD_CONTAINER_ID,
  ICLOUD_ENVIRONMENT,
} from '$lib/auth/icloud/config'

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
      ICloudOAuthTestFixture.useContainer({
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
      if (target.isErr()) return
      expect(target.value.storageTargetId).toContain('icloud-share-v1:')
      expect(target.value.storageTargetId).not.toContain('ck-web-auth-token')
    })

    it('keeps an absent current identity signed out', async () => {
      const saveRecordZones = vi.fn()
      ICloudOAuthTestFixture.useContainer({
        setUpAuth: ICloudOAuthTestFixture.resolvedSignedOutIdentity(),
        whenUserSignsIn: vi.fn(),
        fetchCurrentUserIdentity:
          ICloudOAuthTestFixture.resolvedSignedOutIdentity(),
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
      ICloudOAuthTestFixture.useContainer({
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
      if (target.isErr()) return
      expect(target.value.storageTargetId).toContain('icloud-share-v1:')
      expect(target.value.storageTargetId).not.toContain('ck-web-auth-token')
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
      ICloudOAuthTestFixture.useContainer({
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
      ICloudOAuthTestFixture.useContainer({
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
})

describe('CloudKit token transport decoding', () => {
  it('normalizes the strongly typed SDK token before persistence', () => {
    cloudKitAuthTokenStore.putToken(ICLOUD_CONTAINER_ID, ' accepted ')
    expect(cloudKitAuthTokenStore.getToken(ICLOUD_CONTAINER_ID)).toBe(
      'accepted',
    )
    expect(
      sessionStorage.getItem('nook.icloud.webAuthToken.' + ICLOUD_CONTAINER_ID),
    ).toBe(JSON.stringify('accepted'))
  })
  it('rejects malformed persisted JSON', () => {
    sessionStorage.setItem(
      'nook.icloud.webAuthToken.' + ICLOUD_CONTAINER_ID,
      '{',
    )
    expect(cloudKitAuthTokenStore.getToken(ICLOUD_CONTAINER_ID)).toEqual(void 0)
  })
})
