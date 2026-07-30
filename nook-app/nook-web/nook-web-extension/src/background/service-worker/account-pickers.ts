import {
  type WebsiteAuthenticatorOption,
  type WebsiteLoginAccountOption,
} from '../../lib/login-fill-messages'
import type { StoredExtensionPairingGrant } from '../pairing-grants'
import {
  availableWebsiteGrants,
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
  openCompanionLauncher,
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

function sessionResponseAccounts(response: unknown): unknown[] {
  if (
    !response ||
    typeof response !== 'object' ||
    !('ok' in response) ||
    response.ok !== true ||
    !('accounts' in response) ||
    !Array.isArray(response.accounts)
  ) {
    return []
  }
  return response.accounts
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
  await setSessionStorage({
    [authenticatorPickerStorageKey(request.requestId)]: request,
  })
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

export async function authenticatorAccounts(
  grants: StoredExtensionPairingGrant[],
  query: string,
): Promise<WebsiteAuthenticatorOption[]> {
  const accounts: WebsiteAuthenticatorOption[] = []
  for (const grant of grants) {
    const response = await sendSessionMessage({
      type: 'nook:extension-session-list-authenticators',
      payload: { ...grant, query },
    })
    for (const account of sessionResponseAccounts(response)) {
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
      accounts.push({
        vaultStoreId: grant.vaultStoreId,
        vaultName: grant.vaultName,
        secretId: account.secretId,
        issuer: account.issuer,
        account: account.account,
      })
    }
  }
  return accounts
}

export async function authorizedWebsiteGrant(
  origin: string,
  vaultStoreId: string,
  sender: chrome.runtime.MessageSender,
  reasons: { forbidden: string; missing: string; locked: string },
): Promise<
  | { grant: StoredExtensionPairingGrant }
  | { response: { ok: false; reason: string } }
> {
  if (!isAuthorizedWebsiteSender(sender, origin)) {
    return { response: { ok: false, reason: reasons.forbidden } }
  }
  const grant = (await passwordPairingGrants()).find(
    (candidate) => candidate.vaultStoreId === vaultStoreId,
  )
  if (!grant) return { response: { ok: false, reason: reasons.missing } }
  await ensureExtensionSessionDocument()
  const queueExpiresAt = Date.now() + SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS
  const status = await sendSessionMessage({
    type: 'nook:extension-session-status',
    payload: { queueExpiresAt, queuePriority: 'interactive' },
  })
  if (!isUnlockedSessionStatus(status)) {
    openCompanionLauncher()
    return { response: { ok: false, reason: reasons.locked } }
  }
  return { grant }
}

export async function loginAccountsForOrigin(
  grants: StoredExtensionPairingGrant[],
  origin: string,
  query = '',
): Promise<WebsiteLoginAccountOption[]> {
  const accounts: WebsiteLoginAccountOption[] = []
  const needle = query.trim().toLowerCase()
  for (const grant of grants) {
    const response = await sendSessionMessage({
      type: 'nook:extension-session-list-logins',
      payload: { ...grant, origin },
    })
    for (const account of sessionResponseAccounts(response)) {
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

export async function websiteLoginOptions(
  message: {
    payload: {
      origin: string
    }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const access = await availableWebsiteGrants(
    message.payload.origin,
    sender,
    'login-forbidden-origin',
  )
  if ('response' in access) return access.response

  const accounts = await loginAccountsForOrigin(
    access.grants,
    message.payload.origin,
  )
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
  await setSessionStorage({
    [loginPickerStorageKey(request.requestId)]: request,
  })
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
