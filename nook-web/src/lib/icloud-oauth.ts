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

export type ICloudOAuthTokens = {
  accessToken: string
}

type CloudKitUserIdentity = {
  nameComponents?: { givenName?: string; familyName?: string }
  lookupInfo?: { emailAddress?: string }
}

type CloudKitContainer = {
  setUpAuth: (options?: {
    grabAuthToken?: boolean
    persist?: boolean
  }) => Promise<CloudKitUserIdentity | null>
}

type CloudKitGlobal = {
  configure: (config: {
    containers: Array<{
      containerIdentifier: string
      apiToken: string
      environment: 'development' | 'production'
    }>
  }) => void
  getDefaultContainer: () => CloudKitContainer
}

declare global {
  interface Window {
    CloudKit?: CloudKitGlobal
  }
}

let initPromise: Promise<void> | null = null

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
    const existing = document.querySelector(`script[src="${CLOUDKIT_SCRIPT_URL}"]`)
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
          apiToken: ICLOUD_API_TOKEN,
          environment: ICLOUD_ENVIRONMENT,
        },
      ],
    })
  })()
  return initPromise
}

export async function requestICloudWebAuthToken(): Promise<ICloudOAuthTokens> {
  await initICloudAuth()
  const container = window.CloudKit!.getDefaultContainer()
  await container.setUpAuth({ grabAuthToken: true, persist: true })
  const token = readWebAuthTokenFromCookie()
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
  const token = readWebAuthTokenFromCookie()
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
