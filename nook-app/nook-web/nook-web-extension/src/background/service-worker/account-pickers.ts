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
import { extensionPairingIdentity } from './pairing-identity'
import {
  SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS,
  extensionSessionLifecycle,
} from './session-lifecycle'

type PendingAuthenticatorPicker = {
  requestId: string
  origin: string
  tabId: number
  frameId: number
  allowedVaultStoreIds: string[]
  expiresAt: number
}

type PendingLoginPicker = PendingAuthenticatorPicker

export const AUTHENTICATOR_PICKER_TTL_MS = 5 * 60 * 1000

export const LOGIN_PICKER_TTL_MS = 5 * 60 * 1000

const AUTHENTICATOR_PICKER_STORAGE_PREFIX =
  'nook.extension.authenticator-picker.'

const LOGIN_PICKER_STORAGE_PREFIX = 'nook.extension.login-picker.'

export {
  ACCOUNT_PICKER_CLEANUP_STORAGE_KEY,
  AccountPickerCleanupMarkerStatus,
  accountPickerAuthorizationCleanupPending,
  accountPickerAuthorizationGeneration,
  accountPickerAuthorizationIsCurrent,
  beginAccountPickerAuthorizationCleanup,
  completeAccountPickerAuthorizationCleanup,
  releaseAccountPickerAuthorizationCleanup,
} from './account-picker-authorization'

export type { AccountPickerAuthorizationCleanupStart } from './account-picker-authorization'
import {
  ACCOUNT_PICKER_CLEANUP_STORAGE_KEY,
  accountPickerAuthorizationCleanupPending,
  accountPickerAuthorizationGeneration,
  accountPickerAuthorizationIsCurrent,
} from './account-picker-authorization'

export enum AccountPickerSurfaceKind {
  None = 'none',
  Tab = 'tab',
  Window = 'window',
}

export type AccountPickerSurface =
  | { kind: AccountPickerSurfaceKind.None }
  | { kind: AccountPickerSurfaceKind.Tab; id: number }
  | { kind: AccountPickerSurfaceKind.Window; id: number }

type PendingAccountPickerMemoryCleanupArgs = {
  authenticatorRequests: Map<string, PendingAuthenticatorPicker>
  loginRequests: Map<string, PendingLoginPicker>
}

type AccountPickerCancellation = {
  tabId: number
  frameId: number
  message: WebsiteAuthenticatorCanceledMessage | WebsiteLoginCanceledMessage
}

type AccountPickerPageMessageDelivery = {
  tabId: number
  frameId: number
  message: unknown
}

type AccountPickerPageSenderMatch = {
  tabId: number
  frameId: number
  sender: chrome.runtime.MessageSender
}

export class AccountPickerPageTarget {
  static senderFrameId(sender: chrome.runtime.MessageSender): number {
    return typeof sender.frameId === 'number' &&
      Number.isInteger(sender.frameId) &&
      sender.frameId >= 0
      ? sender.frameId
      : 0
  }

  static matchesSender({
    tabId,
    frameId,
    sender,
  }: AccountPickerPageSenderMatch): boolean {
    return (
      !!sender.tab &&
      'id' in sender.tab &&
      sender.tab.id === tabId &&
      AccountPickerPageTarget.senderFrameId(sender) === frameId
    )
  }

  static send({
    tabId,
    frameId,
    message,
  }: AccountPickerPageMessageDelivery): Promise<unknown> {
    const options: ChromeTabMessageOptions = { frameId }
    return chrome.tabs.sendMessage(tabId, message, options)
  }
}

type AccountPickerSurfaceRemovalArgs = [number, () => void]

type RemoveAccountPickerSurface = (
  ...args: AccountPickerSurfaceRemovalArgs
) => void

export type PersistedAccountPickerCleanupPlan = {
  storageKeys: string[]
  cancellations: AccountPickerCancellation[]
}

export type PersistedAccountPickerStorage = Record<string, unknown>

type StoreAuthenticatorPickerArgs = {
  request: PendingAuthenticatorPicker
  authorizationGeneration: string
}

export enum AuthenticatorPickerLoadKind {
  Available = 'available',
  Unavailable = 'unavailable',
}

export type AuthenticatorPickerLoad =
  | {
      kind: AuthenticatorPickerLoadKind.Available
      request: PendingAuthenticatorPicker
      authorizationGeneration: string
    }
  | { kind: AuthenticatorPickerLoadKind.Unavailable }

type AuthenticatorAccountsArgs = {
  grants: StoredExtensionPairingGrant[]
  query: string
}

type AuthorizedWebsiteGrantArgs = {
  origin: string
  vaultStoreId: string
  sender: chrome.runtime.MessageSender
  reasons: { forbidden: string; missing: string; locked: string }
}

type LoginAccountsForOriginArgs = {
  grants: StoredExtensionPairingGrant[]
  origin: string
  query?: string
  sendMessage?: typeof extensionPairingIdentity.sendSessionMessage
}

type LoginAccountAvailabilityForOriginArgs = LoginAccountsForOriginArgs & {
  queue: ExtensionSessionQueue
  sendMessage?: typeof extensionPairingIdentity.sendSessionMessage
}

type LoginAccountAvailability =
  { ok: true; accounts: WebsiteLoginAccountOption[] } | { ok: false }

type LoginAccountListForOriginArgs = LoginAccountAvailabilityForOriginArgs & {
  failClosed: boolean
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
  accountPickerAuthorizationCleanupPending: typeof accountPickerAuthorizationCleanupPending
  accountPickerAuthorizationGeneration: typeof accountPickerAuthorizationGeneration
  accountPickerAuthorizationIsCurrent: typeof accountPickerAuthorizationIsCurrent
  availableWebsiteGrants: typeof extensionPairingIdentity.availableWebsiteGrants
  passiveAvailableWebsiteGrants: typeof extensionPairingIdentity.passiveAvailableWebsiteGrants
  loginAccountsForOrigin: typeof accountPickerSessions.loginAccountsForOrigin
  loginAccountAvailabilityForOrigin: typeof accountPickerSessions.loginAccountAvailabilityForOrigin
  openCompanionLauncherBestEffort: typeof extensionSessionLifecycle.openCompanionLauncherBestEffort
}

type WebsiteLoginOptionsResponseArgs = WebsiteLoginOptionsArgs & {
  openUnavailableCompanion: boolean
}

type WebsiteLoginMatchAvailabilityArgs = {
  origin: string
  sender: chrome.runtime.MessageSender
  dependencies?: WebsiteLoginOptionsDependencies
}

type StoreLoginPickerArgs = {
  request: PendingLoginPicker
  authorizationGeneration: string
}

export enum LoginPickerLoadKind {
  Available = 'available',
  Unavailable = 'unavailable',
}

export type LoginPickerLoad =
  | {
      kind: LoginPickerLoadKind.Available
      request: PendingLoginPicker
      authorizationGeneration: string
    }
  | { kind: LoginPickerLoadKind.Unavailable }

/** Owns the browser runtime resources shared by these interactions. */
class AccountPickerSessions {
  private get websiteLoginOptionsDependencies(): WebsiteLoginOptionsDependencies {
    return {
      accountPickerAuthorizationCleanupPending,
      accountPickerAuthorizationGeneration,
      accountPickerAuthorizationIsCurrent,
      availableWebsiteGrants:
        extensionPairingIdentity.availableWebsiteGrants.bind(
          extensionPairingIdentity,
        ),
      passiveAvailableWebsiteGrants:
        extensionPairingIdentity.passiveAvailableWebsiteGrants.bind(
          extensionPairingIdentity,
        ),
      loginAccountsForOrigin: accountPickerSessions.loginAccountsForOrigin.bind(
        accountPickerSessions,
      ),
      loginAccountAvailabilityForOrigin:
        accountPickerSessions.loginAccountAvailabilityForOrigin.bind(
          accountPickerSessions,
        ),
      openCompanionLauncherBestEffort:
        extensionSessionLifecycle.openCompanionLauncherBestEffort.bind(
          extensionSessionLifecycle,
        ),
    }
  }

  private pendingAuthenticatorPickers = new Map<
    string,
    PendingAuthenticatorPicker
  >()
  private pendingLoginPickers = new Map<string, PendingLoginPicker>()
  emptyAccountPickerSurface(): AccountPickerSurface {
    return { kind: AccountPickerSurfaceKind.None }
  }

  async closeAccountPickerSurface(
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

  takePendingAccountPickerMemoryCleanup({
    authenticatorRequests,
    loginRequests,
  }: PendingAccountPickerMemoryCleanupArgs): AccountPickerCancellation[] {
    const cancellations: AccountPickerCancellation[] = [
      ...Array.from(authenticatorRequests.values(), (request) => ({
        tabId: request.tabId,
        frameId: request.frameId,
        message: {
          type: WebsiteAuthenticatorCanceledMessageType.NookWebsiteAuthenticatorCanceled,
          payload: { origin: request.origin, requestId: request.requestId },
        },
      })),
      ...Array.from(loginRequests.values(), (request) => ({
        tabId: request.tabId,
        frameId: request.frameId,
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

  persistedAccountPickerCleanupPlan(
    stored: PersistedAccountPickerStorage,
  ): PersistedAccountPickerCleanupPlan {
    const storageKeys: string[] = []
    const cancellations: PersistedAccountPickerCleanupPlan['cancellations'] = []
    for (const [key, value] of Object.entries(stored)) {
      if (key.startsWith(AUTHENTICATOR_PICKER_STORAGE_PREFIX)) {
        storageKeys.push(key)
        if (this.isPendingAuthenticatorPicker(value)) {
          const cancellation: WebsiteAuthenticatorCanceledMessage = {
            type: WebsiteAuthenticatorCanceledMessageType.NookWebsiteAuthenticatorCanceled,
            payload: { origin: value.origin, requestId: value.requestId },
          }
          const targetedCancellation: AccountPickerCancellation = {
            tabId: value.tabId,
            frameId: value.frameId,
            message: cancellation,
          }
          cancellations.push(targetedCancellation)
        }
      } else if (key.startsWith(LOGIN_PICKER_STORAGE_PREFIX)) {
        storageKeys.push(key)
        if (this.isPendingAuthenticatorPicker(value)) {
          const cancellation: WebsiteLoginCanceledMessage = {
            type: WebsiteLoginCanceledMessageType.NookWebsiteLoginCanceled,
            payload: { origin: value.origin, requestId: value.requestId },
          }
          const targetedCancellation: AccountPickerCancellation = {
            tabId: value.tabId,
            frameId: value.frameId,
            message: cancellation,
          }
          cancellations.push(targetedCancellation)
        }
      }
    }
    return { storageKeys, cancellations }
  }

  private async clearPersistedAccountPickers(): Promise<void> {
    const plan = this.persistedAccountPickerCleanupPlan(
      await extensionPairingIdentity.getAllSessionStorage(),
    )
    await Promise.allSettled(
      plan.cancellations.map((delivery) =>
        AccountPickerPageTarget.send(delivery),
      ),
    )
    const removals = await Promise.allSettled(
      plan.storageKeys.map(
        extensionPairingIdentity.removeSessionStorage.bind(
          extensionPairingIdentity,
        ),
      ),
    )
    if (removals.some((result) => result.status === 'rejected')) {
      throw new Error('account picker storage removal failed')
    }
  }

  private async closeVisibleAccountPickerSurfaces(): Promise<void> {
    const pickerSurfaceQuery: Parameters<typeof chrome.tabs.query>[0] = {}
    const pickerSurfaceTabs = await new Promise<chrome.tabs.Tab[]>(
      (resolve) => {
        chrome.tabs.query(pickerSurfaceQuery, resolve)
      },
    )
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
    const removals = await Promise.allSettled(
      pickerSurfaceTabIds.map(
        (tabId) =>
          // eslint-disable-next-line max-params -- Promise owns the executor callback signature.
          new Promise<void>((resolve, reject) => {
            const tabs = chrome.tabs as typeof chrome.tabs & {
              remove: RemoveAccountPickerSurface
            }
            const removed = () => {
              const error = chrome.runtime.lastError
              if (error) reject(new Error(error.message))
              else resolve()
            }
            const removeArgs: Parameters<typeof tabs.remove> = [tabId, removed]
            tabs.remove(...removeArgs)
          }),
      ),
    )
    if (removals.some((result) => result.status === 'rejected')) {
      throw new Error('account picker surface removal failed')
    }
  }

  async clearPendingAccountPickers(): Promise<void> {
    const memoryCleanupArgs: PendingAccountPickerMemoryCleanupArgs = {
      authenticatorRequests: this.pendingAuthenticatorPickers,
      loginRequests: this.pendingLoginPickers,
    }
    const memoryCancellations =
      this.takePendingAccountPickerMemoryCleanup(memoryCleanupArgs)
    const memoryDelivery = Promise.allSettled(
      memoryCancellations.map((delivery) =>
        AccountPickerPageTarget.send(delivery),
      ),
    )
    const cleanup = await Promise.allSettled([
      this.clearPersistedAccountPickers(),
      this.closeVisibleAccountPickerSurfaces(),
    ])
    await memoryDelivery
    if (cleanup.some((result) => result.status === 'rejected')) {
      throw new Error('account picker cleanup failed')
    }
  }

  private sessionResponseAccounts(response: unknown): unknown[] {
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

  private authenticatorPickerStorageKey(requestId: string): string {
    return `${AUTHENTICATOR_PICKER_STORAGE_PREFIX}${requestId}`
  }

  private isPendingAuthenticatorPicker(
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
      'frameId' in value &&
      typeof value.frameId === 'number' &&
      Number.isInteger(value.frameId) &&
      value.frameId >= 0 &&
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

  async storeAuthenticatorPicker({
    request,
    authorizationGeneration,
  }: StoreAuthenticatorPickerArgs): Promise<boolean> {
    if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
      return false
    }
    if (await accountPickerAuthorizationCleanupPending()) return false
    this.pendingAuthenticatorPickers.set(request.requestId, request)
    const nookTypedArgs0_0: Parameters<
      typeof extensionPairingIdentity.setSessionStorage
    >[0] = {
      [this.authenticatorPickerStorageKey(request.requestId)]: request,
    }
    await extensionPairingIdentity.setSessionStorage(nookTypedArgs0_0)
    if (accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
      return true
    }
    this.pendingAuthenticatorPickers.delete(request.requestId)
    await extensionPairingIdentity.removeSessionStorage(
      this.authenticatorPickerStorageKey(request.requestId),
    )
    return false
  }

  async removeAuthenticatorPicker(requestId: string): Promise<void> {
    this.pendingAuthenticatorPickers.delete(requestId)
    await extensionPairingIdentity.removeSessionStorage(
      this.authenticatorPickerStorageKey(requestId),
    )
  }

  async loadAuthenticatorPicker(
    requestId: string,
  ): Promise<AuthenticatorPickerLoad> {
    const authorizationGeneration = await accountPickerAuthorizationGeneration()
    if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
      return { kind: AuthenticatorPickerLoadKind.Unavailable }
    }
    const cleanupStorage = await extensionPairingIdentity.getSessionStorage(
      ACCOUNT_PICKER_CLEANUP_STORAGE_KEY,
    )
    if (
      cleanupStorage[ACCOUNT_PICKER_CLEANUP_STORAGE_KEY] === true ||
      !accountPickerAuthorizationIsCurrent(authorizationGeneration)
    ) {
      return { kind: AuthenticatorPickerLoadKind.Unavailable }
    }
    let request = this.pendingAuthenticatorPickers.get(requestId)
    if (!request) {
      const key = this.authenticatorPickerStorageKey(requestId)
      const stored = (await extensionPairingIdentity.getSessionStorage(key))[
        key
      ]
      if (
        !this.isPendingAuthenticatorPicker(stored) ||
        stored.requestId !== requestId
      ) {
        if (stored) await extensionPairingIdentity.removeSessionStorage(key)
        return { kind: AuthenticatorPickerLoadKind.Unavailable }
      }
      if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
        return { kind: AuthenticatorPickerLoadKind.Unavailable }
      }
      request = stored
      this.pendingAuthenticatorPickers.set(requestId, request)
    }
    if (request.expiresAt <= Date.now()) {
      await this.removeAuthenticatorPicker(requestId)
      return { kind: AuthenticatorPickerLoadKind.Unavailable }
    }
    return {
      kind: AuthenticatorPickerLoadKind.Available,
      request,
      authorizationGeneration,
    }
  }

  isAuthenticatorPickerSender(sender: chrome.runtime.MessageSender): boolean {
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

  async authenticatorAccounts({
    grants,
    query,
  }: AuthenticatorAccountsArgs): Promise<WebsiteAuthenticatorOption[]> {
    const accounts: WebsiteAuthenticatorOption[] = []
    for (const grant of grants) {
      const nookTypedArgs0_1: Parameters<
        typeof extensionPairingIdentity.sendSessionMessage
      >[0] = {
        type: 'nook:extension-session-list-authenticators',
        payload: {
          ...extensionSessionGrantIdentity(grant),
          query,
          queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
        },
      }
      const response =
        await extensionPairingIdentity.sendSessionMessage(nookTypedArgs0_1)
      for (const account of this.sessionResponseAccounts(response)) {
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

  async authorizedWebsiteGrant({
    origin,
    vaultStoreId,
    sender,
    reasons,
  }: AuthorizedWebsiteGrantArgs): Promise<
    | { grant: StoredExtensionPairingGrant }
    | { response: { ok: false; reason: string } }
  > {
    const nookTypedArgs0_3: Parameters<
      typeof extensionPairingIdentity.isAuthorizedWebsiteSender
    >[0] = {
      sender,
      origin,
    }
    if (!extensionPairingIdentity.isAuthorizedWebsiteSender(nookTypedArgs0_3)) {
      return { response: { ok: false, reason: reasons.forbidden } }
    }
    const grant = (await extensionPairingIdentity.passwordPairingGrants()).find(
      (candidate) => candidate.vaultStoreId === vaultStoreId,
    )
    if (!grant) return { response: { ok: false, reason: reasons.missing } }
    await extensionSessionLifecycle.ensureExtensionSessionDocument()
    const queueExpiresAt = Date.now() + SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS
    const nookTypedArgs0_4: Parameters<
      typeof extensionPairingIdentity.sendSessionMessage
    >[0] = {
      type: 'nook:extension-session-status',
      payload: { queue: extensionSessionInteractiveDeadline(queueExpiresAt) },
    }
    const status =
      await extensionPairingIdentity.sendSessionMessage(nookTypedArgs0_4)
    if (!extensionSessionLifecycle.isUnlockedSessionStatus(status)) {
      extensionSessionLifecycle.openCompanionLauncherBestEffort(
        OpenCompanionLauncherIntent.Default,
      )
      return { response: { ok: false, reason: reasons.locked } }
    }
    return { grant }
  }

  private async loginAccountListForOrigin({
    grants,
    origin,
    query = '',
    queue,
    sendMessage = extensionPairingIdentity.sendSessionMessage.bind(
      extensionPairingIdentity,
    ),
    failClosed,
  }: LoginAccountListForOriginArgs): Promise<LoginAccountAvailability> {
    const accounts: WebsiteLoginAccountOption[] = []
    let receivedValidResponse = false
    const needle = query.trim().toLowerCase()
    for (const grant of grants) {
      const request: Parameters<
        typeof extensionPairingIdentity.sendSessionMessage
      >[0] = {
        type: 'nook:extension-session-list-logins',
        payload: {
          ...extensionSessionGrantIdentity(grant),
          origin,
          queue,
        },
      }
      let response: Awaited<
        ReturnType<typeof extensionPairingIdentity.sendSessionMessage>
      >
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
      for (const account of this.sessionResponseAccounts(response)) {
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

  async loginAccountAvailabilityForOrigin(
    args: LoginAccountAvailabilityForOriginArgs,
  ): Promise<LoginAccountAvailability> {
    const request: LoginAccountListForOriginArgs = {
      ...args,
      failClosed: true,
    }
    return this.loginAccountListForOrigin(request)
  }

  async loginAccountsForOrigin({
    grants,
    origin,
    query = '',
    sendMessage = extensionPairingIdentity.sendSessionMessage.bind(
      extensionPairingIdentity,
    ),
  }: LoginAccountsForOriginArgs): Promise<WebsiteLoginAccountOption[]> {
    const request: LoginAccountListForOriginArgs = {
      grants,
      origin,
      query,
      sendMessage,
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      failClosed: false,
    }
    const result = await this.loginAccountListForOrigin(request)
    return result.ok ? result.accounts : []
  }

  private async websiteLoginOptionsResponse({
    message,
    sender,
    dependencies,
    openUnavailableCompanion,
  }: WebsiteLoginOptionsResponseArgs): Promise<unknown> {
    const resolvedDependencies = ((v) =>
      v ? v : this.websiteLoginOptionsDependencies)(dependencies)
    const authorizationGeneration =
      await resolvedDependencies.accountPickerAuthorizationGeneration()
    if (
      !resolvedDependencies.accountPickerAuthorizationIsCurrent(
        authorizationGeneration,
      ) ||
      (await resolvedDependencies.accountPickerAuthorizationCleanupPending())
    ) {
      return { ok: false, reason: 'login-options-unavailable' }
    }
    const nookTypedArgs0_6: Parameters<
      typeof extensionPairingIdentity.availableWebsiteGrants
    >[0] = {
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
      const accountRequest: Parameters<typeof this.loginAccountsForOrigin>[0] =
        {
          grants: access.grants,
          origin: message.payload.origin,
        }
      accounts =
        await resolvedDependencies.loginAccountsForOrigin(accountRequest)
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
    if (
      !resolvedDependencies.accountPickerAuthorizationIsCurrent(
        authorizationGeneration,
      ) ||
      (await resolvedDependencies.accountPickerAuthorizationCleanupPending())
    ) {
      return { ok: false, reason: 'login-options-unavailable' }
    }
    return { ok: true, status: 'ready', authorizationGeneration, accounts }
  }

  async websiteLoginOptions(args: WebsiteLoginOptionsArgs): Promise<unknown> {
    const responseRequest: WebsiteLoginOptionsResponseArgs = {
      ...args,
      openUnavailableCompanion: true,
    }
    return this.websiteLoginOptionsResponse(responseRequest)
  }

  async websiteLoginMatchAvailability({
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
    const response = await this.websiteLoginOptionsResponse(responseRequest)
    return decode_website_login_match_availability(
      response as WebsiteLoginOptionsWireValue,
    )
  }

  private loginPickerStorageKey(requestId: string): string {
    return `${LOGIN_PICKER_STORAGE_PREFIX}${requestId}`
  }

  private isPendingLoginPicker(value: unknown): value is PendingLoginPicker {
    return this.isPendingAuthenticatorPicker(value)
  }

  async storeLoginPicker({
    request,
    authorizationGeneration,
  }: StoreLoginPickerArgs): Promise<boolean> {
    if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
      return false
    }
    if (await accountPickerAuthorizationCleanupPending()) return false
    this.pendingLoginPickers.set(request.requestId, request)
    const nookTypedArgs0_7: Parameters<
      typeof extensionPairingIdentity.setSessionStorage
    >[0] = {
      [this.loginPickerStorageKey(request.requestId)]: request,
    }
    await extensionPairingIdentity.setSessionStorage(nookTypedArgs0_7)
    if (accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
      return true
    }
    this.pendingLoginPickers.delete(request.requestId)
    await extensionPairingIdentity.removeSessionStorage(
      this.loginPickerStorageKey(request.requestId),
    )
    return false
  }

  async removeLoginPicker(requestId: string): Promise<void> {
    this.pendingLoginPickers.delete(requestId)
    await extensionPairingIdentity.removeSessionStorage(
      this.loginPickerStorageKey(requestId),
    )
  }

  async loadLoginPicker(requestId: string): Promise<LoginPickerLoad> {
    const authorizationGeneration = await accountPickerAuthorizationGeneration()
    if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
      return { kind: LoginPickerLoadKind.Unavailable }
    }
    const cleanupStorage = await extensionPairingIdentity.getSessionStorage(
      ACCOUNT_PICKER_CLEANUP_STORAGE_KEY,
    )
    if (
      cleanupStorage[ACCOUNT_PICKER_CLEANUP_STORAGE_KEY] === true ||
      !accountPickerAuthorizationIsCurrent(authorizationGeneration)
    ) {
      return { kind: LoginPickerLoadKind.Unavailable }
    }
    let request = this.pendingLoginPickers.get(requestId)
    if (!request) {
      const key = this.loginPickerStorageKey(requestId)
      const stored = (await extensionPairingIdentity.getSessionStorage(key))[
        key
      ]
      if (
        !this.isPendingLoginPicker(stored) ||
        stored.requestId !== requestId
      ) {
        if (stored) await extensionPairingIdentity.removeSessionStorage(key)
        return { kind: LoginPickerLoadKind.Unavailable }
      }
      if (!accountPickerAuthorizationIsCurrent(authorizationGeneration)) {
        return { kind: LoginPickerLoadKind.Unavailable }
      }
      request = stored
      this.pendingLoginPickers.set(requestId, request)
    }
    if (request.expiresAt <= Date.now()) {
      await this.removeLoginPicker(requestId)
      return { kind: LoginPickerLoadKind.Unavailable }
    }
    return {
      kind: LoginPickerLoadKind.Available,
      request,
      authorizationGeneration,
    }
  }

  isLoginPickerSender(sender: chrome.runtime.MessageSender): boolean {
    return this.isAuthenticatorPickerSender(sender)
  }
}

export const accountPickerSessions = new AccountPickerSessions()
