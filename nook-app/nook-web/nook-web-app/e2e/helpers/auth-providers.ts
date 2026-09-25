import type { VaultState } from '$lib/vault.svelte'
import { err, ok, type Result } from 'neverthrow'
import type { VaultStorageFailure } from '$lib/runtime/storage-failure'
import { expect, type Page } from '@playwright/test'
import {
  type ActiveVaultScope,
  type AuthProvidersSnapshot,
  type GoogleDriveMode,
  type ICloudMode,
  type OAuthFileConfig,
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
    drivePrivateTarget?: OAuthFileConfig['drivePrivateTarget']
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

enum AuthProviderHookFailure {
  HookUnavailable = 'hook-unavailable',
  ReadFailed = 'read-failed',
  WriteFailed = 'write-failed',
}

export const AUTH_PROVIDER_HOOK_READ_FAILED = AuthProviderHookFailure.ReadFailed

type AuthProviderBrowserHooks = {
  activeVaultScope(storeId: string): ActiveVaultScope
  loadAuthProviders: () => Promise<
    Result<AuthProvidersSnapshot, VaultStorageFailure>
  >
  saveAuthProviders: (
    snapshot: AuthProvidersSnapshot,
  ) => Promise<Result<void, VaultStorageFailure>>
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
          ...(oauth.drivePrivateTarget
            ? { drivePrivateTarget: oauth.drivePrivateTarget }
            : {}),
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
          reject(((v) => (v ? v : new Error('idb open failed')))(request.error))
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('auth', 'readwrite')
          const store = tx.objectStore('auth')
          const getRequest = store.get('providers')
          getRequest.onerror = () =>
            reject(
              ((v) => (v ? v : new Error('idb read failed')))(getRequest.error),
            )
          getRequest.onsuccess = () => {
            const rawSnapshot: unknown = getRequest.result
            const snapshot: { providers: unknown[] } = { providers: [] }
            if (
              typeof rawSnapshot === 'object' &&
              Object(rawSnapshot) === rawSnapshot
            ) {
              const storedProviders: unknown = Object.getOwnPropertyDescriptor(
                rawSnapshot,
                'providers',
              )?.value
              if (Array.isArray(storedProviders)) {
                for (const storedProvider of storedProviders) {
                  const provider: unknown = storedProvider
                  snapshot.providers.push(provider)
                }
              }
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
              reject(
                ((v) => (v ? v : new Error('idb write failed')))(
                  putRequest.error,
                ),
              )
          }
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () =>
            reject(((v) => (v ? v : new Error('idb tx failed')))(tx.error))
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
  const stored = await page.evaluate(
    async ({ providers: additions, failures }) => {
      const hook = (
        window as Window & {
          __nookAuthProviders?: AuthProviderBrowserHooks
        }
      ).__nookAuthProviders
      if (!hook)
        return { ok: false as const, failure: failures.HookUnavailable }
      const snapshot = await hook.loadAuthProviders()
      if (snapshot.isErr())
        return { ok: false as const, failure: failures.ReadFailed }
      const persisted = await hook.saveAuthProviders({
        ...snapshot.value,
        providers: [...snapshot.value.providers, ...additions],
      })
      return persisted.isErr()
        ? { ok: false as const, failure: failures.WriteFailed }
        : { ok: true as const }
    },
    {
      providers: storedAdditions,
      failures: AuthProviderHookFailure,
    },
  )
  expect(stored).toEqual({ ok: true })
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
              ((v) => (v ? v : []))(
                snapshot.providers?.map((provider) => provider.id),
              ),
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
  drivePrivateTarget?: OAuthFileConfig['drivePrivateTarget']
}

async function seedOauthFileProviders(
  page: Page,
  extras: SeededOauthFileProviderInput[],
  seedScope: AuthProviderSeedScope,
) {
  const providers: SeededAuthProvider[] = extras.map((provider) => {
    const oauthFile: NonNullable<SeededAuthProvider['oauthFile']> = {
      preset: 'google-drive',
      accessToken: provider.accessToken,
      fileName: provider.fileName,
      driveMode: provider.folderId ? 'shared' : 'private',
      iCloudMode: 'private',
    }
    if (provider.accountEmail) oauthFile.accountEmail = provider.accountEmail
    if (provider.folderId) oauthFile.folderId = provider.folderId
    if (provider.drivePrivateTarget)
      oauthFile.drivePrivateTarget = provider.drivePrivateTarget
    return {
      id: provider.id,
      type: 'oauth-file',
      label: provider.label,
      oauthFile,
    }
  })
  await appendSealedAuthProviders(page, providers, seedScope)
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
  const storeId = storeIdMatch[1]
  if (!storeId) throw new Error('E2E OAuth provider store id is unavailable')
  await seedOauthFileProviders(
    page,
    extras,
    activeAuthProviderSeedScope(storeId),
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

export type RawCredentialRead =
  | { kind: 'absent' }
  | { kind: 'malformed' }
  | { kind: 'legacy-ciphertext'; ciphertext: string }
  | { kind: 'tagged-ciphertext'; state: string; ciphertext: string }
  | { kind: 'tagged-without-ciphertext'; state: string }

export type RawOAuthFileCredentials = {
  accessToken: RawCredentialRead
  refreshToken: RawCredentialRead
}

export type RawAuthProvidersSnapshot = {
  providers: Array<{
    id: string
    type: string
    githubPat: RawCredentialRead
    oauthFile: RawOAuthFileCredentials
  }>
}

async function activeAuthProviderStateKey(page: Page): Promise<string> {
  const key = await page.evaluate(() => {
    const vault = (
      window as Window & {
        __nookVault?: Pick<
          VaultState,
          'admitManager' | 'waitForStorageChain' | 'hasManager'
        >
      }
    ).__nookVault
    if (!vault) return { ok: true as const, value: 'providers' }
    return vault.waitForStorageChain().then(() => {
      if (!vault.hasManager) return { ok: true as const, value: 'providers' }
      const manager = vault.admitManager()
      if (manager.isErr())
        return { ok: false as const, error: manager.error.translationKey }
      try {
        const appId = manager.value.device_id
        return {
          ok: true as const,
          value: appId ? `providers:${appId}` : 'providers',
        }
      } catch {
        return {
          ok: false as const,
          error: 'Native device identity read failed',
        }
      }
    })
  })
  if (!key.ok) throw new Error(key.error)
  return key.value
}

/** Read the raw `nook_auth` snapshot as persisted (sealed credential fields). */
export async function readRawAuthProvidersFromIdb(
  page: Page,
): Promise<RawAuthProvidersSnapshot> {
  const stateKey = await activeAuthProviderStateKey(page)
  return page.evaluate((scopedStateKey) => {
    return new Promise<RawAuthProvidersSnapshot>((resolve, reject) => {
      const resolveEmptySnapshot = () => resolve({ providers: [] })
      const resolveSnapshot = (rawSnapshot: unknown) => {
        if (
          typeof rawSnapshot !== 'object' ||
          Object(rawSnapshot) !== rawSnapshot ||
          Array.isArray(rawSnapshot)
        ) {
          resolve({ providers: [] })
          return
        }
        const providersProperty = Object.getOwnPropertyDescriptor(
          rawSnapshot,
          'providers',
        )
        if (
          !providersProperty ||
          !('value' in providersProperty) ||
          !Array.isArray(providersProperty.value)
        ) {
          resolve({ providers: [] })
          return
        }
        const providersValue: unknown[] = providersProperty.value
        const providers: RawAuthProvidersSnapshot['providers'] = []
        const isRecord = (value: unknown): value is Record<string, unknown> =>
          typeof value === 'object' &&
          Object(value) === value &&
          !Array.isArray(value)
        const readCredential = (credential: unknown): RawCredentialRead => {
          if (typeof credential === 'string') {
            return { kind: 'legacy-ciphertext', ciphertext: credential }
          }
          if (!isRecord(credential)) return { kind: 'malformed' }
          const stateProperty = Object.getOwnPropertyDescriptor(
            credential,
            'state',
          )
          if (
            !stateProperty ||
            !('value' in stateProperty) ||
            typeof stateProperty.value !== 'string'
          ) {
            return { kind: 'malformed' }
          }
          const valueProperty = Object.getOwnPropertyDescriptor(
            credential,
            'value',
          )
          if (!valueProperty) {
            return {
              kind: 'tagged-without-ciphertext',
              state: stateProperty.value,
            }
          }
          if (
            !('value' in valueProperty) ||
            typeof valueProperty.value !== 'string'
          ) {
            return { kind: 'malformed' }
          }
          return {
            kind: 'tagged-ciphertext',
            state: stateProperty.value,
            ciphertext: valueProperty.value,
          }
        }
        const readCredentialProperty = (
          owner: object,
          property: string,
        ): RawCredentialRead => {
          const descriptor = Object.getOwnPropertyDescriptor(owner, property)
          if (!descriptor) return { kind: 'absent' }
          if (!('value' in descriptor)) return { kind: 'malformed' }
          return readCredential(descriptor.value)
        }
        for (const providerValue of providersValue) {
          if (!isRecord(providerValue)) continue
          const idProperty = Object.getOwnPropertyDescriptor(
            providerValue,
            'id',
          )
          const typeProperty = Object.getOwnPropertyDescriptor(
            providerValue,
            'type',
          )
          if (
            !idProperty ||
            !('value' in idProperty) ||
            typeof idProperty.value !== 'string' ||
            !typeProperty ||
            !('value' in typeProperty) ||
            typeof typeProperty.value !== 'string'
          ) {
            continue
          }
          const id = idProperty.value
          const type = typeProperty.value
          const oauthFileProperty = Object.getOwnPropertyDescriptor(
            providerValue,
            'oauthFile',
          )
          let oauthFileCredentials: RawOAuthFileCredentials
          if (!oauthFileProperty) {
            oauthFileCredentials = {
              accessToken: { kind: 'absent' },
              refreshToken: { kind: 'absent' },
            }
          } else if (
            !('value' in oauthFileProperty) ||
            !isRecord(oauthFileProperty.value)
          ) {
            oauthFileCredentials = {
              accessToken: { kind: 'malformed' },
              refreshToken: { kind: 'malformed' },
            }
          } else {
            const oauthFileValue = oauthFileProperty.value
            const configuredProperty = Object.getOwnPropertyDescriptor(
              oauthFileValue,
              'config',
            )
            let credentialSource = oauthFileValue
            if (
              configuredProperty &&
              'value' in configuredProperty &&
              isRecord(configuredProperty.value)
            ) {
              credentialSource = configuredProperty.value
            }
            oauthFileCredentials = {
              accessToken: readCredentialProperty(
                credentialSource,
                'accessToken',
              ),
              refreshToken: readCredentialProperty(
                credentialSource,
                'refreshToken',
              ),
            }
          }
          providers.push({
            id,
            type,
            githubPat: readCredentialProperty(providerValue, 'githubPat'),
            oauthFile: oauthFileCredentials,
          })
        }
        resolve({ providers })
      }
      const request = indexedDB.open('nook_auth', 1)
      request.onerror = () =>
        reject(((v) => (v ? v : new Error('idb open failed')))(request.error))
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('auth', 'readonly')
        const store = tx.objectStore('auth')
        const getReq = store.get(scopedStateKey)
        getReq.onerror = () =>
          reject(((v) => (v ? v : new Error('idb read failed')))(getReq.error))
        getReq.onsuccess = () => {
          if (getReq.result) {
            const rawSnapshot: unknown = getReq.result
            resolveSnapshot(rawSnapshot)
            return
          }
          if (scopedStateKey === 'providers') {
            resolveEmptySnapshot()
            return
          }
          const legacyReq = store.get('providers')
          legacyReq.onerror = () =>
            reject(
              ((v) => (v ? v : new Error('legacy idb read failed')))(
                legacyReq.error,
              ),
            )
          legacyReq.onsuccess = () => {
            if (legacyReq.result) {
              const rawSnapshot: unknown = legacyReq.result
              resolveSnapshot(rawSnapshot)
              return
            }
            resolveEmptySnapshot()
          }
        }
        tx.oncomplete = () => db.close()
        tx.onerror = () =>
          reject(((v) => (v ? v : new Error('idb tx failed')))(tx.error))
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

/** Owns the browser-side E2E hook for decrypted provider inspection. */
export class AuthProviderBrowserFixture {
  constructor(private readonly page: Page) {}

  async load(): Promise<
    Result<AuthProvidersSnapshot, AuthProviderHookFailure>
  > {
    const loaded = await this.page.evaluate(async (failures) => {
      const hook = (
        window as Window & { __nookAuthProviders?: AuthProviderBrowserHooks }
      ).__nookAuthProviders
      if (!hook)
        return { ok: false as const, failure: failures.HookUnavailable }
      const snapshot = await hook.loadAuthProviders()
      return snapshot.isErr()
        ? { ok: false as const, failure: failures.ReadFailed }
        : { ok: true as const, value: snapshot.value }
    }, AuthProviderHookFailure)
    return loaded.ok ? ok(loaded.value) : err(loaded.failure)
  }
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
  const activeStoreId =
    seedScope.kind === AuthProviderSeedScopeKind.ActiveVault
      ? seedScope.storeId
      : false
  const stored = await page.evaluate(
    async ({ providers, activeStoreId, failures }) => {
      const hook = (
        window as Window & {
          __nookAuthProviders?: AuthProviderBrowserHooks
        }
      ).__nookAuthProviders
      if (!hook)
        return { ok: false as const, failure: failures.HookUnavailable }
      let activeVaultStoreId: ActiveVaultScope
      if (typeof activeStoreId === 'string') {
        activeVaultStoreId = hook.activeVaultScope(activeStoreId)
      } else {
        activeVaultStoreId = hook.unselectedVaultScope()
      }
      const authProvidersSnapshot: AuthProvidersSnapshot = {
        providers,
        activeVaultStoreId,
      }
      const persisted = await hook.saveAuthProviders(authProvidersSnapshot)
      return persisted.isErr()
        ? { ok: false as const, failure: failures.WriteFailed }
        : { ok: true as const }
    },
    {
      providers,
      activeStoreId,
      failures: AuthProviderHookFailure,
    },
  )
  expect(stored).toEqual({ ok: true })
}

export function expectSealedCredential(
  stored: unknown,
  plaintext: string,
  expectedState: string,
) {
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' &&
    Object(value) === value &&
    !Array.isArray(value)
  const isCredentialRead = (value: unknown): value is RawCredentialRead => {
    if (!isRecord(value)) return false
    switch (Reflect.get(value, 'kind')) {
      case 'absent':
      case 'malformed':
        return true
      case 'legacy-ciphertext':
        return typeof Reflect.get(value, 'ciphertext') === 'string'
      case 'tagged-ciphertext':
        return (
          typeof Reflect.get(value, 'state') === 'string' &&
          typeof Reflect.get(value, 'ciphertext') === 'string'
        )
      case 'tagged-without-ciphertext':
        return typeof Reflect.get(value, 'state') === 'string'
      default:
        return false
    }
  }
  expect(isCredentialRead(stored)).toBe(true)
  if (!isCredentialRead(stored)) {
    throw new Error('expected a persisted credential read')
  }
  let ciphertext: string
  switch (stored.kind) {
    case 'tagged-ciphertext':
      expect(stored.state).toBe(expectedState)
      ciphertext = stored.ciphertext
      break
    case 'absent':
    case 'malformed':
    case 'legacy-ciphertext':
    case 'tagged-without-ciphertext':
      throw new Error('expected a tagged sealed credential')
  }
  expect(typeof ciphertext).toBe('string')
  expect(ciphertext).toContain(AGE_ARMOR_MARKER)
  expect(ciphertext).not.toContain(plaintext)
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
  drivePrivateTarget?: OAuthFileConfig['drivePrivateTarget']
}
