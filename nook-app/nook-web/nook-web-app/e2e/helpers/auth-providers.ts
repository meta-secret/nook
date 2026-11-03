import type { VaultState } from '$lib/vault.svelte'
import { err, ok, type Result } from 'neverthrow'
import type { VaultStorageFailure } from '$lib/runtime/storage-failure'
import { expect, type Page } from '@playwright/test'
import {
  type ActiveVaultScope,
  type AuthProvidersSnapshot,
  type OAuthAccountIdentity,
  type ProviderVaultScope,
  type StorageProvider,
} from '$app-wasm'
import { E2E_GOOGLE_ACCOUNT_EMAIL } from '../google-identity-stub'
import { readLocalVaultYamlFromIdb, storeIdOfVaultYaml } from './local-sync'
import { ENROLLMENT_UNLOCK_TIMEOUT_MS, UI_TIMEOUT_MS } from './environment'

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

export enum SeededProviderKind {
  Github = 'github',
  GoogleDrive = 'google-drive',
  ICloud = 'icloud',
}

type SeededProviderCommon = {
  id: string
  label: string
  scope: AuthProviderSeedScope
}

/** One saved provider row to seed, with the fields of its own variant. */
export type SeededProvider =
  | (SeededProviderCommon & {
      kind: SeededProviderKind.Github
      repository: string
      token: string
    })
  | (SeededProviderCommon & {
      kind: SeededProviderKind.GoogleDrive
      /** Names the e2e Drive stub's vault; the row syncs under its folder. */
      fileName: string
      accessToken: string
      account: OAuthAccountIdentity
    })
  | (SeededProviderCommon & {
      kind: SeededProviderKind.ICloud
      webAuthToken: string
      account: OAuthAccountIdentity
      /** A CloudKit share (`icloud-share-v1:{…}`). */
      shareTarget: string
    })

/** The signed-in account the e2e Google stub reports. */
export const E2E_GOOGLE_ACCOUNT: OAuthAccountIdentity = {
  state: 'email',
  email: E2E_GOOGLE_ACCOUNT_EMAIL,
}

export const E2E_UNKNOWN_ACCOUNT: OAuthAccountIdentity = { state: 'unknown' }

export function e2eAccount(email: string): OAuthAccountIdentity {
  return { state: 'email', email }
}

/** The vault folder id a seeded Drive provider syncs under. The e2e Drive
 * stubs register a seeded folder on first use. */
export function e2eDriveFolderId(fileName: string): string {
  return `e2e-folder-${fileName.replace(/[^A-Za-z0-9_-]/g, '-')}`
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

function providerVaultScope(scope: AuthProviderSeedScope): ProviderVaultScope {
  switch (scope.kind) {
    case AuthProviderSeedScopeKind.ActiveVault:
      return { state: 'storeId', value: scope.storeId }
    case AuthProviderSeedScopeKind.Unselected:
      return { state: 'unscoped' }
  }
}

function storedProvider(provider: SeededProvider): StorageProvider {
  const common = {
    id: provider.id,
    label: provider.label,
    storeId: providerVaultScope(provider.scope),
    syncCheckpoint: { state: 'neverSynced' } as const,
    createdAt: new Date().toISOString(),
  }
  switch (provider.kind) {
    case SeededProviderKind.Github:
      return {
        ...common,
        provider: {
          type: 'github',
          repository: { state: 'repository', value: provider.repository },
          token: provider.token,
        },
      }
    case SeededProviderKind.GoogleDrive:
      return {
        ...common,
        provider: {
          type: 'oauth-file',
          preset: 'google-drive',
          authorization: {
            accessToken: provider.accessToken,
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          },
          account: provider.account,
          folderId: e2eDriveFolderId(provider.fileName),
        },
      }
    case SeededProviderKind.ICloud:
      return {
        ...common,
        provider: {
          type: 'oauth-file',
          preset: 'icloud',
          webAuthToken: provider.webAuthToken,
          account: provider.account,
          shareTarget: provider.shareTarget,
        },
      }
  }
}

/** Put a plaintext GitHub token into one stored provider row, in place of
 * its sealed credential, to observe that loading rejects it. */
export async function storePlaintextGithubToken(
  page: Page,
  providerId: string,
  token: string,
): Promise<void> {
  const stateKey = await activeAuthProviderStateKey(page)
  await page.evaluate(
    ({ stateKey: key, providerId: id, token: plaintext }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('nook_auth', 1)
        request.onerror = () =>
          reject(((v) => (v ? v : new Error('idb open failed')))(request.error))
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('auth', 'readwrite')
          const store = tx.objectStore('auth')
          const getRequest = store.get(key)
          getRequest.onsuccess = () => {
            const snapshot: unknown = getRequest.result
            const providers: unknown =
              typeof snapshot === 'object' && Object(snapshot) === snapshot
                ? Object.getOwnPropertyDescriptor(snapshot, 'providers')?.value
                : []
            const row: unknown = Array.isArray(providers)
              ? providers.find(
                  (candidate: unknown) =>
                    typeof candidate === 'object' &&
                    Object(candidate) === candidate &&
                    Object.getOwnPropertyDescriptor(candidate, 'id')?.value ===
                      id,
                )
              : {}
            const provider: unknown =
              row instanceof Object
                ? Object.getOwnPropertyDescriptor(row, 'provider')?.value
                : {}
            if (!(provider instanceof Object)) {
              reject(new Error(`provider ${id} is not stored`))
              return
            }
            Object.assign(provider, { token: plaintext })
            store.put(snapshot, key)
          }
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () =>
            reject(((v) => (v ? v : new Error('idb tx failed')))(tx.error))
        }
      }),
    { stateKey, providerId, token },
  )
}

async function appendSealedAuthProviders(
  page: Page,
  providers: SeededProvider[],
): Promise<void> {
  const storedAdditions = providers.map(storedProvider)
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

/** One GitHub provider to seed. */
export type SeededGithubProviderInput = {
  id: string
  label: string
  repository: string
  token: string
}

/**
 * Add extra GitHub providers to the saved auth snapshot for onboarding UI tests.
 */
export async function seedExtraGithubProviders(
  page: Page,
  extras: SeededGithubProviderInput[],
) {
  await appendSealedAuthProviders(
    page,
    extras.map((provider) => ({
      kind: SeededProviderKind.Github,
      scope: unselectedAuthProviderSeedScope(),
      ...provider,
    })),
  )
  await waitForAuthProviderIds(
    page,
    extras.map((provider) => provider.id),
  )
}

/** One Google Drive provider to seed; `fileName` names the stub's vault. */
export type SeededDriveProviderInput = {
  id: string
  label: string
  fileName: string
  accessToken: string
  account: OAuthAccountIdentity
}

async function seedOauthFileProviders(
  page: Page,
  extras: SeededDriveProviderInput[],
  scope: AuthProviderSeedScope,
) {
  await appendSealedAuthProviders(
    page,
    extras.map((provider) => ({
      kind: SeededProviderKind.GoogleDrive,
      scope,
      ...provider,
    })),
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
  extras: SeededDriveProviderInput[],
) {
  await seedOauthFileProviders(page, extras, await activeVaultSeedScope(page))
}

async function activeVaultSeedScope(page: Page) {
  return activeAuthProviderSeedScope(
    storeIdOfVaultYaml(await readLocalVaultYamlFromIdb(page)),
  )
}

/** One iCloud provider bound to a CloudKit share (`icloud-share-v1:{…}`). */
export type SeededICloudProviderInput = {
  id: string
  label: string
  webAuthToken: string
  shareTarget: string
}

/** Add iCloud providers, each bound to its CloudKit share, to the active
 * vault's saved auth snapshot. */
export async function seedExtraICloudProviders(
  page: Page,
  extras: SeededICloudProviderInput[],
) {
  const scope = await activeVaultSeedScope(page)
  await appendSealedAuthProviders(
    page,
    extras.map((provider) => ({
      kind: SeededProviderKind.ICloud,
      scope,
      account: E2E_UNKNOWN_ACCOUNT,
      ...provider,
    })),
  )
  await waitForAuthProviderIds(
    page,
    extras.map((provider) => provider.id),
  )
}

/**
 * Add oauth-file providers before an enrollment link selects the target vault.
 */
export async function seedUnscopedOauthFileProvidersForEnrollment(
  page: Page,
  extras: SeededDriveProviderInput[],
) {
  await seedOauthFileProviders(page, extras, unselectedAuthProviderSeedScope())
}

export const AGE_ARMOR_MARKER = 'BEGIN AGE ENCRYPTED FILE'

/** The keys that hold a secret in a stored provider row: GitHub `token`,
 * Drive `authorization.accessToken`, iCloud `webAuthToken` and S3
 * `secretAccessKey`. */
export const PROVIDER_CREDENTIAL_KEYS = [
  'token',
  'accessToken',
  'webAuthToken',
  'secretAccessKey',
] as const

export enum RawCredentialKind {
  Absent = 'absent',
  Text = 'text',
}

/** A credential as persisted: the text found at its path, sealed or not. */
export type RawCredential =
  | { kind: RawCredentialKind.Absent }
  | { kind: RawCredentialKind.Text; text: string }

export enum RawStoredProviderKind {
  Local = 'local',
  LocalFolder = 'local-folder',
  Github = 'github',
  GoogleDrive = 'google-drive',
  ICloud = 'icloud',
  S3 = 's3',
  Unrecognized = 'unrecognized',
}

/** One stored provider's credential, read at the path its variant owns. */
export type RawStoredProvider =
  | { kind: RawStoredProviderKind.Local }
  | { kind: RawStoredProviderKind.LocalFolder }
  | { kind: RawStoredProviderKind.Github; token: RawCredential }
  | { kind: RawStoredProviderKind.GoogleDrive; accessToken: RawCredential }
  | { kind: RawStoredProviderKind.ICloud; webAuthToken: RawCredential }
  | { kind: RawStoredProviderKind.S3; secretAccessKey: RawCredential }
  | { kind: RawStoredProviderKind.Unrecognized }

export type RawAuthProvidersSnapshot = {
  providers: Array<{ id: string; provider: RawStoredProvider }>
}

enum OwnValueKind {
  Missing = 'missing',
  Value = 'value',
}

type OwnValue =
  { kind: OwnValueKind.Missing } | { kind: OwnValueKind.Value; value: unknown }

function ownValue(owner: unknown, property: string): OwnValue {
  if (typeof owner !== 'object' || !owner || Array.isArray(owner)) {
    return { kind: OwnValueKind.Missing }
  }
  const descriptor = Object.getOwnPropertyDescriptor(owner, property)
  return descriptor && 'value' in descriptor
    ? { kind: OwnValueKind.Value, value: descriptor.value }
    : { kind: OwnValueKind.Missing }
}

function ownText(owner: unknown, property: string): string {
  const read = ownValue(owner, property)
  if (read.kind === OwnValueKind.Value && typeof read.value === 'string') {
    return read.value
  }
  throw new Error(`stored provider has no text at ${property}`)
}

function rawCredential(owner: unknown, property: string): RawCredential {
  const read = ownValue(owner, property)
  return read.kind === OwnValueKind.Value && typeof read.value === 'string'
    ? { kind: RawCredentialKind.Text, text: read.value }
    : { kind: RawCredentialKind.Absent }
}

function rawNested(owner: unknown, property: string): unknown {
  const read = ownValue(owner, property)
  return read.kind === OwnValueKind.Value ? read.value : {}
}

function rawStoredProvider(provider: unknown): RawStoredProvider {
  switch (ownText(provider, 'type')) {
    case 'local':
      return { kind: RawStoredProviderKind.Local }
    case 'local-folder':
      return { kind: RawStoredProviderKind.LocalFolder }
    case 'github':
      return {
        kind: RawStoredProviderKind.Github,
        token: rawCredential(provider, 'token'),
      }
    case 'oauth-file':
      switch (ownText(provider, 'preset')) {
        case 'google-drive':
          return {
            kind: RawStoredProviderKind.GoogleDrive,
            accessToken: rawCredential(
              rawNested(provider, 'authorization'),
              'accessToken',
            ),
          }
        case 'icloud':
          return {
            kind: RawStoredProviderKind.ICloud,
            webAuthToken: rawCredential(provider, 'webAuthToken'),
          }
        default:
          return { kind: RawStoredProviderKind.Unrecognized }
      }
    case 's3':
      return {
        kind: RawStoredProviderKind.S3,
        secretAccessKey: rawCredential(provider, 'secretAccessKey'),
      }
    default:
      return { kind: RawStoredProviderKind.Unrecognized }
  }
}

function rawAuthProvidersSnapshot(snapshot: unknown): RawAuthProvidersSnapshot {
  const rows = ownValue(snapshot, 'providers')
  if (rows.kind === OwnValueKind.Missing || !Array.isArray(rows.value)) {
    return { providers: [] }
  }
  const providers: unknown[] = rows.value
  return {
    providers: providers.map((row) => ({
      id: ownText(row, 'id'),
      provider: rawStoredProvider(rawNested(row, 'provider')),
    })),
  }
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
/** Read the raw `nook_auth` snapshot as persisted (sealed credential fields). */
export async function readRawAuthProvidersFromIdb(
  page: Page,
): Promise<RawAuthProvidersSnapshot> {
  const stateKey = await activeAuthProviderStateKey(page)
  const snapshot: unknown = await page.evaluate(
    (scopedStateKey) =>
      new Promise<unknown>((resolve, reject) => {
        const request = indexedDB.open('nook_auth', 1)
        request.onerror = () =>
          reject(((v) => (v ? v : new Error('idb open failed')))(request.error))
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('auth', 'readonly')
          const getReq = tx.objectStore('auth').get(scopedStateKey)
          getReq.onerror = () =>
            reject(
              ((v) => (v ? v : new Error('idb read failed')))(getReq.error),
            )
          getReq.onsuccess = () => resolve(getReq.result)
          tx.oncomplete = () => db.close()
          tx.onerror = () =>
            reject(((v) => (v ? v : new Error('idb tx failed')))(tx.error))
        }
      }),
    stateKey,
  )
  return rawAuthProvidersSnapshot(snapshot)
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
  snapshot: { providers: SeededProvider[] },
  seedScope: AuthProviderSeedScope,
) {
  const providers = snapshot.providers.map(storedProvider)
  const stored = await page.evaluate(
    async ({ providers, seedScope, scopeKinds, failures }) => {
      const hook = (
        window as Window & {
          __nookAuthProviders?: AuthProviderBrowserHooks
        }
      ).__nookAuthProviders
      if (!hook)
        return { ok: false as const, failure: failures.HookUnavailable }
      const activeVaultStoreId: ActiveVaultScope =
        seedScope.kind === scopeKinds.ActiveVault
          ? hook.activeVaultScope(seedScope.storeId)
          : hook.unselectedVaultScope()
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
      seedScope,
      scopeKinds: AuthProviderSeedScopeKind,
      failures: AuthProviderHookFailure,
    },
  )
  expect(stored).toEqual({ ok: true })
}

/** Assert a persisted credential is age armor that does not contain `plaintext`. */
export function expectSealedCredential(
  stored: RawCredential,
  plaintext: string,
) {
  expect(stored.kind).toBe(RawCredentialKind.Text)
  if (stored.kind === RawCredentialKind.Absent) {
    throw new Error('expected a persisted sealed credential')
  }
  expect(stored.text).toContain(AGE_ARMOR_MARKER)
  expect(stored.text).not.toContain(plaintext)
}

/** Default GitHub sync provider for local e2e onboarding / fan-out specs. */
export const E2E_GITHUB_ONBOARD_PROVIDER: SeededGithubProviderInput = {
  id: 'e2e-onboard-github',
  label: 'GitHub (e2e onboard)',
  repository: 'nook-e2e-onboard',
  token: 'ghp_test_token',
}

/** Default file-backed oauth-file sync provider for PR / IndexedDB-only e2e. */
export const E2E_OAUTH_ONBOARD_PROVIDER: SeededDriveProviderInput = {
  id: 'e2e-onboard-file',
  label: 'File (e2e onboard)',
  fileName: 'nook-e2e-onboard',
  accessToken: 'ya29.e2e_file_sync_token',
  account: E2E_GOOGLE_ACCOUNT,
}

/** Alias for local sync provider used in multi-device / fan-out e2e. */
export const E2E_SYNC_ONBOARD_PROVIDER = E2E_OAUTH_ONBOARD_PROVIDER

function rawProviderById(
  snapshot: RawAuthProvidersSnapshot,
  id: string,
): RawStoredProvider {
  const row = snapshot.providers.find((candidate) => candidate.id === id)
  if (!row) throw new Error(`provider ${id} is not stored`)
  return row.provider
}

/** The persisted `provider.token` of one stored GitHub row. */
export function rawGithubToken(
  snapshot: RawAuthProvidersSnapshot,
  id: string,
): RawCredential {
  const provider = rawProviderById(snapshot, id)
  if (provider.kind !== RawStoredProviderKind.Github) {
    throw new Error(`provider ${id} is not a GitHub row`)
  }
  return provider.token
}

/** The persisted `provider.authorization.accessToken` of one stored Drive row. */
export function rawDriveAccessToken(
  snapshot: RawAuthProvidersSnapshot,
  id: string,
): RawCredential {
  const provider = rawProviderById(snapshot, id)
  if (provider.kind !== RawStoredProviderKind.GoogleDrive) {
    throw new Error(`provider ${id} is not a Google Drive row`)
  }
  return provider.accessToken
}
