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
import { createLogger } from '$lib/log'

const CLOUDKIT_SCRIPT_URL = 'https://cdn.apple-cloudkit.com/ck/2/cloudkit.js'
const CLOUDKIT_SIGN_IN_BUTTON_ID = 'apple-sign-in-button'
const CLOUDKIT_SIGN_OUT_BUTTON_ID = 'apple-sign-out-button'
export const ICLOUD_SIGN_IN_TIMEOUT_MS = 60_000
const log = createLogger('icloud-oauth')

export type ICloudOAuthTokens = {
  accessToken: string
  accountName?: string
}

type ICloudWebAuthTokenRequestOptions = {
  signInTimeoutMs?: number
  clickSignInControl?: boolean
}

type CloudKitUserIdentity = {
  nameComponents?: { givenName?: string; familyName?: string }
  lookupInfo?: { emailAddress?: string }
}

type CloudKitAuthError = {
  _reason?: string
  code?: string | number
  errorCode?: string | number
  message?: string
  name?: string
  reason?: string
  redirectURL?: string
  serverErrorCode?: string | number
  status?: string | number
  statusCode?: string | number
  statusText?: string
  uuid?: string
}

type CloudKitAuthErrorDetails = {
  code?: string
  message?: string
  redirectURLPresent?: boolean
  redirectURLOrigin?: string
  redirectURLPathname?: string
  reason?: string
  status?: number
  statusText?: string
  uuidPresent?: boolean
}

type CloudKitAuthChallenge = {
  reason?: string
  redirectURL?: string
  serverErrorCode?: string
  uuid?: string
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
        signInButton: {
          id: string
          theme?: 'black' | 'white' | 'white-with-outline'
        }
        signOutButton: {
          id: string
          theme?: 'black' | 'white' | 'white-with-outline'
        }
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

function tokenDiagnostics(token: string | undefined): {
  present: boolean
  length: number
} {
  return {
    present: Boolean(token),
    length: token?.length ?? 0,
  }
}

function sanitizedURLDiagnostics(url: string | undefined): {
  present: boolean
  origin?: string
  pathname?: string
} {
  if (!url) {
    return { present: false }
  }
  try {
    const parsed = new URL(url)
    return {
      present: true,
      origin: parsed.origin,
      pathname: parsed.pathname,
    }
  } catch {
    return { present: true }
  }
}

function currentBrowserDiagnostics(): {
  origin: string
  hostname: string
  pathname: string
  protocol: string
  isSecureContext: boolean
  topLevel: boolean
  visibilityState: DocumentVisibilityState
  userAgent: string
  cookieNames: string[]
} {
  return {
    origin: window.location.origin,
    hostname: window.location.hostname,
    pathname: window.location.pathname,
    protocol: window.location.protocol,
    isSecureContext: window.isSecureContext,
    topLevel: window.top === window.self,
    visibilityState: document.visibilityState,
    userAgent: navigator.userAgent,
    cookieNames: document.cookie
      .split(';')
      .map((part) => part.trim().split('=')[0])
      .filter(Boolean),
  }
}

function webAuthTokenStorageDiagnostics(): {
  expectedKeyPresent: boolean
  storedKeyCount: number
  storedKeys: string[]
} {
  const storedKeys: string[] = []
  for (let index = 0; index < sessionStorage.length; index += 1) {
    const key = sessionStorage.key(index)
    if (key?.startsWith(ICLOUD_AUTH_TOKEN_STORAGE_PREFIX)) {
      storedKeys.push(key)
    }
  }
  const expectedKey = `${ICLOUD_AUTH_TOKEN_STORAGE_PREFIX}${ICLOUD_CONTAINER_ID}`
  return {
    expectedKeyPresent: sessionStorage.getItem(expectedKey) != null,
    storedKeyCount: storedKeys.length,
    storedKeys,
  }
}

function iCloudConfigDiagnostics(): {
  container: string
  environment: typeof ICLOUD_ENVIRONMENT
  apiTokenConfigured: boolean
  apiTokenLength: number
} {
  return {
    container: ICLOUD_CONTAINER_ID,
    environment: ICLOUD_ENVIRONMENT,
    apiTokenConfigured: Boolean(ICLOUD_API_TOKEN.trim()),
    apiTokenLength: ICLOUD_API_TOKEN.trim().length,
  }
}

function elementDiagnostics(element: Element | null): {
  present: boolean
  tag?: string
  id?: string
  className?: string
  role?: string
  childElementCount?: number
  textLength?: number
} {
  if (!element) {
    return { present: false }
  }
  return {
    present: true,
    tag: element.tagName,
    id: element.id || undefined,
    className:
      typeof element.className === 'string' && element.className
        ? element.className
        : undefined,
    role: element.getAttribute('role') ?? undefined,
    childElementCount: element.childElementCount,
    textLength: element.textContent?.trim().length ?? 0,
  }
}

function cloudKitSignInControlDiagnostics(): {
  mount: ReturnType<typeof elementDiagnostics>
  control: ReturnType<typeof elementDiagnostics>
  signOutMount: ReturnType<typeof elementDiagnostics>
} {
  const mount =
    typeof document === 'undefined'
      ? null
      : document.getElementById(CLOUDKIT_SIGN_IN_BUTTON_ID)
  const control =
    mount?.querySelector<HTMLElement>(
      'button, [role="button"], iframe, a, .apple-auth-button',
    ) ?? null
  const signOutMount =
    typeof document === 'undefined'
      ? null
      : document.getElementById(CLOUDKIT_SIGN_OUT_BUTTON_ID)
  return {
    mount: elementDiagnostics(mount),
    control: elementDiagnostics(control),
    signOutMount: elementDiagnostics(signOutMount),
  }
}

function storeCloudKitWebAuthToken(
  containerIdentifier: string,
  authToken: unknown,
): string | undefined {
  const key = `${ICLOUD_AUTH_TOKEN_STORAGE_PREFIX}${containerIdentifier}`
  if (authToken == undefined) {
    sessionStorage.removeItem(key)
    log.info('CloudKit web auth token cleared', {
      container: containerIdentifier,
      expectedContainer: containerIdentifier === ICLOUD_CONTAINER_ID,
    })
    return undefined
  }
  sessionStorage.setItem(key, JSON.stringify(authToken))
  const token = normalizeWebAuthToken(authToken)
  log.info('CloudKit web auth token stored', {
    container: containerIdentifier,
    expectedContainer: containerIdentifier === ICLOUD_CONTAINER_ID,
    tokenType: typeof authToken,
    normalized: tokenDiagnostics(token),
  })
  if (containerIdentifier === ICLOUD_CONTAINER_ID && token) {
    for (const listener of webAuthTokenListeners) {
      listener(token)
    }
  }
  return token
}

const cloudKitAuthTokenStore: CloudKitAuthTokenStore = {
  putToken(containerIdentifier, authToken) {
    log.debug('CloudKit putToken', {
      container: containerIdentifier,
      tokenType: typeof authToken,
      hasValue: authToken != null,
    })
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
      log.info('CloudKit JS already loaded', currentBrowserDiagnostics())
      resolve()
      return
    }
    const existing = document.querySelector(
      `script[src="${CLOUDKIT_SCRIPT_URL}"]`,
    )
    if (existing) {
      log.info('CloudKit JS load waiting on existing script', {
        scriptUrl: CLOUDKIT_SCRIPT_URL,
      })
      existing.addEventListener(
        'load',
        () => {
          log.info('CloudKit JS loaded from existing script')
          resolve()
        },
        { once: true },
      )
      existing.addEventListener(
        'error',
        () => {
          log.warn('CloudKit JS existing script failed to load', {
            scriptUrl: CLOUDKIT_SCRIPT_URL,
          })
          reject(new Error('Failed to load CloudKit JS.'))
        },
        { once: true },
      )
      return
    }
    log.info('CloudKit JS load started', {
      scriptUrl: CLOUDKIT_SCRIPT_URL,
      ...currentBrowserDiagnostics(),
    })
    const script = document.createElement('script')
    script.src = CLOUDKIT_SCRIPT_URL
    script.async = true
    script.defer = true
    script.onload = () => {
      log.info('CloudKit JS loaded', { scriptUrl: CLOUDKIT_SCRIPT_URL })
      resolve()
    }
    script.onerror = () => {
      log.warn('CloudKit JS failed to load', { scriptUrl: CLOUDKIT_SCRIPT_URL })
      reject(new Error('Failed to load CloudKit JS.'))
    }
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
      const token = decodeURIComponent(value)
      log.info('CloudKit web auth token found in cookie', {
        cookieName: trimmed.slice(0, eq),
        token: tokenDiagnostics(token),
      })
      return token
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
    for (const key of [
      'token',
      'ckWebAuthToken',
      'webAuthToken',
      'authToken',
      'value',
    ]) {
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
  const stored = cloudKitAuthTokenStore.getToken(ICLOUD_CONTAINER_ID)
  const token = normalizeWebAuthToken(stored)
  if (token) {
    log.info('CloudKit web auth token found in session storage', {
      storedType: typeof stored,
      token: tokenDiagnostics(token),
    })
  }
  return token
}

function waitForStoredWebAuthToken(
  timeoutMs = ICLOUD_SIGN_IN_TIMEOUT_MS,
): Promise<string> {
  const existing = readStoredWebAuthToken()
  if (existing) {
    log.info('CloudKit web auth token already available before wait', {
      token: tokenDiagnostics(existing),
      timeoutMs,
    })
    return Promise.resolve(existing)
  }
  log.info('CloudKit web auth token wait started', { timeoutMs })

  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined = undefined
    let pollId: ReturnType<typeof setInterval> | undefined = undefined
    let settled = false

    const cleanup = () => {
      settled = true
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
      if (pollId !== undefined) {
        clearInterval(pollId)
      }
      webAuthTokenListeners.delete(listener)
    }

    const listener = (token: string) => {
      if (settled) {
        return
      }
      cleanup()
      log.info('CloudKit web auth token wait resolved by token store', {
        token: tokenDiagnostics(token),
      })
      resolve(token)
    }
    webAuthTokenListeners.add(listener)

    // Fallback: poll cookies / session storage so we detect tokens that
    // CloudKit JS stored outside the custom authTokenStore (e.g. via
    // cookie or a direct sessionStorage write after a SDK update).
    pollId = setInterval(() => {
      const token = readStoredWebAuthToken()
      if (token) {
        cleanup()
        log.info('CloudKit web auth token wait resolved by polling', {
          token: tokenDiagnostics(token),
        })
        resolve(token)
      }
    }, 500)

    timeoutId = setTimeout(() => {
      cleanup()
      log.warn('CloudKit web auth token wait timed out', {
        timeoutMs,
        ...currentBrowserDiagnostics(),
        storage: webAuthTokenStorageDiagnostics(),
        control: cloudKitSignInControlDiagnostics(),
      })
      reject(cloudKitSignInTimeoutError())
    }, timeoutMs)
  })
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined
  }
  const text = String(value).trim()
  return text || undefined
}

function numericStatus(value: unknown): number | undefined {
  const text = stringValue(value)
  if (!text) {
    return undefined
  }
  const status = Number(text)
  return Number.isInteger(status) ? status : undefined
}

function cloudKitAuthErrorDetails(error: unknown): CloudKitAuthErrorDetails {
  if (error instanceof Error) {
    return {
      code: error.name && error.name !== 'Error' ? error.name : undefined,
      message: stringValue(error.message),
    }
  }
  if (error != undefined && typeof error === 'object') {
    const authError = error as CloudKitAuthError
    let redirectURLOrigin: string | undefined
    let redirectURLPathname: string | undefined
    const redirectURL = stringValue(authError.redirectURL)
    if (redirectURL) {
      try {
        const parsed = new URL(redirectURL)
        redirectURLOrigin = parsed.origin
        redirectURLPathname = parsed.pathname
      } catch {
        redirectURLOrigin = undefined
        redirectURLPathname = undefined
      }
    }
    return {
      code:
        stringValue(authError.code) ??
        stringValue(authError.errorCode) ??
        stringValue(authError.serverErrorCode) ??
        stringValue(authError.name),
      message: stringValue(authError.message),
      redirectURLPresent: Boolean(redirectURL),
      redirectURLOrigin,
      redirectURLPathname,
      reason: stringValue(authError.reason) ?? stringValue(authError._reason),
      status:
        numericStatus(authError.status) ?? numericStatus(authError.statusCode),
      statusText: stringValue(authError.statusText),
      uuidPresent: Boolean(stringValue(authError.uuid)),
    }
  }
  return {}
}

function hasErrorToken(
  details: CloudKitAuthErrorDetails,
  predicate: (value: string) => boolean,
): boolean {
  return [details.code, details.message, details.reason, details.statusText]
    .filter((value): value is string => Boolean(value))
    .some((value) => predicate(value.toUpperCase()))
}

function isAuthRequiredCloudKitError(
  details: CloudKitAuthErrorDetails,
): boolean {
  if (details.status === 421) {
    return true
  }
  return hasErrorToken(details, (value) =>
    [
      'AUTHENTICATION_REQUIRED',
      'REQUEST NEEDS AUTHORIZATION',
      'NEEDS AUTHORIZATION',
    ].some((token) => value.includes(token)),
  )
}

function hasCloudKitSignInControl(): boolean {
  return (
    typeof document !== 'undefined' &&
    Boolean(document.getElementById(CLOUDKIT_SIGN_IN_BUTTON_ID))
  )
}

function isExpectedSignInSetupFailure(error: unknown): boolean {
  const details = cloudKitAuthErrorDetails(error)
  if (isAuthRequiredCloudKitError(details)) {
    return hasCloudKitSignInControl()
  }
  const isOpaqueUnknown = hasErrorToken(details, (value) =>
    value.includes('UNKNOWN_ERROR'),
  )
  return isOpaqueUnknown && hasCloudKitSignInControl()
}

function cloudKitAuthErrorMessage(error: unknown): string {
  const details = cloudKitAuthErrorDetails(error)
  if (isAuthRequiredCloudKitError(details)) {
    return 'Apple sign-in is required. Click Sign in with Apple to continue.'
  }
  const isMisdirectedRequest =
    details.status === 421 ||
    hasErrorToken(
      details,
      (value) => value.includes('421') || value.includes('MISDIRECTED'),
    )
  if (isMisdirectedRequest) {
    return 'Apple sign-in is required. Click Sign in with Apple to continue.'
  }
  const isUnknownCloudKitError = hasErrorToken(details, (value) =>
    value.includes('UNKNOWN_ERROR'),
  )
  if (isUnknownCloudKitError) {
    return 'Apple CloudKit returned UNKNOWN_ERROR during sign-in. Check that the iCloud API token is enabled for this production container and that https://nokey.sh is an allowed web origin.'
  }
  return (
    details.reason ??
    details.message ??
    details.statusText ??
    'iCloud sign-in failed.'
  )
}

function logCloudKitAuthFailure(message: string, error: unknown): void {
  const details = cloudKitAuthErrorDetails(error)
  log.warn(message, {
    code: details.code,
    reason: details.reason,
    message: details.message,
    redirectURLPresent: details.redirectURLPresent,
    redirectURLOrigin: details.redirectURLOrigin,
    redirectURLPathname: details.redirectURLPathname,
    status: details.status,
    statusText: details.statusText,
    uuidPresent: details.uuidPresent,
    storage: webAuthTokenStorageDiagnostics(),
    control: cloudKitSignInControlDiagnostics(),
  })
}

function cloudKitSignInTimeoutError(): Error {
  return new Error(
    'Apple sign-in did not complete. Check that CloudKit allows this site and try again.',
  )
}

export async function initICloudAuth(): Promise<void> {
  if (initPromise) {
    log.info('CloudKit auth init reused existing promise')
    return initPromise
  }
  initPromise = (async () => {
    log.info('CloudKit auth init started', {
      config: iCloudConfigDiagnostics(),
      browser: currentBrowserDiagnostics(),
    })
    await loadCloudKitScript()
    window.CloudKit!.configure({
      containers: [
        {
          containerIdentifier: ICLOUD_CONTAINER_ID,
          environment: ICLOUD_ENVIRONMENT,
          apiTokenAuth: {
            apiToken: ICLOUD_API_TOKEN,
            persist: true,
            signInButton: { id: CLOUDKIT_SIGN_IN_BUTTON_ID, theme: 'black' },
            signOutButton: { id: CLOUDKIT_SIGN_OUT_BUTTON_ID, theme: 'black' },
          },
        },
      ],
      services: {
        authTokenStore: cloudKitAuthTokenStore,
      },
    })
    log.info('CloudKit auth configured', {
      config: iCloudConfigDiagnostics(),
      hasCloudKitGlobal: Boolean(window.CloudKit),
    })
  })()
  return initPromise
}

function setUpCloudKitAuth(
  container: CloudKitContainer,
): Promise<CloudKitUserIdentity | undefined> {
  if (authSetupPromise) {
    log.info('CloudKit setUpAuth reused existing promise')
    return authSetupPromise
  }
  log.info('CloudKit setUpAuth started', {
    grabAuthToken: true,
    persist: true,
    hasSignInMount: hasCloudKitSignInControl(),
    control: cloudKitSignInControlDiagnostics(),
  })
  authSetupPromise = container
    .setUpAuth({
      grabAuthToken: true,
      persist: true,
    })
    .then((userIdentity) => {
      authSetupUserIdentity = userIdentity
      log.info('CloudKit setUpAuth completed', {
        signedIn: Boolean(userIdentity),
        token: tokenDiagnostics(readStoredWebAuthToken()),
        storage: webAuthTokenStorageDiagnostics(),
        control: cloudKitSignInControlDiagnostics(),
      })
      return userIdentity
    })
    .catch((error: unknown) => {
      if (isExpectedSignInSetupFailure(error)) {
        log.info('CloudKit auth setup waiting for Apple sign-in', {
          details: cloudKitAuthErrorDetails(error),
          hasSignInMount: hasCloudKitSignInControl(),
          storage: webAuthTokenStorageDiagnostics(),
          control: cloudKitSignInControlDiagnostics(),
        })
        authSetupUserIdentity = undefined
        return undefined
      }
      authSetupPromise = undefined
      authSetupUserIdentity = undefined
      throw error
    })
  return authSetupPromise
}

export async function prepareICloudSignInControl(): Promise<void> {
  log.info('CloudKit sign-in control prepare started')
  await initICloudAuth()
  const container = window.CloudKit!.getDefaultContainer()
  try {
    await setUpCloudKitAuth(container)
    log.info('CloudKit sign-in control ready', {
      hasSignInMount: hasCloudKitSignInControl(),
      token: tokenDiagnostics(readStoredWebAuthToken()),
      storage: webAuthTokenStorageDiagnostics(),
      control: cloudKitSignInControlDiagnostics(),
    })
  } catch (error) {
    logCloudKitAuthFailure('CloudKit auth setup failed', error)
    throw new Error(cloudKitAuthErrorMessage(error), { cause: error })
  }
}

function clickCloudKitSignInButton(): void {
  const mount = document.getElementById(CLOUDKIT_SIGN_IN_BUTTON_ID)
  const control =
    mount?.querySelector<HTMLElement>(
      'button, [role="button"], iframe, a, .apple-auth-button',
    ) ?? mount
  if (!control) {
    log.warn('CloudKit sign-in control click failed: control missing', {
      hasMount: Boolean(mount),
    })
    throw new Error('Apple sign-in control is not ready. Reload and try again.')
  }
  log.info('CloudKit sign-in control click forwarded', {
    mountTag: mount?.tagName,
    controlTag: control.tagName,
    controlRole: control.getAttribute('role') ?? undefined,
    control: cloudKitSignInControlDiagnostics(),
  })
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

function cloudKitCurrentUserURL(): string {
  const container = encodeURIComponent(ICLOUD_CONTAINER_ID)
  const environment = encodeURIComponent(ICLOUD_ENVIRONMENT)
  const apiToken = encodeURIComponent(ICLOUD_API_TOKEN)
  return `https://api.apple-cloudkit.com/database/1/${container}/${environment}/public/users/current?ckAPIToken=${apiToken}`
}

async function fetchCloudKitWebAuthChallenge(): Promise<CloudKitAuthChallenge> {
  const response = await fetch(cloudKitCurrentUserURL(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  const body = (await response
    .json()
    .catch(() => ({}))) as CloudKitAuthChallenge
  log.info('CloudKit direct web auth challenge received', {
    status: response.status,
    ok: response.ok,
    serverErrorCode: body.serverErrorCode,
    reason: body.reason,
    redirectURL: sanitizedURLDiagnostics(body.redirectURL),
    uuidPresent: Boolean(body.uuid),
  })
  if (body.serverErrorCode === 'AUTHENTICATION_REQUIRED' && body.redirectURL) {
    return body
  }
  if (body.serverErrorCode === 'AUTHENTICATION_FAILED') {
    throw new Error(
      'Apple rejected the iCloud API token for this container. Check the CloudKit production API token and allowed origin https://nokey.sh.',
    )
  }
  throw new Error(
    body.reason ??
      body.serverErrorCode ??
      `Apple CloudKit auth challenge failed with HTTP ${response.status}.`,
  )
}

function webAuthTokenFromMessageData(data: unknown): string | undefined {
  if (typeof data === 'string') {
    try {
      return webAuthTokenFromMessageData(JSON.parse(data))
    } catch {
      return undefined
    }
  }
  if (data == undefined || typeof data !== 'object') {
    return undefined
  }
  const record = data as Record<string, unknown>
  for (const key of ['ckWebAuthToken', 'webAuthToken', 'authToken', 'token']) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }
  return undefined
}

async function requestDirectCloudKitWebAuthToken(
  timeoutMs = ICLOUD_SIGN_IN_TIMEOUT_MS,
): Promise<string> {
  log.info('CloudKit direct web auth fallback started', {
    timeoutMs,
    browser: currentBrowserDiagnostics(),
  })
  const challenge = await fetchCloudKitWebAuthChallenge()
  const authWindow = window.open(
    challenge.redirectURL,
    'nook-icloud-auth',
    'popup,width=520,height=720',
  )
  if (!authWindow) {
    log.warn('CloudKit direct web auth popup blocked', {
      redirectURL: sanitizedURLDiagnostics(challenge.redirectURL),
    })
    throw new Error(
      'Apple sign-in popup was blocked. Allow popups and try again.',
    )
  }
  return new Promise((resolve, reject) => {
    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined = undefined
    const cleanup = () => {
      settled = true
      window.removeEventListener('message', handleMessage)
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
    }
    const handleMessage = (event: MessageEvent<unknown>) => {
      const token = webAuthTokenFromMessageData(event.data)
      log.info('CloudKit direct web auth message received', {
        origin: event.origin,
        token: tokenDiagnostics(token),
      })
      if (!token || settled) {
        return
      }
      cleanup()
      storeCloudKitWebAuthToken(ICLOUD_CONTAINER_ID, token)
      try {
        authWindow.close()
      } catch {
        // Ignore browser-specific popup close failures.
      }
      resolve(token)
    }
    window.addEventListener('message', handleMessage)
    timeoutId = setTimeout(() => {
      if (settled) {
        return
      }
      cleanup()
      log.warn('CloudKit direct web auth fallback timed out', {
        timeoutMs,
        storage: webAuthTokenStorageDiagnostics(),
      })
      reject(cloudKitSignInTimeoutError())
    }, timeoutMs)
  })
}

async function waitForCloudKitSignIn(
  container: CloudKitContainer,
  timeoutMs = ICLOUD_SIGN_IN_TIMEOUT_MS,
  options: Pick<ICloudWebAuthTokenRequestOptions, 'clickSignInControl'> = {},
): Promise<CloudKitUserIdentity> {
  log.info('CloudKit sign-in wait started', {
    timeoutMs,
    clickSignInControl: options.clickSignInControl !== false,
    tokenBeforeWait: tokenDiagnostics(readStoredWebAuthToken()),
    storage: webAuthTokenStorageDiagnostics(),
    control: cloudKitSignInControlDiagnostics(),
  })
  const tokenPromise = waitForStoredWebAuthToken(timeoutMs)
  let sawExpectedSignInFailure = false
  const signInPromise = container
    .whenUserSignsIn()
    .then((userIdentity) => {
      authSetupUserIdentity = userIdentity
      log.info('CloudKit whenUserSignsIn resolved', {
        signedIn: Boolean(userIdentity),
        token: tokenDiagnostics(readStoredWebAuthToken()),
        storage: webAuthTokenStorageDiagnostics(),
      })
      return userIdentity
    })
    .catch((error: unknown) => {
      if (isExpectedSignInSetupFailure(error)) {
        sawExpectedSignInFailure = true
        log.info('CloudKit sign-in callback waiting for web auth token', {
          details: cloudKitAuthErrorDetails(error),
          hasSignInMount: hasCloudKitSignInControl(),
          storage: webAuthTokenStorageDiagnostics(),
          control: cloudKitSignInControlDiagnostics(),
        })
        return undefined
      }
      throw error
    })
  signInPromise.catch(() => {
    // The CloudKit token store can resolve first; keep later callback failures handled.
  })
  if (options.clickSignInControl !== false) {
    clickCloudKitSignInButton()
  }
  try {
    await Promise.race([tokenPromise, signInPromise])
    // After the race, the token may already be in cookies or session
    // storage even when putToken was not called (CloudKit JS may bypass
    // the custom authTokenStore).  Check directly before blocking on
    // tokenPromise so we don't wait for the full timeout.
    const immediateToken = readStoredWebAuthToken()
    if (immediateToken) {
      log.info('CloudKit sign-in succeeded with immediate token', {
        signedIn: Boolean(authSetupUserIdentity),
        token: tokenDiagnostics(immediateToken),
      })
      return authSetupUserIdentity ?? {}
    }
    if (sawExpectedSignInFailure) {
      await requestDirectCloudKitWebAuthToken(timeoutMs)
      log.info('CloudKit sign-in succeeded through direct fallback', {
        token: tokenDiagnostics(readStoredWebAuthToken()),
      })
      return authSetupUserIdentity ?? {}
    }
    await tokenPromise
    log.info('CloudKit sign-in succeeded after token wait', {
      signedIn: Boolean(authSetupUserIdentity),
      token: tokenDiagnostics(readStoredWebAuthToken()),
    })
    return authSetupUserIdentity ?? {}
  } catch (error) {
    // Allow a fresh setUpAuth attempt on the next user interaction so
    // retries do not reuse a stale cached promise.
    authSetupPromise = undefined
    authSetupUserIdentity = undefined
    logCloudKitAuthFailure('CloudKit sign-in failed', error)
    throw new Error(cloudKitAuthErrorMessage(error), { cause: error })
  }
}

export function requestPreparedICloudWebAuthToken(
  options: ICloudWebAuthTokenRequestOptions = {},
): Promise<ICloudOAuthTokens> {
  log.info('CloudKit prepared token request started', {
    hasCloudKitGlobal: Boolean(window.CloudKit),
    hasAuthSetupPromise: Boolean(authSetupPromise),
    hasAuthSetupUserIdentity: Boolean(authSetupUserIdentity),
    clickSignInControl: options.clickSignInControl !== false,
  })
  if (!window.CloudKit || !authSetupPromise) {
    return Promise.reject(
      new Error(
        'Apple sign-in control is still loading. Try again in a moment.',
      ),
    )
  }
  if (authSetupUserIdentity) {
    log.info('CloudKit prepared token request using existing identity')
    return Promise.resolve(requireStoredWebAuthToken())
  }
  const container = window.CloudKit.getDefaultContainer()
  return waitForCloudKitSignIn(
    container,
    options.signInTimeoutMs,
    options,
  ).then((identity) => requireStoredWebAuthToken(identity))
}

export async function requestICloudWebAuthToken(
  options: ICloudWebAuthTokenRequestOptions = {},
): Promise<ICloudOAuthTokens> {
  log.info('CloudKit direct token request started')
  await initICloudAuth()
  const container = window.CloudKit!.getDefaultContainer()
  let userIdentity: CloudKitUserIdentity | undefined
  try {
    userIdentity = await setUpCloudKitAuth(container)
  } catch (error) {
    logCloudKitAuthFailure('CloudKit auth setup failed', error)
    throw new Error(cloudKitAuthErrorMessage(error), { cause: error })
  }

  if (!userIdentity) {
    await waitForCloudKitSignIn(container, options.signInTimeoutMs, options)
  }

  log.info('CloudKit direct token request returning token', {
    token: tokenDiagnostics(readStoredWebAuthToken()),
  })
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
