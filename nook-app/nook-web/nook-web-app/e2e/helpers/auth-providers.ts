import { expect, type Page } from '@playwright/test'
import {
  type ActiveVaultScope,
  type AuthProvidersSnapshot,
  type GoogleDriveMode,
  type ICloudMode,
  type OAuthFilePreset,
  type StorageProvider,
} from '$app-wasm'
import { readLocalVaultYamlFromIdb } from './local-sync'
import { ENROLLMENT_UNLOCK_TIMEOUT_MS, UI_TIMEOUT_MS } from './environment'

export type SeededAuthProvider = {
  id: string
  type: StorageProvider['type']
  label: string
  githubRepo?: string
  githubPat?: string
  oauthFile?: {
    preset: OAuthFilePreset
    accessToken: string
    refreshToken?: string
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
  loadAuthProviders: () => Promise<AuthProvidersSnapshot>
  saveAuthProviders: (snapshot: AuthProvidersSnapshot) => Promise<void>
  unselectedVaultScope(): ActiveVaultScope
}

function providerVaultScope(
  provider: SeededAuthProvider,
  seedScope: AuthProviderSeedScope,
): StorageProvider['storeId'] {
  if ('storeId' in provider && typeof provider.storeId === 'string') {
    return { state: 'storeId', value: provider.storeId }
  }
  return seedScope.kind === AuthProviderSeedScopeKind.ActiveVault
    ? { state: 'storeId', value: seedScope.storeId }
    : { state: 'unscoped' }
}

function storedProvider(
  provider: SeededAuthProvider,
  seedScope: AuthProviderSeedScope,
): StorageProvider {
  const createdAt =
    'createdAt' in provider && typeof provider.createdAt === 'string'
      ? provider.createdAt
      : new Date().toISOString()
  const common = {
    id: provider.id,
    type: provider.type,
    label: provider.label,
    githubPat: { state: 'missing' } as const,
    githubRepo: { state: 'defaultRepository' } as const,
    oauthFile: { state: 'notApplicable' } as const,
    localFolder: { state: 'notApplicable' } as const,
    storeId: providerVaultScope(provider, seedScope),
    syncCheckpoint: { state: 'neverSynced' } as const,
    createdAt,
  }
  if (provider.type === 'github') {
    return {
      ...common,
      type: 'github',
      githubPat:
        'githubPat' in provider && typeof provider.githubPat === 'string'
          ? { state: 'token', value: provider.githubPat }
          : { state: 'missing' },
      githubRepo:
        'githubRepo' in provider && typeof provider.githubRepo === 'string'
          ? { state: 'repository', value: provider.githubRepo }
          : { state: 'defaultRepository' },
    }
  }
  if (provider.type === 'oauth-file' && provider.oauthFile) {
    const oauth = provider.oauthFile
    return {
      ...common,
      type: 'oauth-file',
      oauthFile: {
        state: 'configured',
        config: {
          preset: oauth.preset,
          accessToken: { state: 'accessToken', value: oauth.accessToken },
          refreshToken:
            'refreshToken' in oauth && typeof oauth.refreshToken === 'string'
              ? { state: 'token', value: oauth.refreshToken }
              : { state: 'notIssued' },
          expiresAt: { state: 'unknown' },
          fileId: { state: 'unresolved' },
          fileName: { state: 'fileName', value: oauth.fileName },
          accountEmail:
            'accountEmail' in oauth && typeof oauth.accountEmail === 'string'
              ? { state: 'email', value: oauth.accountEmail }
              : { state: 'unknown' },
          driveMode: oauth.driveMode,
          folderId:
            'folderId' in oauth && typeof oauth.folderId === 'string'
              ? { state: 'folderId', value: oauth.folderId }
              : { state: 'root' },
          iCloudMode: oauth.iCloudMode,
          iCloudShareTarget: { state: 'personal' },
        },
      },
    }
  }
  return common
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
  const storedAdditions = providers.map((provider) =>
    storedProvider(provider, seedScope),
  )
  await page.evaluate(
    async ({ providers: additions }) => {
      const hook = (
        window as Window & {
          __nookAuthProviders?: AuthProviderBrowserHooks
        }
      ).__nookAuthProviders
      if (!hook) throw new Error('E2E auth provider hooks are unavailable')
      const snapshot = await hook.loadAuthProviders()
      snapshot.providers.push(...additions)
      await hook.saveAuthProviders(snapshot)
    },
    {
      providers: storedAdditions,
    },
  )
}

export async function waitForAuthProviderIds(
  page: Page,
  expectedIds: string[],
): Promise<void> {
  const stateKey = await activeAuthProviderStateKey(page)
  type AuthProviderIdsWait = {
    readonly ids: string[]
    readonly scopedStateKey: string
  }
  const authProviderIdsWait: AuthProviderIdsWait = {
    ids: expectedIds,
    scopedStateKey: stateKey,
  }
  await page.waitForFunction(
    ({ ids, scopedStateKey }: AuthProviderIdsWait) =>
      new Promise<boolean>((resolve) => {
        const request = indexedDB.open('nook_auth', 1)
        request.onerror = () => resolve(false)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('auth', 'readonly')
          const getRequest = tx.objectStore('auth').get(scopedStateKey)
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
    authProviderIdsWait,
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

type SeededOauthFileProviderInput = {
  id: string
  label: string
  fileName: string
  accessToken: string
  accountEmail?: string
  folderId?: string
}

async function seedOauthFileProviders(
  page: Page,
  extras: SeededOauthFileProviderInput[],
  seedScope: AuthProviderSeedScope,
) {
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
    seedScope,
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
  extras: SeededOauthFileProviderInput[],
) {
  const vaultYaml = await readLocalVaultYamlFromIdb(page).catch(() => '')
  const storeIdMatch = vaultYaml.match(/^store_id:\s*(\S+)/m)
  if (!storeIdMatch) {
    throw new Error('E2E OAuth provider seeding requires an active vault')
  }
  await seedOauthFileProviders(
    page,
    extras,
    activeAuthProviderSeedScope(storeIdMatch[1]),
  )
}

/**
 * Add oauth-file providers before an enrollment link selects the target vault.
 */
export async function seedUnscopedOauthFileProvidersForEnrollment(
  page: Page,
  extras: SeededOauthFileProviderInput[],
) {
  await seedOauthFileProviders(page, extras, unselectedAuthProviderSeedScope())
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

async function activeAuthProviderStateKey(page: Page): Promise<string> {
  return page.evaluate(() => {
    const vault = (
      window as Window & {
        __nookVault?: {
          readonly hasManager: boolean
          requireManager(): { readonly device_id: string }
        }
      }
    ).__nookVault
    if (!vault?.hasManager) return 'providers'
    const appId = vault.requireManager().device_id
    return appId ? `providers:${appId}` : 'providers'
  })
}

/** Read the raw `nook_auth` snapshot as persisted (sealed credential fields). */
export async function readRawAuthProvidersFromIdb(
  page: Page,
): Promise<RawAuthProvidersSnapshot> {
  const stateKey = await activeAuthProviderStateKey(page)
  return page.evaluate((scopedStateKey) => {
    return new Promise<RawAuthProvidersSnapshot>((resolve, reject) => {
      const resolveSnapshot = (
        rawSnapshot: RawAuthProvidersSnapshot | undefined,
      ) => {
        resolve(rawSnapshot ?? { providers: [] })
      }
      const request = indexedDB.open('nook_auth', 1)
      request.onerror = () =>
        reject(request.error ?? new Error('idb open failed'))
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('auth', 'readonly')
        const store = tx.objectStore('auth')
        const getReq = store.get(scopedStateKey)
        getReq.onerror = () =>
          reject(getReq.error ?? new Error('idb read failed'))
        getReq.onsuccess = () => {
          const rawSnapshot = getReq.result as
            RawAuthProvidersSnapshot | undefined
          if (rawSnapshot || scopedStateKey === 'providers') {
            resolveSnapshot(rawSnapshot)
            return
          }
          const legacyReq = store.get('providers')
          legacyReq.onerror = () =>
            reject(legacyReq.error ?? new Error('legacy idb read failed'))
          legacyReq.onsuccess = () =>
            resolveSnapshot(
              legacyReq.result as RawAuthProvidersSnapshot | undefined,
            )
        }
        tx.oncomplete = () => db.close()
        tx.onerror = () => reject(tx.error ?? new Error('idb tx failed'))
      }
    })
  }, stateKey)
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
        __nookAuthProviders?: AuthProviderBrowserHooks
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
  const providers = snapshot.providers.map((provider) =>
    storedProvider(provider, seedScope),
  )
  await page.evaluate(
    async ({ providers, seedScope, activeVaultKind }) => {
      const hook = (
        window as Window & {
          __nookAuthProviders?: AuthProviderBrowserHooks
        }
      ).__nookAuthProviders
      if (!hook) throw new Error('E2E auth provider hooks are unavailable')
      const activeVaultStoreId =
        seedScope.kind === activeVaultKind
          ? hook.activeVaultScope(seedScope.storeId)
          : hook.unselectedVaultScope()
      const authProvidersSnapshot: AuthProvidersSnapshot = {
        providers,
        activeVaultStoreId,
      }
      await hook.saveAuthProviders(authProvidersSnapshot)
    },
    {
      providers,
      seedScope,
      activeVaultKind: AuthProviderSeedScopeKind.ActiveVault,
    },
  )
}

export function expectSealedCredential(stored: unknown, plaintext: string) {
  expect(typeof stored).toBe('string')
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
