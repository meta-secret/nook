import { beforeAll, describe, expect, test } from 'vitest'
import { default as initNookWasm, NookVaultManager } from '$app-wasm'
import {
  configuredOAuthFile,
  defaultOAuthFileConfig,
  githubPatValue,
  oauthAccessToken,
  OAuthAccessTokenKind,
  oauthProviderConfiguration,
  OAuthProviderConfigurationKind,
  providerPersistenceDefaults,
  storedGithubPat,
  storedGithubRepository,
  storedOAuthAccountEmail,
  storedOAuthCredential,
  storedOAuthRefreshCredential,
  unselectedVaultScope,
  type StorageProvider,
} from '$lib/auth-providers'

const AGE_ARMOR_MARKER = 'BEGIN AGE ENCRYPTED FILE'
let manager: NookVaultManager

function githubProvider(id: string, pat: string): StorageProvider {
  return {
    ...providerPersistenceDefaults(),
    id,
    type: 'github',
    label: 'GitHub',
    githubPat: storedGithubPat(pat),
    githubRepo: storedGithubRepository('nook'),
    syncCheckpoint: { state: 'neverSynced' },
    createdAt: '2026-06-24T00:00:00.000Z',
  }
}

async function readRawAuthProvidersFromIdb(): Promise<{
  providers: Array<{
    githubPat?: string
    oauthFile?: { accessToken?: string; refreshToken?: string }
  }>
}> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('nook_auth', 1)
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to open nook_auth.'))
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('auth', 'readonly')
      const store = tx.objectStore('auth')
      const getReq = store.get('providers')
      getReq.onerror = () =>
        reject(getReq.error ?? new Error('Failed to read providers.'))
      getReq.onsuccess = () => {
        resolve(
          (getReq.result as {
            providers: Array<{
              githubPat?: string
              oauthFile?: { accessToken?: string; refreshToken?: string }
            }>
          }) ?? { providers: [] },
        )
      }
      tx.oncomplete = () => db.close()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB tx failed.'))
    }
  })
}

describe.sequential(
  'sync provider credential encryption (wasm + IndexedDB)',
  () => {
    beforeAll(async () => {
      await initNookWasm()
      manager = new NookVaultManager()
      const setup = await manager.beginDeviceProtection()
      try {
        await manager.finishDeviceProtection(
          new Uint8Array(32).fill(7),
          setup.userHandle,
          setup.prfInput,
          new Uint8Array(32).fill(11),
        )
      } finally {
        setup.free()
      }
    })

    test('saveAuthProviders seals GitHub PAT in IndexedDB', async () => {
      const pat = 'github_pat_11UNITtestSECRETtoken'
      await manager.saveAuthProviders({
        providers: [githubProvider('gh-unit', pat)],
        activeVaultStoreId: unselectedVaultScope(),
      })

      const raw = await readRawAuthProvidersFromIdb()
      const storedPat = raw.providers[0]?.githubPat
      expect(storedPat).toBeTypeOf('string')
      if (typeof storedPat !== 'string') {
        throw new Error('expected a persisted sealed GitHub token')
      }
      expect(storedPat).toContain(AGE_ARMOR_MARKER)
      expect(storedPat).not.toContain('UNITtestSECRET')
    })

    test('loadAuthProviders decrypts sealed GitHub PAT', async () => {
      const pat = 'github_pat_22LOADdecryptTOKEN'
      await manager.saveAuthProviders({
        providers: [githubProvider('gh-load', pat)],
        activeVaultStoreId: unselectedVaultScope(),
      })

      const loaded = await manager.loadAuthProviders()
      const provider = loaded.providers[0]
      if (!provider) throw new Error('expected a loaded GitHub provider')
      expect(githubPatValue(provider.githubPat)).toBe(pat)
    })

    test('loadAuthProviders rejects plaintext rows without a legacy fallback', async () => {
      const pat = 'github_pat_33LEGACYplainROW'
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('nook_auth', 1)
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains('auth')) {
            db.createObjectStore('auth')
          }
        }
        request.onerror = () =>
          reject(request.error ?? new Error('Failed to open nook_auth.'))
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('auth', 'readwrite')
          const store = tx.objectStore('auth')
          store.put(
            {
              providers: [
                {
                  id: 'gh-legacy',
                  type: 'github',
                  label: 'GitHub',
                  githubPat: pat,
                  githubRepo: 'nook',
                  createdAt: '2026-06-24T00:00:00.000Z',
                },
              ],
            },
            'providers',
          )
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () =>
            reject(tx.error ?? new Error('IndexedDB tx failed.'))
        }
      })

      await expect(manager.loadAuthProviders()).rejects.toThrow(
        'Provider credential is not age-encrypted.',
      )

      const raw = await readRawAuthProvidersFromIdb()
      expect(raw.providers[0]?.githubPat).toBe(pat)
    })

    test('saveAuthProviders seals OAuth access and refresh tokens', async () => {
      const access = 'ya29.unit-oauth-access-token'
      const refresh = '1//unit-refresh-token-secret'
      const oauthFile = {
        ...defaultOAuthFileConfig('google-drive'),
        accessToken: storedOAuthCredential(access),
        refreshToken: storedOAuthRefreshCredential(refresh),
        accountEmail: storedOAuthAccountEmail('me@example.com'),
      }
      await manager.saveAuthProviders({
        providers: [
          {
            ...providerPersistenceDefaults(),
            id: 'gd-unit',
            type: 'oauth-file',
            label: 'Google Drive',
            oauthFile: configuredOAuthFile(oauthFile),
            syncCheckpoint: { state: 'neverSynced' },
            createdAt: '2026-06-24T00:00:00.000Z',
          },
        ],
        activeVaultStoreId: unselectedVaultScope(),
      })

      const raw = await readRawAuthProvidersFromIdb()
      const oauth = raw.providers[0]?.oauthFile
      expect(oauth?.accessToken).toContain(AGE_ARMOR_MARKER)
      expect(oauth?.refreshToken).toContain(AGE_ARMOR_MARKER)
      expect(oauth?.accessToken).not.toContain(access)
      expect(oauth?.refreshToken).not.toContain(refresh)

      const loaded = await manager.loadAuthProviders()
      const provider = loaded.providers[0]
      if (!provider) throw new Error('expected a loaded OAuth provider')
      const loadedOauth = oauthProviderConfiguration(provider)
      if (loadedOauth.kind !== OAuthProviderConfigurationKind.Configured) {
        throw new Error('expected configured OAuth credentials')
      }
      const loadedAccess = oauthAccessToken(loadedOauth.config)
      if (loadedAccess.kind !== OAuthAccessTokenKind.Available) {
        throw new Error('expected a loaded OAuth access token')
      }
      expect(loadedAccess.token).toBe(access)
      if (loadedOauth.config.refreshToken.state !== 'token') {
        throw new Error('expected a loaded OAuth refresh token')
      }
      expect(loadedOauth.config.refreshToken.value).toBe(refresh)
    })
  },
)
