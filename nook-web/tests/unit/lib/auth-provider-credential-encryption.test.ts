import { beforeAll, describe, expect, test } from 'vitest'
import {
  default as initNookWasm,
  loadAuthProviders,
  NookVaultManager,
  saveAuthProviders,
} from '$lib/nook-wasm/nook_wasm'

const AGE_ARMOR_MARKER = 'BEGIN AGE ENCRYPTED FILE'
let manager: NookVaultManager

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
      await saveAuthProviders(manager, {
        providers: [
          {
            id: 'gh-unit',
            type: 'github',
            label: 'GitHub',
            githubPat: pat,
            githubRepo: 'nook',
            createdAt: '2026-06-24T00:00:00.000Z',
          },
        ],
      })

      const raw = await readRawAuthProvidersFromIdb()
      const storedPat = raw.providers[0]?.githubPat
      expect(storedPat).toBeDefined()
      expect(storedPat).toContain(AGE_ARMOR_MARKER)
      expect(storedPat).not.toContain('UNITtestSECRET')
    })

    test('loadAuthProviders decrypts sealed GitHub PAT', async () => {
      const pat = 'github_pat_22LOADdecryptTOKEN'
      await saveAuthProviders(manager, {
        providers: [
          {
            id: 'gh-load',
            type: 'github',
            label: 'GitHub',
            githubPat: pat,
            githubRepo: 'nook',
            createdAt: '2026-06-24T00:00:00.000Z',
          },
        ],
      })

      const loaded = await loadAuthProviders(manager)
      expect(loaded.snapshot.providers[0]?.githubPat).toBe(pat)
    })

    test('loadAuthProviders upgrades legacy plaintext rows to sealed storage', async () => {
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

      const loaded = await loadAuthProviders(manager)
      expect(loaded.snapshot.providers[0]?.githubPat).toBe(pat)

      const raw = await readRawAuthProvidersFromIdb()
      const storedPat = raw.providers[0]?.githubPat
      expect(storedPat).toContain(AGE_ARMOR_MARKER)
      expect(storedPat).not.toContain('LEGACYplain')
    })

    test('saveAuthProviders seals OAuth access and refresh tokens', async () => {
      const access = 'ya29.unit-oauth-access-token'
      const refresh = '1//unit-refresh-token-secret'
      await saveAuthProviders(manager, {
        providers: [
          {
            id: 'gd-unit',
            type: 'oauth-file',
            label: 'Google Drive',
            oauthFile: {
              preset: 'google-drive',
              accessToken: access,
              refreshToken: refresh,
              fileName: 'nook-vault.yaml',
              accountEmail: 'me@example.com',
            },
            createdAt: '2026-06-24T00:00:00.000Z',
          },
        ],
      })

      const raw = await readRawAuthProvidersFromIdb()
      const oauth = raw.providers[0]?.oauthFile
      expect(oauth?.accessToken).toContain(AGE_ARMOR_MARKER)
      expect(oauth?.refreshToken).toContain(AGE_ARMOR_MARKER)
      expect(oauth?.accessToken).not.toContain(access)
      expect(oauth?.refreshToken).not.toContain(refresh)

      const loaded = await loadAuthProviders(manager)
      const loadedOauth = loaded.snapshot.providers[0]?.oauthFile
      expect(loadedOauth?.accessToken).toBe(access)
      expect(loadedOauth?.refreshToken).toBe(refresh)
    })
  },
)
