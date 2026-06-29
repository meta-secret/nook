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

export type ICloudOAuthTokens = {
  accessToken: string
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
  }) => Promise<CloudKitUserIdentity | null>
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

const cloudKitAuthTokenStore: CloudKitAuthTokenStore = {
  putToken(containerIdentifier, authToken) {
    const key = `${ICLOUD_AUTH_TOKEN_STORAGE_PREFIX}${containerIdentifier}`
    if (authToken == null) {
      sessionStorage.removeItem(key)
      return
    }
    sessionStorage.setItem(key, JSON.stringify(authToken))
  },
  getToken(containerIdentifier) {
    const raw = sessionStorage.getItem(
      `${ICLOUD_AUTH_TOKEN_STORAGE_PREFIX}${containerIdentifier}`,
    )
    if (!raw) {
      return null
    }
    try {
      return JSON.parse(raw) as unknown
    } catch {
      return null
    }
  },
}

declare global {
  interface Window {
    CloudKit?: CloudKitGlobal
  }
}

let initPromise: Promise<void> | null = null

/** @internal Clears module singletons between unit tests. */
export function resetICloudAuthStateForTests(): void {
  initPromise = null
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
  if (typeof stored === 'object' && stored !== null) {
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

function cloudKitAuthErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'object' && error !== null) {
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

function clickCloudKitSignInButton(): void {
  const mount = document.getElementById(CLOUDKIT_SIGN_IN_BUTTON_ID)
  const control =
    mount?.querySelector<HTMLElement>(
      'button, [role="button"], iframe, a',
    ) ?? mount
  if (!control) {
    throw new Error('Apple sign-in control is not ready. Reload and try again.')
  }
  control.click()
}

async function waitForCloudKitSignIn(
  container: CloudKitContainer,
): Promise<void> {
  const signInPromise = container.whenUserSignsIn()
  clickCloudKitSignInButton()
  try {
    await signInPromise
  } catch (error) {
    throw new Error(cloudKitAuthErrorMessage(error), { cause: error })
  }
}

export async function requestICloudWebAuthToken(): Promise<ICloudOAuthTokens> {
  await initICloudAuth()
  const container = window.CloudKit!.getDefaultContainer()
  let userIdentity: CloudKitUserIdentity | null
  try {
    userIdentity = await container.setUpAuth({
      grabAuthToken: true,
      persist: true,
    })
  } catch (error) {
    throw new Error(cloudKitAuthErrorMessage(error), { cause: error })
  }

  if (!userIdentity) {
    await waitForCloudKitSignIn(container)
  }

  const token = readStoredWebAuthToken()
  if (!token) {
    throw new Error('iCloud sign-in did not return a web auth token.')
  }
  return { accessToken: token }
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
    accountEmail: existing?.accountEmail,
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

export async function fetchICloudAccountEmail(): Promise<string | undefined> {
  const token = readStoredWebAuthToken()
  if (!token) {
    return undefined
  }
  const url = new URL(
    `https://api.apple-cloudkit.com/user/1/${ICLOUD_CONTAINER_ID}/${ICLOUD_ENVIRONMENT}/users/current`,
  )
  url.searchParams.set('ckAPIToken', ICLOUD_API_TOKEN)
  url.searchParams.set('ckWebAuthToken', token)
  const response = await fetch(url)
  if (!response.ok) {
    return undefined
  }
  const payload = (await response.json()) as {
    nameComponents?: { givenName?: string; familyName?: string }
  }
  const given = payload.nameComponents?.givenName?.trim() ?? ''
  const family = payload.nameComponents?.familyName?.trim() ?? ''
  const full = `${given} ${family}`.trim()
  return full || undefined
}
