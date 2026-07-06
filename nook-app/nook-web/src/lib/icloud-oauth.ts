/**
 * CloudKit JS web auth for iCloud private-database vault storage.
 *
 * Browser-only — no server, no client secret. After sign-in, the web auth
 * token is passed to wasm for CloudKit REST calls.
 */

import type { OAuthFileConfig } from '$lib/auth-providers'
import {
  ICLOUD_API_TOKEN,
  ICLOUD_CONTAINER_ID,
  ICLOUD_ENVIRONMENT,
} from '$lib/icloud-oauth-config'

const CLOUDKIT_SCRIPT_URL = 'https://cdn.apple-cloudkit.com/ck/2/cloudkit.js'
const CLOUDKIT_SIGN_IN_BUTTON_ID = 'apple-sign-in-button'
const CLOUDKIT_SIGN_OUT_BUTTON_ID = 'apple-sign-out-button'
export const ICLOUD_SIGN_IN_TIMEOUT_MS = 60_000

export type ICloudOAuthTokens = {
  accessToken: string
  accountName?: string
}

type ICloudWebAuthTokenRequestOptions = {
  signInTimeoutMs?: number
}

type CloudKitUserIdentity = {
  nameComponents?: { givenName?: string; familyName?: string }
  lookupInfo?: { emailAddress?: string }
}

type CloudKitAuthError = {
  _reason?: string
  message?: string
}

type CloudKitContainer = {
  setUpAuth: (options?: {
    grabAuthToken?: boolean
    persist?: boolean
  }) => Promise<CloudKitUserIdentity | undefined>
  whenUserSignsIn: () => Promise<CloudKitUserIdentity>
}

type CloudKitAuthTokenStore = {
  putToken: (containerIdentifier: string, authToken: unknown) => void
  getToken: (containerIdentifier: string) => unknown
}

type CloudKitGlobal = {
  configure: (config: {
    containers: Array<{
      containerIdentifier: string
      environment: 'development' | 'production'
      apiTokenAuth: {
        apiToken: string
        persist: boolean
        signInButton: { id: string }
        signOutButton: { id: string }
      }
    }>
    services?: {
      authTokenStore?: CloudKitAuthTokenStore
    }
  }) => void
  getDefaultContainer: () => CloudKitContainer
}

const ICLOUD_AUTH_TOKEN_STORAGE_PREFIX = 'nook.icloud.webAuthToken.'

const webAuthTokenListeners = new Set<(token: string) => void>()

function storeCloudKitWebAuthToken(
  containerIdentifier: string,
  authToken: unknown,
): string | undefined {
  const key = `${ICLOUD_AUTH_TOKEN_STORAGE_PREFIX}${containerIdentifier}`
  if (authToken == undefined) {
    sessionStorage.removeItem(key)
    return undefined
  }
  sessionStorage.setItem(key, JSON.stringify(authToken))
  const token = normalizeWebAuthToken(authToken)
  if (containerIdentifier === ICLOUD_CONTAINER_ID && token) {
    for (const listener of webAuthTokenListeners) {
      listener(token)
    }
  }
  return token
}

const cloudKitAuthTokenStore: CloudKitAuthTokenStore = {
  putToken(containerIdentifier, authToken) {
    storeCloudKitWebAuthToken(containerIdentifier, authToken)
  },
  getToken(containerIdentifier) {
    const raw = sessionStorage.getItem(
      `${ICLOUD_AUTH_TOKEN_STORAGE_PREFIX}${containerIdentifier}`,
    )
    if (!raw) {
      return undefined
    }
    try {
      return JSON.parse(raw) as unknown
    } catch {
      return undefined
    }
  },
}

declare global {
  interface Window {
    CloudKit?: CloudKitGlobal
  }
}

let initPromise: Promise<void> | undefined = undefined
let authSetupPromise: Promise<CloudKitUserIdentity | undefined> | undefined =
  undefined
let authSetupUserIdentity: CloudKitUserIdentity | undefined = undefined

/** @internal Clears module singletons between unit tests. */
export function resetICloudAuthStateForTests(): void {
  initPromise = undefined
  authSetupPromise = undefined
  authSetupUserIdentity = undefined
  webAuthTokenListeners.clear()
}

export function isICloudOAuthConfigured(): boolean {
  return Boolean(
    ICLOUD_CONTAINER_ID.trim() &&
    ICLOUD_API_TOKEN.trim() &&
    ICLOUD_CONTAINER_ID.startsWith('iCloud.'),
  )
}

function loadCloudKitScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.CloudKit) {
      resolve()
      return
    }
    const existing = document.querySelector(
      `script[src="${CLOUDKIT_SCRIPT_URL}"]`,
    )
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener(
        'error',
        () => reject(new Error('Failed to load CloudKit JS.')),
        { once: true },
      )
      return
    }
    const script = document.createElement('script')
    script.src = CLOUDKIT_SCRIPT_URL
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load CloudKit JS.'))
    document.head.appendChild(script)
  })
}

function readWebAuthTokenFromCookie(): string | undefined {
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim()
    if (!trimmed.startsWith('ckWebAuthToken')) {
      continue
    }
    const eq = trimmed.indexOf('=')
    if (eq === -1) {
      continue
    }
    const value = trimmed.slice(eq + 1)
    if (value) {
      return decodeURIComponent(value)
    }
  }
  return undefined
}

function normalizeWebAuthToken(stored: unknown): string | undefined {
  if (typeof stored === 'string' && stored.trim()) {
    return stored.trim()
  }
  if (stored != undefined && typeof stored === 'object') {
    const record = stored as Record<string, unknown>
    for (const key of ['token', 'ckWebAuthToken', 'value']) {
      const candidate = record[key]
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim()
      }
    }
  }
  return undefined
}

function readStoredWebAuthToken(): string | undefined {
  const fromCookie = readWebAuthTokenFromCookie()
  if (fromCookie) {
    return fromCookie
  }
  return normalizeWebAuthToken(
    cloudKitAuthTokenStore.getToken(ICLOUD_CONTAINER_ID),
  )
}

function waitForStoredWebAuthToken(
  timeoutMs = ICLOUD_SIGN_IN_TIMEOUT_MS,
): Promise<string> {
  const existing = readStoredWebAuthToken()
  if (existing) {
    return Promise.resolve(existing)
  }

  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined = undefined
    const listener = (token: string) => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
      webAuthTokenListeners.delete(listener)
      resolve(token)
    }
    webAuthTokenListeners.add(listener)
    timeoutId = setTimeout(() => {
      webAuthTokenListeners.delete(listener)
      reject(cloudKitSignInTimeoutError())
    }, timeoutMs)
  })
}

function cloudKitAuthErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (error != undefined && typeof error === 'object') {
    const authError = error as CloudKitAuthError
    if (authError._reason?.trim()) {
      return authError._reason.trim()
    }
    if (authError.message?.trim()) {
      return authError.message.trim()
    }
  }
  return 'iCloud sign-in failed.'
}

function cloudKitSignInTimeoutError(): Error {
  return new Error(
    'Apple sign-in did not complete. Check that CloudKit allows this site and try again.',
  )
}

export async function initICloudAuth(): Promise<void> {
  if (initPromise) {
    return initPromise
  }
  initPromise = (async () => {
    await loadCloudKitScript()
    window.CloudKit!.configure({
      containers: [
        {
          containerIdentifier: ICLOUD_CONTAINER_ID,
          environment: ICLOUD_ENVIRONMENT,
          apiTokenAuth: {
            apiToken: ICLOUD_API_TOKEN,
            persist: true,
            signInButton: { id: CLOUDKIT_SIGN_IN_BUTTON_ID },
            signOutButton: { id: CLOUDKIT_SIGN_OUT_BUTTON_ID },
          },
        },
      ],
      services: {
        authTokenStore: cloudKitAuthTokenStore,
      },
    })
  })()
  return initPromise
}

function setUpCloudKitAuth(
  container: CloudKitContainer,
): Promise<CloudKitUserIdentity | undefined> {
  if (authSetupPromise) {
    return authSetupPromise
  }
  authSetupPromise = container
    .setUpAuth({
      grabAuthToken: true,
      persist: true,
    })
    .then((userIdentity) => {
      authSetupUserIdentity = userIdentity
      return userIdentity
    })
    .catch((error: unknown) => {
      authSetupPromise = undefined
      authSetupUserIdentity = undefined
      throw error
    })
  return authSetupPromise
}

export async function prepareICloudSignInControl(): Promise<void> {
  await initICloudAuth()
  const container = window.CloudKit!.getDefaultContainer()
  try {
    await setUpCloudKitAuth(container)
  } catch (error) {
    throw new Error(cloudKitAuthErrorMessage(error), { cause: error })
  }
}

function clickCloudKitSignInButton(): void {
  const mount = document.getElementById(CLOUDKIT_SIGN_IN_BUTTON_ID)
  const control =
    mount?.querySelector<HTMLElement>('button, [role="button"], iframe, a') ??
    mount
  if (!control) {
    throw new Error('Apple sign-in control is not ready. Reload and try again.')
  }
  control.click()
}

function accountNameFromIdentity(
  identity: CloudKitUserIdentity | undefined,
): string | undefined {
  const given = identity?.nameComponents?.givenName?.trim() ?? ''
  const family = identity?.nameComponents?.familyName?.trim() ?? ''
  const fullName = `${given} ${family}`.trim()
  if (fullName) {
    return fullName
  }
  return identity?.lookupInfo?.emailAddress?.trim() || undefined
}

function requireStoredWebAuthToken(
  identity = authSetupUserIdentity,
): ICloudOAuthTokens {
  const token = readStoredWebAuthToken()
  if (!token) {
    throw new Error('iCloud sign-in did not return a web auth token.')
  }
  const accountName = accountNameFromIdentity(identity)
  return accountName
    ? { accessToken: token, accountName }
    : { accessToken: token }
}

async function waitForCloudKitSignIn(
  container: CloudKitContainer,
  timeoutMs = ICLOUD_SIGN_IN_TIMEOUT_MS,
): Promise<CloudKitUserIdentity> {
  const tokenPromise = waitForStoredWebAuthToken(timeoutMs)
  const signInPromise = container.whenUserSignsIn().then((userIdentity) => {
    authSetupUserIdentity = userIdentity
    return userIdentity
  })
  signInPromise.catch(() => {
    // The CloudKit token store can resolve first; keep later callback failures handled.
  })
  clickCloudKitSignInButton()
  try {
    await Promise.race([tokenPromise, signInPromise])
    await tokenPromise
    return authSetupUserIdentity ?? {}
  } catch (error) {
    throw new Error(cloudKitAuthErrorMessage(error), { cause: error })
  }
}

export function requestPreparedICloudWebAuthToken(
  options: ICloudWebAuthTokenRequestOptions = {},
): Promise<ICloudOAuthTokens> {
  if (!window.CloudKit || !authSetupPromise) {
    return Promise.reject(
      new Error(
        'Apple sign-in control is still loading. Try again in a moment.',
      ),
    )
  }
  if (authSetupUserIdentity) {
    return Promise.resolve(requireStoredWebAuthToken())
  }
  const container = window.CloudKit.getDefaultContainer()
  return waitForCloudKitSignIn(container, options.signInTimeoutMs).then(
    (identity) => requireStoredWebAuthToken(identity),
  )
}

export async function requestICloudWebAuthToken(
  options: ICloudWebAuthTokenRequestOptions = {},
): Promise<ICloudOAuthTokens> {
  await initICloudAuth()
  const container = window.CloudKit!.getDefaultContainer()
  let userIdentity: CloudKitUserIdentity | undefined
  try {
    userIdentity = await setUpCloudKitAuth(container)
  } catch (error) {
    throw new Error(cloudKitAuthErrorMessage(error), { cause: error })
  }

  if (!userIdentity) {
    await waitForCloudKitSignIn(container, options.signInTimeoutMs)
  }

  return requireStoredWebAuthToken()
}

export function oauthTokensToICloudConfig(
  tokens: ICloudOAuthTokens,
  existing?: OAuthFileConfig,
): OAuthFileConfig {
  return {
    preset: 'icloud',
    accessToken: tokens.accessToken,
    fileId: existing?.fileId,
    fileName: existing?.fileName,
    accountEmail: tokens.accountName ?? existing?.accountEmail,
    refreshToken: existing?.refreshToken,
    expiresAt: existing?.expiresAt,
  }
}

export async function ensureValidICloudOAuthFileConfig(
  config: OAuthFileConfig,
): Promise<OAuthFileConfig> {
  if (config.accessToken?.trim()) {
    return config
  }
  const refreshed = await requestICloudWebAuthToken()
  return oauthTokensToICloudConfig(refreshed, config)
}
