import { expect, type Page } from '@playwright/test'
import {
  type ActiveVaultScope,
  type GoogleDriveMode,
  type ICloudMode,
} from '$app-wasm'
import { readLocalVaultYamlFromIdb } from './local-sync'
import { ENROLLMENT_UNLOCK_TIMEOUT_MS, UI_TIMEOUT_MS } from './environment'

export type SeededAuthProvider = {
  id: string
  type: string
  label: string
  githubRepo?: string
  githubPat?: string
  oauthFile?: {
    preset: string
    accessToken: string
    fileName: string
    driveMode: GoogleDriveMode
    iCloudMode: ICloudMode
    accountEmail?: string
    folderId?: string
  }
  storeId?: string
  createdAt?: string
}

export enum AuthProviderSeedScopeKind {
  Unselected = 'unselected',
  ActiveVault = 'active-vault',
}

export type AuthProviderSeedScope =
  | { kind: AuthProviderSeedScopeKind.Unselected }
  | { kind: AuthProviderSeedScopeKind.ActiveVault; storeId: string }

export function unselectedAuthProviderSeedScope(): AuthProviderSeedScope {
  return { kind: AuthProviderSeedScopeKind.Unselected }
}

export function activeAuthProviderSeedScope(
  storeId: string,
): AuthProviderSeedScope {
  return { kind: AuthProviderSeedScopeKind.ActiveVault, storeId }
}

type AuthProviderBrowserHooks = {
  activeVaultScope(storeId: string): ActiveVaultScope
  loadAuthProviders: () => Promise<{
    providers: SeededAuthProvider[]
    activeVaultStoreId: ActiveVaultScope
  }>
  saveAuthProviders: (snapshot: {
    providers: SeededAuthProvider[]
    activeVaultStoreId: ActiveVaultScope
  }) => Promise<void>
  unselectedVaultScope(): ActiveVaultScope
}

export async function appendAuthProviders(
  page: Page,
  providers: SeededAuthProvider[],
): Promise<void> {
  await page.evaluate(
    ({ providers: additions }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('nook_auth', 1)
        request.onerror = () =>
          reject(request.error ?? new Error('idb open failed'))
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('auth', 'readwrite')
          const store = tx.objectStore('auth')
          const getRequest = store.get('providers')
          getRequest.onerror = () =>
            reject(getRequest.error ?? new Error('idb read failed'))
          getRequest.onsuccess = () => {
            const rawSnapshot = getRequest.result as unknown
            const snapshot =
              rawSnapshot && typeof rawSnapshot === 'object'
                ? (rawSnapshot as {
                    providers: SeededAuthProvider[]
                  })
                : {
                    providers: [],
                  }
            snapshot.providers.push(
              ...additions.map((provider) => {
                return {
                  ...provider,
                  createdAt: new Date().toISOString(),
                }
              }),
            )
            const putRequest = store.put(snapshot, 'providers')
            putRequest.onerror = () =>
              reject(putRequest.error ?? new Error('idb write failed'))
          }
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error ?? new Error('idb tx failed'))
        }
      }),
    { providers },
  )
}

async function appendSealedAuthProviders(
  page: Page,
  providers: SeededAuthProvider[],
  seedScope: AuthProviderSeedScope,
): Promise<void> {
  await page.evaluate(
    async ({ providers: additions, seedScope }) => {
      const hook = (
        window as Window & {
          __nookAuthProviders?: AuthProviderBrowserHooks
        }
      ).__nookAuthProviders
      if (!hook) throw new Error('E2E auth provider hooks are unavailable')
      const fallbackActiveVaultScope =
        'storeId' in seedScope
          ? hook.activeVaultScope(seedScope.storeId)
          : hook.unselectedVaultScope()
      const snapshot = await hook.loadAuthProviders()
      const resolvedActiveVaultScope =
        'value' in snapshot.activeVaultStoreId
          ? snapshot.activeVaultStoreId
          : fallbackActiveVaultScope
      snapshot.providers.push(
        ...additions.map((provider) => {
          if (provider.type !== 'oauth-file') {
            return {
              ...provider,
              createdAt: new Date().toISOString(),
            }
          }
          if (!('value' in resolvedActiveVaultScope)) {
            throw new Error(
              'E2E OAuth provider seeding requires an active vault',
            )
          }
          return {
            ...provider,
            storeId: resolvedActiveVaultScope.value,
            createdAt: new Date().toISOString(),
          }
        }),
      )
      await hook.saveAuthProviders(snapshot)
    },
    { providers, seedScope },
  )
}

export async function waitForAuthProviderIds(
  page: Page,
  expectedIds: string[],
): Promise<void> {
  await page.waitForFunction(
    (ids) =>
      new Promise<boolean>((resolve) => {
        const request = indexedDB.open('nook_auth', 1)
        request.onerror = () => resolve(false)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('auth', 'readonly')
          const getRequest = tx.objectStore('auth').get('providers')
          getRequest.onerror = () => resolve(false)
          getRequest.onsuccess = () => {
            const rawSnapshot = getRequest.result as unknown
            const snapshot =
              rawSnapshot && typeof rawSnapshot === 'object'
                ? (rawSnapshot as {
                    providers?: Array<{ id: string }>
                  })
                : { providers: [] }
            const storedIds = new Set(
              snapshot.providers?.map((provider) => provider.id) ?? [],
            )
            resolve(ids.every((id) => storedIds.has(id)))
          }
          tx.oncomplete = () => db.close()
        }
      }),
    expectedIds,
    { timeout: UI_TIMEOUT_MS },
  )
}

/**
 * Add extra GitHub providers to the saved auth snapshot for onboarding UI tests.
 */
export async function seedExtraGithubProviders(
  page: Page,
  extras: Array<{
    id: string
    label: string
    githubRepo: string
    githubPat: string
  }>,
) {
  await appendSealedAuthProviders(
    page,
    extras.map((provider) => ({ ...provider, type: 'github' })),
    unselectedAuthProviderSeedScope(),
  )
  await waitForAuthProviderIds(
    page,
    extras.map((provider) => provider.id),
  )
}

/**
 * Add extra oauth-file providers to the saved auth snapshot for onboarding UI tests.
 */
export async function seedExtraOauthFileProviders(
  page: Page,
  extras: Array<{
    id: string
    label: string
    fileName: string
    accessToken: string
    accountEmail?: string
    folderId?: string
  }>,
) {
  const vaultYaml = await readLocalVaultYamlFromIdb(page).catch(() => '')
  const storeIdMatch = vaultYaml.match(/^store_id:\s*(\S+)/m)
  if (!storeIdMatch) {
    throw new Error('E2E OAuth provider seeding requires an active vault')
  }
  const storeIdFromVault = storeIdMatch[1]

  await appendSealedAuthProviders(
    page,
    extras.map((provider) => ({
      id: provider.id,
      type: 'oauth-file',
      label: provider.label,
      oauthFile: {
        preset: 'google-drive',
        accessToken: provider.accessToken,
        fileName: provider.fileName,
        driveMode: provider.folderId ? 'shared' : 'private',
        iCloudMode: 'private',
        accountEmail: provider.accountEmail,
        folderId: provider.folderId,
      },
    })),
    activeAuthProviderSeedScope(storeIdFromVault),
  )
  await waitForAuthProviderIds(
    page,
    extras.map((provider) => provider.id),
  )
}

export const AGE_ARMOR_MARKER = 'BEGIN AGE ENCRYPTED FILE'

export type RawAuthProvidersSnapshot = {
  providers: Array<{
    id: string
    type: string
    githubPat?: string
    oauthFile?: {
      accessToken?: string
      refreshToken?: string
    }
  }>
}

/** Read the raw `nook_auth` snapshot as persisted (sealed credential fields). */
export async function readRawAuthProvidersFromIdb(
  page: Page,
): Promise<RawAuthProvidersSnapshot> {
  return page.evaluate(() => {
    return new Promise<RawAuthProvidersSnapshot>((resolve, reject) => {
      const request = indexedDB.open('nook_auth', 1)
      request.onerror = () =>
        reject(request.error ?? new Error('idb open failed'))
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('auth', 'readonly')
        const store = tx.objectStore('auth')
        const getReq = store.get('providers')
        getReq.onerror = () =>
          reject(getReq.error ?? new Error('idb read failed'))
        getReq.onsuccess = () => {
          const rawSnapshot = getReq.result as unknown
          resolve(
            rawSnapshot && typeof rawSnapshot === 'object'
              ? (rawSnapshot as RawAuthProvidersSnapshot)
              : { providers: [] },
          )
        }
        tx.oncomplete = () => db.close()
        tx.onerror = () => reject(tx.error ?? new Error('idb tx failed'))
      }
    })
  })
}

export async function waitForAuthProvidersE2eHook(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            !!(window as Window & { __nookAuthProviders?: unknown })
              .__nookAuthProviders,
        ),
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe(true)
}

/** Load decrypted sync providers via wasm in the browser. */
export async function loadDecryptedAuthProvidersInBrowser(page: Page) {
  return page.evaluate(async () => {
    const hook = (
      window as Window & {
        __nookAuthProviders?: {
          loadAuthProviders: () => Promise<{
            providers: Array<{
              id?: string
              githubPat?: string
              oauthFile?: { accessToken?: string; refreshToken?: string }
            }>
          }>
        }
      }
    ).__nookAuthProviders
    if (hook?.loadAuthProviders) {
      return hook.loadAuthProviders()
    }
    throw new Error('E2E auth provider hooks are unavailable')
  })
}

/** Save sync providers through wasm (plaintext in → sealed in IndexedDB). */
export async function saveAuthProvidersInBrowser(
  page: Page,
  snapshot: { providers: SeededAuthProvider[] },
  seedScope: AuthProviderSeedScope,
) {
  await page.evaluate(
    async ({ snapshot, seedScope }) => {
      const hook = (
        window as Window & {
          __nookAuthProviders?: AuthProviderBrowserHooks
        }
      ).__nookAuthProviders
      if (!hook) throw new Error('E2E auth provider hooks are unavailable')
      const activeVaultStoreId =
        'storeId' in seedScope
          ? hook.activeVaultScope(seedScope.storeId)
          : hook.unselectedVaultScope()
      await hook.saveAuthProviders({ ...snapshot, activeVaultStoreId })
    },
    { snapshot, seedScope },
  )
}

export function expectSealedCredential(stored: unknown, plaintext: string) {
  expect(stored).toBeTypeOf('string')
  if (typeof stored !== 'string') {
    throw new Error('expected a persisted sealed credential')
  }
  expect(stored).toContain(AGE_ARMOR_MARKER)
  expect(stored).not.toContain(plaintext)
}

/** Default GitHub sync provider for local e2e onboarding / fan-out specs. */
export const E2E_GITHUB_ONBOARD_PROVIDER = {
  id: 'e2e-onboard-github',
  label: 'GitHub (e2e onboard)',
  githubRepo: 'nook-e2e-onboard',
  githubPat: 'ghp_test_token',
}

/** Default file-backed oauth-file sync provider for PR / IndexedDB-only e2e. */
export const E2E_OAUTH_ONBOARD_PROVIDER = {
  id: 'e2e-onboard-file',
  label: 'File (e2e onboard)',
  fileName: 'nook-e2e-onboard',
  accessToken: 'ya29.e2e_file_sync_token',
  accountEmail: 'file-sync-e2e@example.com',
}

/** Alias for local sync provider used in multi-device / fan-out e2e. */
export const E2E_SYNC_ONBOARD_PROVIDER = E2E_OAUTH_ONBOARD_PROVIDER

export type E2eOauthSyncProvider = {
  id: string
  label: string
  fileName: string
  accessToken: string
  accountEmail?: string
}
