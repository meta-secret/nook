import { beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { default as initNookWasm, NookVaultManager } from '$app-wasm'
import {
  DEFAULT_DRIVE_BACKUP_NAME,
  configuredOAuthFile,
  decodeStoredOAuthFileConfiguration,
  defaultOAuthFileConfig,
  githubPatValue,
  StoredOAuthFileConfigurationDecodeKind,
  oauth_access_token,
  providerPersistenceDefaults,
  storedGithubPat,
  storedGithubRepository,
  storedOAuthAccountEmail,
  storedOAuthCredential,
  storedOAuthRefreshCredential,
  unselectedVaultScope,
  type StorageProvider,
} from '$lib/auth/providers'

const AGE_ARMOR_MARKER = 'BEGIN AGE ENCRYPTED FILE'
let manager: NookVaultManager

type PersistedAuthProvider = {
  githubPat?: unknown
  oauthFile?: unknown
}

async function clearAuthProviderStore(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('nook_auth', 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('auth')) {
        db.createObjectStore('auth')
      }
    }
    request.onerror = () =>
      reject(
        ((v) => (v ? v : new Error('Failed to clear nook_auth.')))(
          request.error,
        ),
      )
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction('auth', 'readwrite')
      transaction.objectStore('auth').clear()
      transaction.oncomplete = () => {
        db.close()
        resolve()
      }
      transaction.onerror = () =>
        reject(
          ((v) => (v ? v : new Error('Failed to clear nook_auth.')))(
            transaction.error,
          ),
        )
    }
  })
}

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

const PROVIDERS_KEY_PREFIX = 'providers:'

type StoredProviderRecord = {
  key: string
  value: unknown
}

async function readStoredProviderRecord(): Promise<StoredProviderRecord> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('nook_auth', 1)
    request.onerror = () =>
      reject(
        ((v) => (v ? v : new Error('Failed to open nook_auth.')))(
          request.error,
        ),
      )
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('auth', 'readonly')
      const store = tx.objectStore('auth')
      const cursorReq = store.openCursor()
      const records: StoredProviderRecord[] = []
      cursorReq.onerror = () =>
        reject(
          ((v) => (v ? v : new Error('Failed to read providers.')))(
            cursorReq.error,
          ),
        )
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result
        if (cursor) {
          const key = String(cursor.key)
          if (key.startsWith(PROVIDERS_KEY_PREFIX)) {
            records.push({ key, value: cursor.value })
          }
          cursor.continue()
          return
        }
        const [record, ...others] = records
        if (!record || others.length > 0) {
          reject(new Error('expected exactly one app-scoped provider record'))
          return
        }
        resolve(record)
      }
      tx.oncomplete = () => db.close()
      tx.onerror = () =>
        reject(((v) => (v ? v : new Error('IndexedDB tx failed.')))(tx.error))
    }
  })
}

async function readRawAuthProvidersFromIdb(): Promise<unknown> {
  return (await readStoredProviderRecord()).value
}

function persistedProvider(rawSnapshot: unknown): PersistedAuthProvider {
  if (
    !rawSnapshot ||
    typeof rawSnapshot !== 'object' ||
    Array.isArray(rawSnapshot) ||
    !('providers' in rawSnapshot)
  ) {
    throw new Error('expected a persisted auth-provider snapshot')
  }
  const providers = rawSnapshot.providers
  if (!Array.isArray(providers) || providers.length === 0) {
    throw new Error('expected a persisted auth provider')
  }
  for (const candidate of providers) {
    const provider: unknown = candidate
    if (!(provider instanceof Object) || Array.isArray(provider)) {
      continue
    }
    const persisted: PersistedAuthProvider = {}
    if ('githubPat' in provider) persisted.githubPat = provider.githubPat
    if ('oauthFile' in provider) persisted.oauthFile = provider.oauthFile
    return persisted
  }
  throw new Error('expected the persisted provider to be an object')
}

function storedTokenValue(stored: unknown): string {
  if (
    !stored ||
    typeof stored !== 'object' ||
    !('value' in stored) ||
    typeof stored.value !== 'string'
  ) {
    throw new Error('expected a persisted credential token')
  }
  return stored.value
}

function persistedGithubPat(rawSnapshot: unknown): string {
  return storedTokenValue(persistedProvider(rawSnapshot).githubPat)
}

function persistedOAuthCredentials(rawSnapshot: unknown): {
  accessToken: string
  refreshToken: string
} {
  const oauthFile = persistedProvider(rawSnapshot).oauthFile
  if (
    !oauthFile ||
    typeof oauthFile !== 'object' ||
    !('config' in oauthFile) ||
    !oauthFile.config ||
    typeof oauthFile.config !== 'object' ||
    !('accessToken' in oauthFile.config) ||
    !('refreshToken' in oauthFile.config)
  ) {
    throw new Error('expected persisted OAuth credentials')
  }
  return {
    accessToken: storedTokenValue(oauthFile.config.accessToken),
    refreshToken: storedTokenValue(oauthFile.config.refreshToken),
  }
}

describe('sync provider credential encryption (wasm + IndexedDB)', () => {
  beforeAll(async () => {
    await initNookWasm()
    manager = new NookVaultManager()
    const setup = await manager.begin_device_protection()
    try {
      await manager.finish_device_protection(
        new Uint8Array(32).fill(7),
        setup.userHandle,
        setup.prfInput,
        new Uint8Array(32).fill(11),
      )
    } finally {
      setup.free()
    }
  })

  beforeEach(clearAuthProviderStore)

  test('saveAuthProviders seals GitHub PAT in IndexedDB', async () => {
    const pat = 'github_pat_11UNITtestSECRETtoken'
    await manager.save_auth_providers_snapshot({
      providers: [githubProvider('gh-unit', pat)],
      activeVaultStoreId: unselectedVaultScope(),
    })

    const raw = await readRawAuthProvidersFromIdb()
    const storedPat = persistedGithubPat(raw)
    expect(storedPat).toContain(AGE_ARMOR_MARKER)
    expect(storedPat).not.toContain('UNITtestSECRET')
  })

  test('loadAuthProviders decrypts sealed GitHub PAT', async () => {
    const pat = 'github_pat_22LOADdecryptTOKEN'
    await manager.save_auth_providers_snapshot({
      providers: [githubProvider('gh-load', pat)],
      activeVaultStoreId: unselectedVaultScope(),
    })

    const loaded = await manager.load_auth_providers_snapshot()
    const provider = loaded.providers[0]
    if (!provider) throw new Error('expected a loaded GitHub provider')
    expect(githubPatValue(provider.githubPat)).toBe(pat)
  })

  test('loadAuthProviders rejects plaintext credentials', async () => {
    const pat = 'github_pat_33PLAINtextROW'
    await manager.save_auth_providers_snapshot({
      providers: [githubProvider('gh-plain', 'github_pat_sealed_first')],
      activeVaultStoreId: unselectedVaultScope(),
    })
    const stored = await readStoredProviderRecord()
    // IndexedDB hands back a fresh copy, so editing it leaves the store alone.
    const plaintext: unknown = stored.value
    if (
      !plaintext ||
      typeof plaintext !== 'object' ||
      !('providers' in plaintext) ||
      !Array.isArray(plaintext.providers)
    ) {
      throw new Error('expected a persisted GitHub provider row')
    }
    const row: unknown = plaintext.providers[0]
    if (!(row instanceof Object)) {
      throw new Error('expected a persisted GitHub provider row')
    }
    Object.assign(row, { githubPat: { state: 'token', value: pat } })
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('nook_auth', 1)
      request.onerror = () =>
        reject(
          ((v) => (v ? v : new Error('Failed to open nook_auth.')))(
            request.error,
          ),
        )
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('auth', 'readwrite')
        tx.objectStore('auth').put(plaintext, stored.key)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () =>
          reject(((v) => (v ? v : new Error('IndexedDB tx failed.')))(tx.error))
      }
    })

    await expect(manager.load_auth_providers_snapshot()).rejects.toThrow(
      'Provider credential is not age-encrypted.',
    )

    const raw = await readRawAuthProvidersFromIdb()
    expect(persistedGithubPat(raw)).toBe(pat)
  })

  test('saveAuthProviders seals OAuth access and refresh tokens', async () => {
    const access = 'ya29.unit-oauth-access-token'
    const refresh = '1//unit-refresh-token-secret'
    const oauthFile = {
      ...defaultOAuthFileConfig({
        preset: 'google-drive',
        fileName: DEFAULT_DRIVE_BACKUP_NAME,
      }),
      accessToken: storedOAuthCredential(access),
      refreshToken: storedOAuthRefreshCredential(refresh),
      accountEmail: storedOAuthAccountEmail('me@example.com'),
    }
    await manager.save_auth_providers_snapshot({
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
    const oauth = persistedOAuthCredentials(raw)
    expect(oauth.accessToken).toContain(AGE_ARMOR_MARKER)
    expect(oauth.refreshToken).toContain(AGE_ARMOR_MARKER)
    expect(oauth.accessToken).not.toContain(access)
    expect(oauth.refreshToken).not.toContain(refresh)

    const loaded = await manager.load_auth_providers_snapshot()
    const provider = loaded.providers[0]
    if (!provider) throw new Error('expected a loaded OAuth provider')
    const loadedOauth = decodeStoredOAuthFileConfiguration(provider.oauthFile)
    if (
      loadedOauth.kind !== StoredOAuthFileConfigurationDecodeKind.Configured
    ) {
      throw new Error('expected configured OAuth credentials')
    }
    const loadedAccess = oauth_access_token(loadedOauth.config)
    if (loadedAccess.kind !== 'available') {
      throw new Error('expected a loaded OAuth access token')
    }
    expect(loadedAccess.token).toBe(access)
    if (loadedOauth.config.refreshToken.state !== 'token') {
      throw new Error('expected a loaded OAuth refresh token')
    }
    expect(loadedOauth.config.refreshToken.value).toBe(refresh)
  })
})
