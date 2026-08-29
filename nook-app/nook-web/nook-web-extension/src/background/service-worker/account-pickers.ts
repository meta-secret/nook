import {
  WebsiteAuthenticatorResponseStatus,
  type WebsiteAuthenticatorOption,
  type WebsiteLoginAccountOption,
} from '../../lib/login-fill-messages'
import {
  decode_website_login_match_availability,
  type WebsiteLoginMatchAvailability,
  type WebsiteLoginOptionsWireValue,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  WebsiteAuthenticatorCanceledMessageType,
  type WebsiteAuthenticatorCanceledMessage,
} from '../../lib/authenticator-picker-messages'
import {
  WebsiteLoginCanceledMessageType,
  type WebsiteLoginCanceledMessage,
} from '../../lib/login-picker-messages'
import { OpenCompanionLauncherIntent } from '../../../../nook-web-shared/src/extension/companion-launcher-message'
import {
  extensionSessionGrantIdentity,
  type StoredExtensionPairingGrant,
} from '../pairing-grants'
import {
  extensionSessionInteractiveDeadline,
  extensionSessionProbeDeadline,
  MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
  type ExtensionSessionQueue,
} from '../../offscreen/session-request-adapter'
import {
  availableWebsiteGrants,
  getAllSessionStorage,
  getSessionStorage,
  isAuthorizedWebsiteSender,
  passwordPairingGrants,
  passiveAvailableWebsiteGrants,
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
const ACCOUNT_PICKER_CLEANUP_STORAGE_KEY =
  'nook.extension.account-picker-cleanup'

const pendingAuthenticatorPickers = new Map<
  string,
  PendingAuthenticatorPicker
>()
const pendingLoginPickers = new Map<string, PendingLoginPicker>()

enum AccountPickerAuthorizationPhase {
  Active = 'active',
  Cleaning = 'cleaning',
}

type AccountPickerAuthorizationLifecycle =
  | {
      phase: AccountPickerAuthorizationPhase.Active
      generation: number
    }
  | {
      phase: AccountPickerAuthorizationPhase.Cleaning
      generation: number
      cleanupCount: number
    }

export class AccountPickerAuthorizationState {
  private lifecycle: AccountPickerAuthorizationLifecycle = {
    phase: AccountPickerAuthorizationPhase.Active,
    generation: 0,
  }

  snapshot(): number {
    return this.lifecycle.generation
  }

  beginCleanup(): number {
    if (this.lifecycle.phase === AccountPickerAuthorizationPhase.Active) {
      this.lifecycle = {
        phase: AccountPickerAuthorizationPhase.Cleaning,
        generation: this.lifecycle.generation + 1,
        cleanupCount: 1,
      }
    } else {
      this.lifecycle = {
        ...this.lifecycle,
        cleanupCount: this.lifecycle.cleanupCount + 1,
      }
    }
    return this.lifecycle.generation
  }

  completeCleanup(candidate: number): boolean {
    if (
      this.lifecycle.phase !== AccountPickerAuthorizationPhase.Cleaning ||
      candidate !== this.lifecycle.generation
    ) {
      return false
    }
    if (this.lifecycle.cleanupCount > 1) {
      this.lifecycle = {
        ...this.lifecycle,
        cleanupCount: this.lifecycle.cleanupCount - 1,
      }
    } else {
      this.lifecycle = {
        phase: AccountPickerAuthorizationPhase.Active,
        generation: this.lifecycle.generation,
      }
    }
    return this.lifecycle.phase === AccountPickerAuthorizationPhase.Active
  }

  isFinalCleanup(candidate: number): boolean {
    return (
      this.lifecycle.phase === AccountPickerAuthorizationPhase.Cleaning &&
      candidate === this.lifecycle.generation &&
      this.lifecycle.cleanupCount === 1
    )
  }

  releaseCleanup(candidate: number): void {
    if (
      this.lifecycle.phase !== AccountPickerAuthorizationPhase.Cleaning ||
      candidate !== this.lifecycle.generation ||
      this.lifecycle.cleanupCount === 0
    ) {
      return
    }
    this.lifecycle = {
      ...this.lifecycle,
      cleanupCount: this.lifecycle.cleanupCount - 1,
    }
  }

  isCurrent(candidate: number): boolean {
    return (
      this.lifecycle.phase === AccountPickerAuthorizationPhase.Active &&
      candidate === this.lifecycle.generation
    )
  }
}

const accountPickerAuthorizationState = new AccountPickerAuthorizationState()

export function accountPickerAuthorizationGeneration(): number {
  return accountPickerAuthorizationState.snapshot()
}

export function accountPickerAuthorizationIsCurrent(
  authorizationGeneration: number,
): boolean {
  return accountPickerAuthorizationState.isCurrent(authorizationGeneration)
}

export enum AccountPickerCleanupMarkerStatus {
  Persisted = 'persisted',
  Unavailable = 'unavailable',
}

export type AccountPickerAuthorizationCleanupStart = {
  authorizationGeneration: number
  markerStatus: AccountPickerCleanupMarkerStatus
}

export async function beginAccountPickerAuthorizationCleanup(): Promise<AccountPickerAuthorizationCleanupStart> {
  const generation = accountPickerAuthorizationState.beginCleanup()
  const cleanupStorage: Parameters<typeof setSessionStorage>[0] = {
    [ACCOUNT_PICKER_CLEANUP_STORAGE_KEY]: true,
  }
  try {
    await setSessionStorage(cleanupStorage)
    return {
      authorizationGeneration: generation,
      markerStatus: AccountPickerCleanupMarkerStatus.Persisted,
    }
  } catch {
    return {
      authorizationGeneration: generation,
      markerStatus: AccountPickerCleanupMarkerStatus.Unavailable,
    }
  }
}

export async function completeAccountPickerAuthorizationCleanup(
  authorizationGeneration: number,
): Promise<void> {
  try {
    if (
      accountPickerAuthorizationState.isFinalCleanup(authorizationGeneration)
    ) {
      await removeSessionStorage(ACCOUNT_PICKER_CLEANUP_STORAGE_KEY)
    }
    accountPickerAuthorizationState.completeCleanup(authorizationGeneration)
  } catch (error) {
    accountPickerAuthorizationState.releaseCleanup(authorizationGeneration)
    throw error
  }
}

export function releaseAccountPickerAuthorizationCleanup(
  authorizationGeneration: number,
): void {
  accountPickerAuthorizationState.releaseCleanup(authorizationGeneration)
}

export async function accountPickerAuthorizationCleanupPending(): Promise<boolean> {
  const cleanupStorage = await getSessionStorage(
    ACCOUNT_PICKER_CLEANUP_STORAGE_KEY,
  )
  return cleanupStorage[ACCOUNT_PICKER_CLEANUP_STORAGE_KEY] === true
}

export enum AccountPickerSurfaceKind {
  None = 'none',
  Tab = 'tab',
  Window = 'window',
}

export type AccountPickerSurface =
  | { kind: AccountPickerSurfaceKind.None }
  | { kind: AccountPickerSurfaceKind.Tab; id: number }
  | { kind: AccountPickerSurfaceKind.Window; id: number }

export function emptyAccountPickerSurface(): AccountPickerSurface {
  return { kind: AccountPickerSurfaceKind.None }
}

export async function closeAccountPickerSurface(
  surface: AccountPickerSurface,
): Promise<void> {
  if (surface.kind === AccountPickerSurfaceKind.Window) {
    const windows = chrome.windows as typeof chrome.windows & {
      remove?: (windowId: number) => Promise<void>
    }
    if (windows.remove) await windows.remove(surface.id)
    return
  }
  if (surface.kind === AccountPickerSurfaceKind.Tab) {
    const tabs = chrome.tabs as typeof chrome.tabs & {
      remove: (tabId: number) => Promise<void>
    }
    await tabs.remove(surface.id)
  }
}

type PendingAccountPickerMemoryCleanupArgs = {
  authenticatorRequests: Map<string, PendingAuthenticatorPicker>
  loginRequests: Map<string, PendingLoginPicker>
}

type AccountPickerCancellation = {
  tabId: number
  message: WebsiteAuthenticatorCanceledMessage | WebsiteLoginCanceledMessage
}

type AccountPickerSurfaceRemovalArgs = [number, () => void]
type RemoveAccountPickerSurface = (
  ...args: AccountPickerSurfaceRemovalArgs
) => void

export function takePendingAccountPickerMemoryCleanup({
  authenticatorRequests,
  loginRequests,
}: PendingAccountPickerMemoryCleanupArgs): AccountPickerCancellation[] {
  const cancellations: AccountPickerCancellation[] = [
    ...Array.from(authenticatorRequests.values(), (request) => ({
      tabId: request.tabId,
      message: {
        type: WebsiteAuthenticatorCanceledMessageType.NookWebsiteAuthenticatorCanceled,
        payload: { origin: request.origin, requestId: request.requestId },
      },
    })),
    ...Array.from(loginRequests.values(), (request) => ({
      tabId: request.tabId,
      message: {
        type: WebsiteLoginCanceledMessageType.NookWebsiteLoginCanceled,
        payload: { origin: request.origin, requestId: request.requestId },
      },
    })),
  ]
  authenticatorRequests.clear()
  loginRequests.clear()
  return cancellations
}

export type PersistedAccountPickerCleanupPlan = {
  storageKeys: string[]
  cancellations: AccountPickerCancellation[]
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
        const targetedCancellation: AccountPickerCancellation = {
          tabId: value.tabId,
          message: cancellation,
        }
        cancellations.push(targetedCancellation)
      }
    } else if (key.startsWith(LOGIN_PICKER_STORAGE_PREFIX)) {
      storageKeys.push(key)
      if (isPendingAuthenticatorPicker(value)) {
        const cancellation: WebsiteLoginCanceledMessage = {
          type: WebsiteLoginCanceledMessageType.NookWebsiteLoginCanceled,
          payload: { origin: value.origin, requestId: value.requestId },
        }
        const targetedCancellation: AccountPickerCancellation = {
          tabId: value.tabId,
          message: cancellation,
        }
        cancellations.push(targetedCancellation)
      }
    }
  }
  return { storageKeys, cancellations }
}

export async function clearPendingAccountPickers(): Promise<void> {
  const memoryCleanupArgs: PendingAccountPickerMemoryCleanupArgs = {
    authenticatorRequests: pendingAuthenticatorPickers,
    loginRequests: pendingLoginPickers,
  }
  const memoryCancellations =
    takePendingAccountPickerMemoryCleanup(memoryCleanupArgs)
  const memoryDelivery = Promise.allSettled(
    memoryCancellations.map(({ tabId, message }) =>
      chrome.tabs.sendMessage(tabId, message),
    ),
  )
  const plan = persistedAccountPickerCleanupPlan(await getAllSessionStorage())
  const persistedDelivery = Promise.allSettled(
    plan.cancellations.map(({ tabId, message }) =>
      chrome.tabs.sendMessage(tabId, message),
    ),
  )
  const removals = await Promise.allSettled(
    plan.storageKeys.map(removeSessionStorage),
  )
  const pickerSurfaceQuery: Parameters<typeof chrome.tabs.query>[0] = {}
  const pickerSurfaceTabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
    chrome.tabs.query(pickerSurfaceQuery, resolve)
  })
  const pickerSurfaceTabIds = pickerSurfaceTabs.flatMap((tab) => {
    if (
      !('id' in tab) ||
      typeof tab.id !== 'number' ||
      !('url' in tab) ||
      typeof tab.url !== 'string'
    ) {
      return []
    }
    if (!tab.url.startsWith(chrome.runtime.getURL('popup/index.html'))) {
      return []
    }
    const intent = new URL(tab.url).searchParams.get('intent')
    return intent === 'login-picker' || intent === 'authenticator-picker'
      ? [tab.id]
      : []
  })
  const surfaceRemoval = Promise.allSettled(
    pickerSurfaceTabIds.map(
      (tabId) =>
        new Promise<void>((resolve) => {
          const tabs = chrome.tabs as typeof chrome.tabs & {
            remove: RemoveAccountPickerSurface
          }
          const removeArgs: Parameters<typeof tabs.remove> = [tabId, resolve]
          tabs.remove(...removeArgs)
        }),
    ),
  )
  await memoryDelivery
  await persistedDelivery
  if (
    removals.some((result) => result.status === 'rejected') ||
    (await surfaceRemoval).some((result) => result.status === 'rejected')
  ) {
    throw new Error('account picker storage removal failed')
  }
}

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

type StoreAuthenticatorPickerArgs = {
  request: PendingAuthenticatorPicker
  authorizationGeneration: number
}

export async function storeAuthenticatorPicker({
  request,
  authorizationGeneration,
}: StoreAuthenticatorPickerArgs): Promise<boolean> {
  if (!accountPickerAuthorizationState.isCurrent(authorizationGeneration)) {
    return false
  }
  if (await accountPickerAuthorizationCleanupPending()) return false
  pendingAuthenticatorPickers.set(request.requestId, request)
  const nookTypedArgs0_0: Parameters<typeof setSessionStorage>[0] = {
    [authenticatorPickerStorageKey(request.requestId)]: request,
  }
  await setSessionStorage(nookTypedArgs0_0)
  if (accountPickerAuthorizationState.isCurrent(authorizationGeneration)) {
    return true
  }
  pendingAuthenticatorPickers.delete(request.requestId)
  await removeSessionStorage(authenticatorPickerStorageKey(request.requestId))
  return false
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
      authorizationGeneration: number
    }
  | { kind: AuthenticatorPickerLoadKind.Unavailable }

export async function loadAuthenticatorPicker(
  requestId: string,
): Promise<AuthenticatorPickerLoad> {
  const authorizationGeneration = accountPickerAuthorizationState.snapshot()
  if (!accountPickerAuthorizationState.isCurrent(authorizationGeneration)) {
    return { kind: AuthenticatorPickerLoadKind.Unavailable }
  }
  const cleanupStorage = await getSessionStorage(
    ACCOUNT_PICKER_CLEANUP_STORAGE_KEY,
  )
  if (
    cleanupStorage[ACCOUNT_PICKER_CLEANUP_STORAGE_KEY] === true ||
    !accountPickerAuthorizationState.isCurrent(authorizationGeneration)
  ) {
    return { kind: AuthenticatorPickerLoadKind.Unavailable }
  }
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
    if (!accountPickerAuthorizationState.isCurrent(authorizationGeneration)) {
      return { kind: AuthenticatorPickerLoadKind.Unavailable }
    }
    request = stored
    pendingAuthenticatorPickers.set(requestId, request)
  }
  if (request.expiresAt <= Date.now()) {
    await removeAuthenticatorPicker(requestId)
    return { kind: AuthenticatorPickerLoadKind.Unavailable }
  }
  return {
    kind: AuthenticatorPickerLoadKind.Available,
    request,
    authorizationGeneration,
  }
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
  sendMessage?: typeof sendSessionMessage
}

type LoginAccountAvailabilityForOriginArgs = LoginAccountsForOriginArgs & {
  queue: ExtensionSessionQueue
  sendMessage?: typeof sendSessionMessage
}

type LoginAccountAvailability =
  { ok: true; accounts: WebsiteLoginAccountOption[] } | { ok: false }

type LoginAccountListForOriginArgs = LoginAccountAvailabilityForOriginArgs & {
  failClosed: boolean
}

async function loginAccountListForOrigin({
  grants,
  origin,
  query = '',
  queue,
  sendMessage = sendSessionMessage,
  failClosed,
}: LoginAccountListForOriginArgs): Promise<LoginAccountAvailability> {
  const accounts: WebsiteLoginAccountOption[] = []
  let receivedValidResponse = false
  const needle = query.trim().toLowerCase()
  for (const grant of grants) {
    const request: Parameters<typeof sendSessionMessage>[0] = {
      type: 'nook:extension-session-list-logins',
      payload: {
        ...extensionSessionGrantIdentity(grant),
        origin,
        queue,
      },
    }
    let response: Awaited<ReturnType<typeof sendSessionMessage>>
    try {
      response = await sendMessage(request)
    } catch {
      if (failClosed) return { ok: false }
      continue
    }
    if (
      !response ||
      typeof response !== 'object' ||
      !('ok' in response) ||
      response.ok !== true ||
      !('accounts' in response) ||
      !Array.isArray(response.accounts)
    ) {
      if (failClosed) return { ok: false }
      continue
    }
    receivedValidResponse = true
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
        if (failClosed) return { ok: false }
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
  return receivedValidResponse ? { ok: true, accounts } : { ok: false }
}

export async function loginAccountAvailabilityForOrigin(
  args: LoginAccountAvailabilityForOriginArgs,
): Promise<LoginAccountAvailability> {
  const request: LoginAccountListForOriginArgs = {
    ...args,
    failClosed: true,
  }
  return loginAccountListForOrigin(request)
}

export async function loginAccountsForOrigin({
  grants,
  origin,
  query = '',
  sendMessage = sendSessionMessage,
}: LoginAccountsForOriginArgs): Promise<WebsiteLoginAccountOption[]> {
  const request: LoginAccountListForOriginArgs = {
    grants,
    origin,
    query,
    sendMessage,
    queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    failClosed: false,
  }
  const result = await loginAccountListForOrigin(request)
  return result.ok ? result.accounts : []
}

type WebsiteLoginOptionsArgs = {
  message: {
    payload: {
      origin: string
    }
  }
  sender: chrome.runtime.MessageSender
  dependencies?: WebsiteLoginOptionsDependencies
}

type WebsiteLoginOptionsDependencies = {
  availableWebsiteGrants: typeof availableWebsiteGrants
  passiveAvailableWebsiteGrants: typeof passiveAvailableWebsiteGrants
  loginAccountsForOrigin: typeof loginAccountsForOrigin
  loginAccountAvailabilityForOrigin: typeof loginAccountAvailabilityForOrigin
  openCompanionLauncherBestEffort: typeof openCompanionLauncherBestEffort
}

const websiteLoginOptionsDependencies: WebsiteLoginOptionsDependencies = {
  availableWebsiteGrants,
  passiveAvailableWebsiteGrants,
  loginAccountsForOrigin,
  loginAccountAvailabilityForOrigin,
  openCompanionLauncherBestEffort,
}

type WebsiteLoginOptionsResponseArgs = WebsiteLoginOptionsArgs & {
  openUnavailableCompanion: boolean
}

async function websiteLoginOptionsResponse({
  message,
  sender,
  dependencies,
  openUnavailableCompanion,
}: WebsiteLoginOptionsResponseArgs): Promise<unknown> {
  const resolvedDependencies = dependencies ?? websiteLoginOptionsDependencies
  const nookTypedArgs0_6: Parameters<typeof availableWebsiteGrants>[0] = {
    origin: message.payload.origin,
    sender,
    forbiddenReason: 'login-forbidden-origin',
  }
  const grantsProbe = openUnavailableCompanion
    ? resolvedDependencies.availableWebsiteGrants
    : resolvedDependencies.passiveAvailableWebsiteGrants
  const access = await grantsProbe(nookTypedArgs0_6)
  if ('response' in access) {
    if (
      access.response.ok &&
      access.response.status ===
        WebsiteAuthenticatorResponseStatus.Unavailable &&
      openUnavailableCompanion
    ) {
      resolvedDependencies.openCompanionLauncherBestEffort(
        OpenCompanionLauncherIntent.Pair,
      )
    }
    return access.response
  }

  let accounts: WebsiteLoginAccountOption[]
  if (openUnavailableCompanion) {
    const accountRequest: Parameters<typeof loginAccountsForOrigin>[0] = {
      grants: access.grants,
      origin: message.payload.origin,
    }
    accounts = await resolvedDependencies.loginAccountsForOrigin(accountRequest)
  } else {
    const queueExpiresAt = Date.now() + SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS
    const accountRequest: LoginAccountAvailabilityForOriginArgs = {
      grants: access.grants,
      origin: message.payload.origin,
      queue: extensionSessionProbeDeadline(queueExpiresAt),
    }
    const availability =
      await resolvedDependencies.loginAccountAvailabilityForOrigin(
        accountRequest,
      )
    if (!availability.ok) {
      return { ok: false, reason: 'login-options-unavailable' }
    }
    accounts = availability.accounts
  }
  return { ok: true, status: 'ready', accounts }
}

export async function websiteLoginOptions(
  args: WebsiteLoginOptionsArgs,
): Promise<unknown> {
  const responseRequest: WebsiteLoginOptionsResponseArgs = {
    ...args,
    openUnavailableCompanion: true,
  }
  return websiteLoginOptionsResponse(responseRequest)
}

type WebsiteLoginMatchAvailabilityArgs = {
  origin: string
  sender: chrome.runtime.MessageSender
  dependencies?: WebsiteLoginOptionsDependencies
}

export async function websiteLoginMatchAvailability({
  origin,
  sender,
  dependencies,
}: WebsiteLoginMatchAvailabilityArgs): Promise<WebsiteLoginMatchAvailability> {
  const message: WebsiteLoginOptionsArgs['message'] = {
    payload: { origin },
  }
  const responseRequest: WebsiteLoginOptionsResponseArgs = {
    message,
    sender,
    dependencies,
    openUnavailableCompanion: false,
  }
  const response = await websiteLoginOptionsResponse(responseRequest)
  return decode_website_login_match_availability(
    response as WebsiteLoginOptionsWireValue,
  )
}

function loginPickerStorageKey(requestId: string): string {
  return `${LOGIN_PICKER_STORAGE_PREFIX}${requestId}`
}

function isPendingLoginPicker(value: unknown): value is PendingLoginPicker {
  return isPendingAuthenticatorPicker(value)
}

type StoreLoginPickerArgs = {
  request: PendingLoginPicker
  authorizationGeneration: number
}

export async function storeLoginPicker({
  request,
  authorizationGeneration,
}: StoreLoginPickerArgs): Promise<boolean> {
  if (!accountPickerAuthorizationState.isCurrent(authorizationGeneration)) {
    return false
  }
  if (await accountPickerAuthorizationCleanupPending()) return false
  pendingLoginPickers.set(request.requestId, request)
  const nookTypedArgs0_7: Parameters<typeof setSessionStorage>[0] = {
    [loginPickerStorageKey(request.requestId)]: request,
  }
  await setSessionStorage(nookTypedArgs0_7)
  if (accountPickerAuthorizationState.isCurrent(authorizationGeneration)) {
    return true
  }
  pendingLoginPickers.delete(request.requestId)
  await removeSessionStorage(loginPickerStorageKey(request.requestId))
  return false
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
  | {
      kind: LoginPickerLoadKind.Available
      request: PendingLoginPicker
      authorizationGeneration: number
    }
  | { kind: LoginPickerLoadKind.Unavailable }

export async function loadLoginPicker(
  requestId: string,
): Promise<LoginPickerLoad> {
  const authorizationGeneration = accountPickerAuthorizationState.snapshot()
  if (!accountPickerAuthorizationState.isCurrent(authorizationGeneration)) {
    return { kind: LoginPickerLoadKind.Unavailable }
  }
  const cleanupStorage = await getSessionStorage(
    ACCOUNT_PICKER_CLEANUP_STORAGE_KEY,
  )
  if (
    cleanupStorage[ACCOUNT_PICKER_CLEANUP_STORAGE_KEY] === true ||
    !accountPickerAuthorizationState.isCurrent(authorizationGeneration)
  ) {
    return { kind: LoginPickerLoadKind.Unavailable }
  }
  let request = pendingLoginPickers.get(requestId)
  if (!request) {
    const key = loginPickerStorageKey(requestId)
    const stored = (await getSessionStorage(key))[key]
    if (!isPendingLoginPicker(stored) || stored.requestId !== requestId) {
      if (stored) await removeSessionStorage(key)
      return { kind: LoginPickerLoadKind.Unavailable }
    }
    if (!accountPickerAuthorizationState.isCurrent(authorizationGeneration)) {
      return { kind: LoginPickerLoadKind.Unavailable }
    }
    request = stored
    pendingLoginPickers.set(requestId, request)
  }
  if (request.expiresAt <= Date.now()) {
    await removeLoginPicker(requestId)
    return { kind: LoginPickerLoadKind.Unavailable }
  }
  return {
    kind: LoginPickerLoadKind.Available,
    request,
    authorizationGeneration,
  }
}

export function isLoginPickerSender(
  sender: chrome.runtime.MessageSender,
): boolean {
  return isAuthenticatorPickerSender(sender)
}
