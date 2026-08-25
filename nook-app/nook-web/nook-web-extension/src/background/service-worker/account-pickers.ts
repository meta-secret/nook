import {
  type WebsiteAuthenticatorOption,
  type WebsiteLoginAccountOption,
} from '../../lib/login-fill-messages'
import { OpenCompanionLauncherIntent } from '../../../../nook-web-shared/src/extension/companion-launcher-message'
import {
  extensionSessionGrantIdentity,
  type StoredExtensionPairingGrant,
} from '../pairing-grants'
import {
  extensionSessionInteractiveDeadline,
  extensionSessionProbeDeadline,
  type ExtensionSessionQueue,
  MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
} from '../../offscreen/session-request-adapter'
import type { WebsiteLoginMatchAvailabilityWire } from '../../lib/auth-workflow-messages'
import {
  WebsiteLoginCanceledMessageType,
  type WebsiteLoginCanceledMessage,
} from '../../lib/login-picker-messages'
import {
  WebsiteAuthenticatorCanceledMessageType,
  type WebsiteAuthenticatorCanceledMessage,
} from '../../lib/authenticator-picker-messages'
import {
  LoginMatchAvailabilityCache,
  type LoginMatchAvailabilityCacheInvalidation,
  type LoginMatchAvailabilityCacheOptions,
  type LoginMatchAvailabilityCacheRequest,
} from '../../lib/login-match-availability-cache'
import {
  availableWebsiteGrants,
  getAllSessionStorage,
  getSessionStorage,
  isAuthorizedWebsiteSender,
  passwordPairingGrants,
  removeSessionStorage,
  sendSessionMessage,
  setSessionStorage,
} from './pairing-identity'
import {
  SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS,
  ensureExtensionSessionDocument,
  isUnlockedSessionStatus,
  openCompanionLauncherBestEffort,
} from './session-lifecycle'

type PendingAuthenticatorPicker = {
  requestId: string
  origin: string
  tabId: number
  allowedVaultStoreIds: string[]
  expiresAt: number
}

type PendingLoginPicker = PendingAuthenticatorPicker

export const AUTHENTICATOR_PICKER_TTL_MS = 5 * 60 * 1000
export const LOGIN_PICKER_TTL_MS = 5 * 60 * 1000

const AUTHENTICATOR_PICKER_STORAGE_PREFIX =
  'nook.extension.authenticator-picker.'
const LOGIN_PICKER_STORAGE_PREFIX = 'nook.extension.login-picker.'

const pendingAuthenticatorPickers = new Map<
  string,
  PendingAuthenticatorPicker
>()
const pendingLoginPickers = new Map<string, PendingLoginPicker>()

export type PersistedAccountPickerCleanupPlan = {
  storageKeys: string[]
  cancellations: Array<
    WebsiteAuthenticatorCanceledMessage | WebsiteLoginCanceledMessage
  >
}

export type PersistedAccountPickerStorage = Record<string, unknown>

export function persistedAccountPickerCleanupPlan(
  stored: PersistedAccountPickerStorage,
): PersistedAccountPickerCleanupPlan {
  const storageKeys: string[] = []
  const cancellations: PersistedAccountPickerCleanupPlan['cancellations'] = []
  for (const [key, value] of Object.entries(stored)) {
    if (key.startsWith(AUTHENTICATOR_PICKER_STORAGE_PREFIX)) {
      storageKeys.push(key)
      if (isPendingAuthenticatorPicker(value)) {
        const cancellation: WebsiteAuthenticatorCanceledMessage = {
          type: WebsiteAuthenticatorCanceledMessageType.NookWebsiteAuthenticatorCanceled,
          payload: { origin: value.origin, requestId: value.requestId },
        }
        cancellations.push(cancellation)
      }
    } else if (key.startsWith(LOGIN_PICKER_STORAGE_PREFIX)) {
      storageKeys.push(key)
      if (isPendingAuthenticatorPicker(value)) {
        const cancellation: WebsiteLoginCanceledMessage = {
          type: WebsiteLoginCanceledMessageType.NookWebsiteLoginCanceled,
          payload: { origin: value.origin, requestId: value.requestId },
        }
        cancellations.push(cancellation)
      }
    }
  }
  return { storageKeys, cancellations }
}

export async function clearPendingAccountPickers(): Promise<void> {
  const stored = await getAllSessionStorage()
  const plan = persistedAccountPickerCleanupPlan(stored)
  const authenticatorRequests = new Map(pendingAuthenticatorPickers)
  const loginRequests = new Map(pendingLoginPickers)
  pendingAuthenticatorPickers.clear()
  pendingLoginPickers.clear()
  await Promise.all(plan.storageKeys.map(removeSessionStorage))

  const cancellations: Array<
    WebsiteAuthenticatorCanceledMessage | WebsiteLoginCanceledMessage
  > = [
    ...plan.cancellations,
    ...Array.from(authenticatorRequests.values(), (request) => ({
      type: WebsiteAuthenticatorCanceledMessageType.NookWebsiteAuthenticatorCanceled,
      payload: { origin: request.origin, requestId: request.requestId },
    })),
    ...Array.from(loginRequests.values(), (request) => ({
      type: WebsiteLoginCanceledMessageType.NookWebsiteLoginCanceled,
      payload: { origin: request.origin, requestId: request.requestId },
    })),
  ]
  const uniqueCancellations = Array.from(
    new Map(
      cancellations.map((message) => [
        `${message.type}:${message.payload.requestId}`,
        message,
      ]),
    ).values(),
  )
  await Promise.allSettled(
    uniqueCancellations.map((message) => chrome.runtime.sendMessage(message)),
  )
}

enum SessionAccountListKind {
  Available = 'available',
  Invalid = 'invalid',
}

type SessionAccountList =
  | { kind: SessionAccountListKind.Available; accounts: unknown[] }
  | { kind: SessionAccountListKind.Invalid }

function sessionResponseAccounts(response: unknown): SessionAccountList {
  if (
    !response ||
    typeof response !== 'object' ||
    !('ok' in response) ||
    response.ok !== true ||
    !('accounts' in response) ||
    !Array.isArray(response.accounts)
  ) {
    return { kind: SessionAccountListKind.Invalid }
  }
  return { kind: SessionAccountListKind.Available, accounts: response.accounts }
}

function authenticatorPickerStorageKey(requestId: string): string {
  return `${AUTHENTICATOR_PICKER_STORAGE_PREFIX}${requestId}`
}

function isPendingAuthenticatorPicker(
  value: unknown,
): value is PendingAuthenticatorPicker {
  return (
    !!value &&
    typeof value === 'object' &&
    'requestId' in value &&
    typeof value.requestId === 'string' &&
    'origin' in value &&
    typeof value.origin === 'string' &&
    'tabId' in value &&
    typeof value.tabId === 'number' &&
    Number.isInteger(value.tabId) &&
    value.tabId >= 0 &&
    'allowedVaultStoreIds' in value &&
    Array.isArray(value.allowedVaultStoreIds) &&
    value.allowedVaultStoreIds.every(
      (vaultStoreId) =>
        typeof vaultStoreId === 'string' && vaultStoreId.length > 0,
    ) &&
    'expiresAt' in value &&
    typeof value.expiresAt === 'number' &&
    Number.isFinite(value.expiresAt)
  )
}

export async function storeAuthenticatorPicker(
  request: PendingAuthenticatorPicker,
): Promise<void> {
  pendingAuthenticatorPickers.set(request.requestId, request)
  const nookTypedArgs0_0: Parameters<typeof setSessionStorage>[0] = {
    [authenticatorPickerStorageKey(request.requestId)]: request,
  }
  await setSessionStorage(nookTypedArgs0_0)
}

export async function removeAuthenticatorPicker(
  requestId: string,
): Promise<void> {
  pendingAuthenticatorPickers.delete(requestId)
  await removeSessionStorage(authenticatorPickerStorageKey(requestId))
}

export enum AuthenticatorPickerLoadKind {
  Available = 'available',
  Unavailable = 'unavailable',
}

export type AuthenticatorPickerLoad =
  | {
      kind: AuthenticatorPickerLoadKind.Available
      request: PendingAuthenticatorPicker
    }
  | { kind: AuthenticatorPickerLoadKind.Unavailable }

export async function loadAuthenticatorPicker(
  requestId: string,
): Promise<AuthenticatorPickerLoad> {
  let request = pendingAuthenticatorPickers.get(requestId)
  if (!request) {
    const key = authenticatorPickerStorageKey(requestId)
    const stored = (await getSessionStorage(key))[key]
    if (
      !isPendingAuthenticatorPicker(stored) ||
      stored.requestId !== requestId
    ) {
      if (stored) await removeSessionStorage(key)
      return { kind: AuthenticatorPickerLoadKind.Unavailable }
    }
    request = stored
    pendingAuthenticatorPickers.set(requestId, request)
  }
  if (request.expiresAt <= Date.now()) {
    await removeAuthenticatorPicker(requestId)
    return { kind: AuthenticatorPickerLoadKind.Unavailable }
  }
  return { kind: AuthenticatorPickerLoadKind.Available, request }
}

export function isAuthenticatorPickerSender(
  sender: chrome.runtime.MessageSender,
): boolean {
  if (sender.id !== chrome.runtime.id || !sender.url) return false
  try {
    const senderUrl = new URL(sender.url)
    return (
      senderUrl.origin === new URL(chrome.runtime.getURL('/')).origin &&
      senderUrl.pathname === '/popup/index.html'
    )
  } catch {
    return false
  }
}

type AuthenticatorAccountsArgs = {
  grants: StoredExtensionPairingGrant[]
  query: string
}

export async function authenticatorAccounts({
  grants,
  query,
}: AuthenticatorAccountsArgs): Promise<WebsiteAuthenticatorOption[]> {
  const accounts: WebsiteAuthenticatorOption[] = []
  for (const grant of grants) {
    const nookTypedArgs0_1: Parameters<typeof sendSessionMessage>[0] = {
      type: 'nook:extension-session-list-authenticators',
      payload: {
        ...extensionSessionGrantIdentity(grant),
        query,
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    }
    const response = await sendSessionMessage(nookTypedArgs0_1)
    const responseAccounts = sessionResponseAccounts(response)
    if (responseAccounts.kind === SessionAccountListKind.Invalid) continue
    for (const account of responseAccounts.accounts) {
      if (
        !account ||
        typeof account !== 'object' ||
        !('secretId' in account) ||
        typeof account.secretId !== 'string' ||
        !('issuer' in account) ||
        typeof account.issuer !== 'string' ||
        !('account' in account) ||
        typeof account.account !== 'string'
      ) {
        continue
      }
      const nookTypedArgs0_2: Parameters<typeof accounts.push>[0] = {
        vaultStoreId: grant.vaultStoreId,
        vaultName: grant.vaultName,
        secretId: account.secretId,
        issuer: account.issuer,
        account: account.account,
      }
      accounts.push(nookTypedArgs0_2)
    }
  }
  return accounts
}

type AuthorizedWebsiteGrantArgs = {
  origin: string
  vaultStoreId: string
  sender: chrome.runtime.MessageSender
  reasons: { forbidden: string; missing: string; locked: string }
}

export async function authorizedWebsiteGrant({
  origin,
  vaultStoreId,
  sender,
  reasons,
}: AuthorizedWebsiteGrantArgs): Promise<
  | { grant: StoredExtensionPairingGrant }
  | { response: { ok: false; reason: string } }
> {
  const nookTypedArgs0_3: Parameters<typeof isAuthorizedWebsiteSender>[0] = {
    sender,
    origin,
  }
  if (!isAuthorizedWebsiteSender(nookTypedArgs0_3)) {
    return { response: { ok: false, reason: reasons.forbidden } }
  }
  const grant = (await passwordPairingGrants()).find(
    (candidate) => candidate.vaultStoreId === vaultStoreId,
  )
  if (!grant) return { response: { ok: false, reason: reasons.missing } }
  await ensureExtensionSessionDocument()
  const queueExpiresAt = Date.now() + SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS
  const nookTypedArgs0_4: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-status',
    payload: { queue: extensionSessionInteractiveDeadline(queueExpiresAt) },
  }
  const status = await sendSessionMessage(nookTypedArgs0_4)
  if (!isUnlockedSessionStatus(status)) {
    openCompanionLauncherBestEffort(OpenCompanionLauncherIntent.Default)
    return { response: { ok: false, reason: reasons.locked } }
  }
  return { grant }
}

type LoginAccountsForOriginArgs = {
  grants: StoredExtensionPairingGrant[]
  origin: string
  query?: string
  queue?: ExtensionSessionQueue
  requireCompleteResponses?: boolean
}

export async function loginAccountsForOrigin({
  grants,
  origin,
  query = '',
  queue = MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
  requireCompleteResponses = false,
}: LoginAccountsForOriginArgs): Promise<WebsiteLoginAccountOption[]> {
  const accounts: WebsiteLoginAccountOption[] = []
  const needle = query.trim().toLowerCase()
  for (const grant of grants) {
    const nookTypedArgs0_5: Parameters<typeof sendSessionMessage>[0] = {
      type: 'nook:extension-session-list-logins',
      payload: {
        ...extensionSessionGrantIdentity(grant),
        origin,
        queue,
      },
    }
    const response = await sendSessionMessage(nookTypedArgs0_5)
    const responseAccounts = sessionResponseAccounts(response)
    if (responseAccounts.kind === SessionAccountListKind.Invalid) {
      if (requireCompleteResponses) {
        throw new Error('Extension session login lookup failed.')
      }
      continue
    }
    for (const account of responseAccounts.accounts) {
      if (
        !account ||
        typeof account !== 'object' ||
        !('secretId' in account) ||
        typeof account.secretId !== 'string' ||
        !('username' in account) ||
        typeof account.username !== 'string' ||
        !('websiteUrl' in account) ||
        typeof account.websiteUrl !== 'string' ||
        !('websiteHost' in account) ||
        typeof account.websiteHost !== 'string'
      ) {
        if (requireCompleteResponses) {
          throw new Error(
            'Extension session returned an invalid login account.',
          )
        }
        continue
      }
      const option: WebsiteLoginAccountOption = {
        vaultStoreId: grant.vaultStoreId,
        vaultName: grant.vaultName,
        secretId: account.secretId,
        username: account.username,
        websiteUrl: account.websiteUrl,
        websiteHost: account.websiteHost,
      }
      if (
        needle &&
        ![
          option.username,
          option.websiteHost,
          option.websiteUrl,
          option.vaultName,
        ].some((value) => value.toLowerCase().includes(needle))
      ) {
        continue
      }
      accounts.push(option)
    }
  }
  return accounts
}

const LOGIN_MATCH_LOOKUP_TIMEOUT_MS = 1_500
const LOGIN_MATCH_CACHE_TTL_MS = 2_000
const loginMatchCacheOptions: LoginMatchAvailabilityCacheOptions = {
  ttlMs: LOGIN_MATCH_CACHE_TTL_MS,
}
const loginMatchAvailabilityCache = new LoginMatchAvailabilityCache(
  loginMatchCacheOptions,
)

type LoginMatchAvailabilityCandidates = readonly [
  Promise<WebsiteLoginMatchAvailabilityWire>,
  Promise<WebsiteLoginMatchAvailabilityWire>,
]

enum LoginMatchAvailabilityKind {
  Ready = 'ready',
  Locked = 'locked',
  Unavailable = 'unavailable',
}

async function loginMatchAvailabilityForOrigin(
  origin: string,
): Promise<WebsiteLoginMatchAvailabilityWire> {
  const grants = await passwordPairingGrants()
  if (grants.length === 0) {
    return { kind: LoginMatchAvailabilityKind.Unavailable }
  }
  await ensureExtensionSessionDocument()
  const expiresAt = Date.now() + LOGIN_MATCH_LOOKUP_TIMEOUT_MS
  const nookTypedArgs0_6: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-status',
    payload: { queue: extensionSessionProbeDeadline(expiresAt) },
  }
  const status = await sendSessionMessage(nookTypedArgs0_6)
  if (!isUnlockedSessionStatus(status)) {
    return { kind: LoginMatchAvailabilityKind.Locked }
  }
  const nookTypedArgs0_7: Parameters<typeof loginAccountsForOrigin>[0] = {
    grants,
    origin,
    queue: extensionSessionProbeDeadline(expiresAt),
    requireCompleteResponses: true,
  }
  const accounts = await loginAccountsForOrigin(nookTypedArgs0_7)
  const currentGrantIds = (await passwordPairingGrants())
    .map((grant) => grant.vaultStoreId)
    .sort()
  const lookupGrantIds = grants.map((grant) => grant.vaultStoreId).sort()
  if (currentGrantIds.join(':') !== lookupGrantIds.join(':')) {
    return { kind: LoginMatchAvailabilityKind.Unavailable }
  }
  const finalStatusDeadline = Date.now() + LOGIN_MATCH_LOOKUP_TIMEOUT_MS
  const finalStatusArgs: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-status',
    payload: { queue: extensionSessionProbeDeadline(finalStatusDeadline) },
  }
  const finalStatus = await sendSessionMessage(finalStatusArgs)
  if (!isUnlockedSessionStatus(finalStatus)) {
    return { kind: LoginMatchAvailabilityKind.Locked }
  }
  return {
    kind: LoginMatchAvailabilityKind.Ready,
    count: accounts.length,
  }
}

async function loginMatchAvailabilityForOriginSafeUncached(
  origin: string,
): Promise<WebsiteLoginMatchAvailabilityWire> {
  const unavailable: WebsiteLoginMatchAvailabilityWire = {
    kind: LoginMatchAvailabilityKind.Unavailable,
  }
  try {
    const candidates: LoginMatchAvailabilityCandidates = [
      loginMatchAvailabilityForOrigin(origin),
      new Promise<WebsiteLoginMatchAvailabilityWire>((resolve) => {
        setTimeout(() => resolve(unavailable), LOGIN_MATCH_LOOKUP_TIMEOUT_MS)
      }),
    ]
    return await Promise.race(candidates)
  } catch {
    return unavailable
  }
}

export function invalidateLoginMatchAvailabilityForOrigin(
  request: LoginMatchAvailabilityCacheInvalidation,
): void {
  loginMatchAvailabilityCache.invalidate(request)
}

export function invalidateAllLoginMatchAvailability(): void {
  loginMatchAvailabilityCache.invalidateAll()
}

export function loginMatchAvailabilityForOriginSafe(
  origin: string,
): Promise<WebsiteLoginMatchAvailabilityWire> {
  const request: LoginMatchAvailabilityCacheRequest = {
    origin,
    load: () => loginMatchAvailabilityForOriginSafeUncached(origin),
  }
  return loginMatchAvailabilityCache.resolve(request)
}

type WebsiteLoginOptionsArgs = {
  message: {
    payload: {
      origin: string
    }
  }
  sender: chrome.runtime.MessageSender
}

export async function websiteLoginOptions({
  message,
  sender,
}: WebsiteLoginOptionsArgs): Promise<unknown> {
  const nookTypedArgs0_6: Parameters<typeof availableWebsiteGrants>[0] = {
    origin: message.payload.origin,
    sender,
    forbiddenReason: 'login-forbidden-origin',
  }
  const access = await availableWebsiteGrants(nookTypedArgs0_6)
  if ('response' in access) return access.response

  const nookTypedArgs0_0: Parameters<typeof loginAccountsForOrigin>[0] = {
    grants: access.grants,
    origin: message.payload.origin,
  }
  const accounts = await loginAccountsForOrigin(nookTypedArgs0_0)
  return { ok: true, status: 'ready', accounts }
}

function loginPickerStorageKey(requestId: string): string {
  return `${LOGIN_PICKER_STORAGE_PREFIX}${requestId}`
}

function isPendingLoginPicker(value: unknown): value is PendingLoginPicker {
  return isPendingAuthenticatorPicker(value)
}

export async function storeLoginPicker(
  request: PendingLoginPicker,
): Promise<void> {
  pendingLoginPickers.set(request.requestId, request)
  const nookTypedArgs0_7: Parameters<typeof setSessionStorage>[0] = {
    [loginPickerStorageKey(request.requestId)]: request,
  }
  await setSessionStorage(nookTypedArgs0_7)
}

export async function removeLoginPicker(requestId: string): Promise<void> {
  pendingLoginPickers.delete(requestId)
  await removeSessionStorage(loginPickerStorageKey(requestId))
}

export enum LoginPickerLoadKind {
  Available = 'available',
  Unavailable = 'unavailable',
}

export type LoginPickerLoad =
  | { kind: LoginPickerLoadKind.Available; request: PendingLoginPicker }
  | { kind: LoginPickerLoadKind.Unavailable }

export async function loadLoginPicker(
  requestId: string,
): Promise<LoginPickerLoad> {
  let request = pendingLoginPickers.get(requestId)
  if (!request) {
    const key = loginPickerStorageKey(requestId)
    const stored = (await getSessionStorage(key))[key]
    if (!isPendingLoginPicker(stored) || stored.requestId !== requestId) {
      if (stored) await removeSessionStorage(key)
      return { kind: LoginPickerLoadKind.Unavailable }
    }
    request = stored
    pendingLoginPickers.set(requestId, request)
  }
  if (request.expiresAt <= Date.now()) {
    await removeLoginPicker(requestId)
    return { kind: LoginPickerLoadKind.Unavailable }
  }
  return { kind: LoginPickerLoadKind.Available, request }
}

export function isLoginPickerSender(
  sender: chrome.runtime.MessageSender,
): boolean {
  return isAuthenticatorPickerSender(sender)
}
