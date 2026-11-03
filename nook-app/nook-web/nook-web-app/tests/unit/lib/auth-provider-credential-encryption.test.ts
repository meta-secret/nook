import { beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { default as initNookWasm, NookVaultManager } from '$app-wasm'
import { unselectedVaultScope, type StorageProvider } from '$lib/auth/providers'
import { ProviderRowFixture } from '../provider-fixtures'

const AGE_ARMOR_MARKER = 'BEGIN AGE ENCRYPTED FILE'
let manager: NookVaultManager

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
  const row = ProviderRowFixture.github(ProviderRowFixture.unscoped(id))
  return {
    ...row,
    provider: {
      type: 'github',
      repository: { state: 'repository', value: 'nook' },
      token: pat,
    },
  }
}

function driveProvider(id: string, accessToken: string): StorageProvider {
  const row = ProviderRowFixture.googleDrive(ProviderRowFixture.unscoped(id))
  return {
    ...row,
    provider: {
      type: 'oauth-file',
      preset: 'google-drive',
      authorization: { accessToken, expiresAt: '2099-01-01T00:00:00.000Z' },
      account: { state: 'email', email: 'me@example.com' },
      folderId: 'drive-folder-test',
    },
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

/** The tagged payload of the first persisted row. */
function persistedPayload(rawSnapshot: unknown): unknown {
  if (
    !rawSnapshot ||
    typeof rawSnapshot !== 'object' ||
    !('providers' in rawSnapshot) ||
    !Array.isArray(rawSnapshot.providers)
  ) {
    throw new Error('expected a persisted auth-provider snapshot')
  }
  const row: unknown = rawSnapshot.providers[0]
  if (!(row instanceof Object) || !('provider' in row)) {
    throw new Error('expected a persisted provider row')
  }
  return row.provider
}

function persistedGithubPat(rawSnapshot: unknown): string {
  const payload = persistedPayload(rawSnapshot)
  if (
    !(payload instanceof Object) ||
    !('token' in payload) ||
    typeof payload.token !== 'string'
  ) {
    throw new Error('expected a persisted GitHub token')
  }
  return payload.token
}

function persistedDriveAccessToken(rawSnapshot: unknown): string {
  const payload = persistedPayload(rawSnapshot)
  if (
    !(payload instanceof Object) ||
    !('authorization' in payload) ||
    !(payload.authorization instanceof Object) ||
    !('accessToken' in payload.authorization) ||
    typeof payload.authorization.accessToken !== 'string'
  ) {
    throw new Error('expected a persisted Drive access token')
  }
  return payload.authorization.accessToken
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
    expect(loaded.providers).toMatchObject([
      { provider: { type: 'github', token: pat } },
    ])
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
    const payload = persistedPayload(plaintext)
    if (!(payload instanceof Object)) {
      throw new Error('expected a persisted GitHub provider payload')
    }
    Object.assign(payload, { token: pat })
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

  test('saveAuthProviders seals the OAuth access token', async () => {
    const access = 'ya29.unit-oauth-access-token'
    await manager.save_auth_providers_snapshot({
      providers: [driveProvider('gd-unit', access)],
      activeVaultStoreId: unselectedVaultScope(),
    })

    const raw = await readRawAuthProvidersFromIdb()
    const storedAccess = persistedDriveAccessToken(raw)
    expect(storedAccess).toContain(AGE_ARMOR_MARKER)
    expect(storedAccess).not.toContain(access)
    expect(JSON.stringify(raw)).not.toContain(access)

    const loaded = await manager.load_auth_providers_snapshot()
    expect(loaded.providers).toMatchObject([
      {
        provider: {
          type: 'oauth-file',
          authorization: { accessToken: access },
        },
      },
    ])
  })
})
