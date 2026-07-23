export {}

import {
  isBeginExtensionPairingMessage,
  isExtensionIdentityHandoffRequestMessage,
  isExtensionLocalEventLogUpdatedMessage,
  isExtensionPairedVaultIdentityDiscoveryMessage,
  isExtensionPairedVaultIdentityHandoffRequestMessage,
  isExtensionPairedVaultUnlockRequestMessage,
  isExtensionPairingApprovedMessage,
  isOpenCompanionLauncherMessage,
  isOpenSimpleVaultMessage,
} from '../../../nook-web-shared/src/extension/runtime-messages'
import type {
  BeginExtensionPairingMessage,
  ExtensionIdentityHandoffRequestMessage,
  ExtensionPairedVaultIdentityDiscoveryMessage,
  ExtensionPairedVaultIdentityHandoffRequestMessage,
  ExtensionPairedVaultIdentityStatusMessage,
  ExtensionPairedVaultUnlockRequestMessage,
  ExtensionPairingApprovedMessage,
} from '../../../nook-web-shared/src/extension/runtime-messages'
import {
  extensionPairingGrantStorageItems,
  extensionStoredPairingGrantStorageItems,
  isStoredExtensionPairingGrant,
  pairingGrantStorageKey,
  setupStorageKey,
} from './pairing-grants'
import type { StoredExtensionPairingGrant } from './pairing-grants'
import {
  authenticationWorkflowSnapshot,
  classifyAuthenticationOutcome,
  generateSuggestedPassword,
  importExtensionEventLog,
} from './vault-runtime'
import {
  isRuntimeSimpleVaultUrl,
  runtimeSimpleVaultUrl,
} from '../lib/simple-vault-runtime'
import {
  isAuthenticatorPickerCancelMessage,
  isAuthenticatorPickerQueryMessage,
  isAuthenticatorPickerSelectMessage,
  isWebsiteAuthenticatorPickerOpenMessage,
} from '../lib/authenticator-picker-messages'
import {
  isWebsiteAuthenticatorBackupAttachMessage,
  isWebsiteAuthenticatorEnrollCodeMessage,
  isWebsiteAuthenticatorEnrollConfirmMessage,
  isWebsiteAuthenticatorEnrollDismissMessage,
  isWebsiteAuthenticatorEnrollPendingMessage,
  isWebsiteAuthenticatorEnrollPreviewMessage,
  isWebsiteAuthenticatorEnrollStageMessage,
  type OtpauthEnrollmentPreview,
} from '../lib/enrollment-messages'
import {
  isWebsiteAuthenticatorFillMessage,
  isWebsiteAuthenticatorOptionsMessage,
  isWebsiteLoginOptionsMessage,
  isWebsiteLoginRevealMessage,
  type WebsiteAuthenticatorOption,
  type WebsiteLoginAccountOption,
} from '../lib/login-fill-messages'
import {
  isWebsiteLoginSaveCommitMessage,
  isWebsiteLoginSaveDismissMessage,
  isWebsiteLoginSaveOfferMessage,
  isWebsiteLoginSavePendingMessage,
  type WebsiteLoginSaveOfferView,
} from '../lib/login-save-messages'
import {
  isWebsitePasskeyOptionsMessage,
  isWebsitePasskeyPerformMessage,
  parsedWebsitePasskeyRequest,
  type WebsitePasskeyCeremony,
} from '../lib/webauthn-messages'
import { isAuthenticationWorkflowSnapshotMessage } from '../lib/auth-workflow-messages'
import { isAuthenticationOutcomeClassifyMessage } from '../lib/outcome-evidence-messages'

const extensionSessionDocument = 'offscreen/session.html'
let extensionSessionDocumentCreation: Promise<void> | undefined
let extensionSessionDocumentClosure: Promise<void> | undefined
type PendingIdentityHandoff =
  | {
      kind: 'pairing'
      deviceId: string
      devicePublicKey: string
      deviceSigningPublicKey: string
    }
  | {
      kind: 'paired-vault'
      vaultStoreId: string
      deviceId: string
      devicePublicKey: string
      deviceSigningPublicKey: string
    }
const pendingIdentityHandoffConsumptions = new Set<string>()
const pendingWebsitePasskeyRequests = new Set<string>()
type PendingAuthenticatorPicker = {
  requestId: string
  origin: string
  tabId: number
  allowedVaultStoreIds: string[]
  expiresAt: number
}
const AUTHENTICATOR_PICKER_TTL_MS = 5 * 60 * 1000
const AUTHENTICATOR_PICKER_STORAGE_PREFIX =
  'nook.extension.authenticator-picker.'
const pendingAuthenticatorPickers = new Map<
  string,
  PendingAuthenticatorPicker
>()

async function ensureExtensionSessionDocument(): Promise<void> {
  await extensionSessionDocumentClosure
  extensionSessionDocumentCreation ??= chrome.offscreen
    .createDocument({
      url: extensionSessionDocument,
      reasons: ['WORKERS'],
      justification:
        'Keep a user-authorized extension device identity in memory for a 15-minute session.',
    })
    .catch((error: unknown) => {
      // Manifest V3 permits only one offscreen document. A restarted service
      // worker may race with the existing session document; it is safe to use
      // that already-open document.
      if (
        error instanceof Error &&
        error.message.includes('single offscreen')
      ) {
        return
      }
      throw error
    })
  return extensionSessionDocumentCreation
}

function closeExtensionSessionDocument(): Promise<void> {
  extensionSessionDocumentCreation = undefined
  if (extensionSessionDocumentClosure) return extensionSessionDocumentClosure
  const closure = chrome.offscreen.closeDocument().finally(() => {
    if (extensionSessionDocumentClosure === closure) {
      extensionSessionDocumentClosure = undefined
    }
  })
  extensionSessionDocumentClosure = closure
  return closure
}

function isExtensionSessionExpiryMessage(
  message: unknown,
): message is { type: 'nook:extension-session-expired' } {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'nook:extension-session-expired'
  )
}

function isExtensionSessionLockMessage(
  message: unknown,
): message is { type: 'nook:extension-session-lock' } {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'nook:extension-session-lock'
  )
}

function isExtensionSessionEnsureMessage(
  message: unknown,
): message is { type: 'nook:ensure-extension-session-runtime' } {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'nook:ensure-extension-session-runtime'
  )
}

function openSimpleVault(path = ''): void {
  chrome.tabs.create({ url: runtimeSimpleVaultUrl(path) })
}

async function openCompanionLauncher(intent?: 'pair'): Promise<void> {
  const popupUrl = chrome.runtime.getURL('popup/index.html')
  const launcherUrl = intent ? `${popupUrl}?intent=${intent}` : popupUrl
  if (chrome.windows?.create) {
    await chrome.windows.create({
      url: launcherUrl,
      type: 'popup',
      width: 440,
      height: 620,
      focused: true,
    })
    return
  }
  await chrome.tabs.create({ url: launcherUrl })
}

function randomNonce(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}

function pendingIdentityHandoffStorageKey(nonce: string): string {
  return `nook.extension.identity-handoff.${nonce}`
}

function isPendingIdentityHandoff(
  value: unknown,
): value is PendingIdentityHandoff {
  return (
    !!value &&
    typeof value === 'object' &&
    'deviceId' in value &&
    typeof value.deviceId === 'string' &&
    'devicePublicKey' in value &&
    typeof value.devicePublicKey === 'string' &&
    'deviceSigningPublicKey' in value &&
    typeof value.deviceSigningPublicKey === 'string' &&
    'kind' in value &&
    (value.kind === 'pairing' ||
      (value.kind === 'paired-vault' &&
        'vaultStoreId' in value &&
        typeof value.vaultStoreId === 'string'))
  )
}

function setSessionStorage(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.session.set(items, () => {
      const message = chrome.runtime.lastError?.message
      if (message) reject(new Error(message))
      else resolve()
    })
  })
}

function getSessionStorage(key: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    chrome.storage.session.get(key, (items) => {
      const message = chrome.runtime.lastError?.message
      if (message) reject(new Error(message))
      else resolve(items)
    })
  })
}

function removeSessionStorage(key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.session.remove(key, () => {
      const message = chrome.runtime.lastError?.message
      if (message) reject(new Error(message))
      else resolve()
    })
  })
}

async function issueIdentityHandoff(
  nonce: string,
  pending: PendingIdentityHandoff,
): Promise<void> {
  await setSessionStorage({
    [pendingIdentityHandoffStorageKey(nonce)]: pending,
  })
}

async function openExtensionPairing(
  device: BeginExtensionPairingMessage['payload'],
): Promise<void> {
  const nonce = randomNonce()
  await issueIdentityHandoff(nonce, {
    kind: 'pairing',
    deviceId: device.deviceId,
    devicePublicKey: device.devicePublicKey,
    deviceSigningPublicKey: device.deviceSigningPublicKey,
  })
  const url = new URL(runtimeSimpleVaultUrl('extension-connect'))
  url.searchParams.set('device_id', device.deviceId)
  url.searchParams.set('device_public_key', device.devicePublicKey)
  url.searchParams.set(
    'device_signing_public_key',
    device.deviceSigningPublicKey,
  )
  url.searchParams.set('extension_id', chrome.runtime.id)
  url.searchParams.set('device_label', device.deviceLabel)
  url.searchParams.set('nonce', nonce)
  url.searchParams.set(
    'scopes',
    'vault-access,password-filling,passkey-management,sync-provider-credentials',
  )
  chrome.tabs.create({ url: url.toString() })
}

function isNokeySender(sender: chrome.runtime.MessageSender): boolean {
  if (!sender.url) return false
  try {
    return isRuntimeSimpleVaultUrl(sender.url)
  } catch {
    return false
  }
}

function sendSessionMessage(message: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError?.message
      if (error) reject(new Error(error))
      else resolve(response)
    })
  })
}

async function pairedVaultGrantIsCurrent(
  pending: Extract<PendingIdentityHandoff, { kind: 'paired-vault' }>,
): Promise<boolean> {
  const key = pairingGrantStorageKey(pending.vaultStoreId)
  const stored = await getLocalStorage(key)
  const grant = stored[key]
  return (
    isStoredExtensionPairingGrant(grant) &&
    grant.deviceId === pending.deviceId &&
    grant.devicePublicKey === pending.devicePublicKey &&
    grant.deviceSigningPublicKey === pending.deviceSigningPublicKey
  )
}

async function createIdentityHandoff(
  message:
    | ExtensionIdentityHandoffRequestMessage
    | ExtensionPairedVaultIdentityHandoffRequestMessage,
): Promise<{
  ok: boolean
  envelope?: string
  nextNonce?: string
  reason?: string
}> {
  const nonce = message.payload.nonce
  if (pendingIdentityHandoffConsumptions.has(nonce)) {
    return { ok: false, reason: 'extension-identity-handoff-not-issued' }
  }
  pendingIdentityHandoffConsumptions.add(nonce)
  try {
    const key = pendingIdentityHandoffStorageKey(nonce)
    const stored = await getSessionStorage(key)
    const pending = stored[key]
    if (
      !isPendingIdentityHandoff(pending) ||
      (pending.kind === 'pairing' &&
        message.type !== 'nook:extension-identity-handoff-request') ||
      (pending.kind === 'paired-vault' &&
        (message.type !==
          'nook:extension-paired-vault-identity-handoff-request' ||
          pending.vaultStoreId !== message.payload.vaultStoreId)) ||
      pending.deviceId !== message.payload.expectedDeviceId ||
      pending.devicePublicKey !== message.payload.expectedDevicePublicKey ||
      pending.deviceSigningPublicKey !==
        message.payload.expectedDeviceSigningPublicKey
    ) {
      return { ok: false, reason: 'extension-identity-handoff-not-issued' }
    }
    if (
      pending.kind === 'paired-vault' &&
      !(await pairedVaultGrantIsCurrent(pending))
    ) {
      return { ok: false, reason: 'extension-pairing-revoked' }
    }
    await removeSessionStorage(key)
    await ensureExtensionSessionDocument()
    const response = await sendSessionMessage({
      type: 'nook:extension-session-seal-identity-handoff',
      payload: message.payload,
    })
    if (
      !!response &&
      typeof response === 'object' &&
      'ok' in response &&
      response.ok === true &&
      'envelope' in response &&
      typeof response.envelope === 'string'
    ) {
      if (
        pending.kind === 'paired-vault' &&
        !(await pairedVaultGrantIsCurrent(pending))
      ) {
        return { ok: false, reason: 'extension-pairing-revoked' }
      }
      const nextNonce = randomNonce()
      await issueIdentityHandoff(nextNonce, pending)
      return { ok: true, envelope: response.envelope, nextNonce }
    }
    return { ok: false, reason: 'extension-identity-unavailable' }
  } catch {
    return { ok: false, reason: 'extension-identity-handoff-failed' }
  } finally {
    pendingIdentityHandoffConsumptions.delete(nonce)
  }
}

type ExtensionSessionStatusResponse = {
  ok?: unknown
  status?: unknown
  device?: unknown
}

type UnlockedSessionDevice = {
  deviceId: string
  devicePublicKey: string
  deviceSigningPublicKey: string
}

function unlockedSessionDevice(
  response: unknown,
): UnlockedSessionDevice | undefined {
  if (
    !response ||
    typeof response !== 'object' ||
    !('ok' in response) ||
    response.ok !== true ||
    !('status' in response) ||
    response.status !== 'unlocked' ||
    !('device' in response) ||
    !response.device ||
    typeof response.device !== 'object'
  ) {
    return undefined
  }
  const device = response.device
  if (
    !('deviceId' in device) ||
    typeof device.deviceId !== 'string' ||
    !('devicePublicKey' in device) ||
    typeof device.devicePublicKey !== 'string' ||
    !('deviceSigningPublicKey' in device) ||
    typeof device.deviceSigningPublicKey !== 'string'
  ) {
    return undefined
  }
  return {
    deviceId: device.deviceId,
    devicePublicKey: device.devicePublicKey,
    deviceSigningPublicKey: device.deviceSigningPublicKey,
  }
}

async function discoverPairedVaultIdentity(
  message: ExtensionPairedVaultIdentityDiscoveryMessage,
): Promise<ExtensionPairedVaultIdentityStatusMessage> {
  const { requestId, vaultStoreId } = message.payload
  const unavailable = {
    type: 'nook:extension-paired-vault-identity-status',
    payload: { requestId, vaultStoreId, status: 'unavailable' },
  } satisfies ExtensionPairedVaultIdentityStatusMessage
  try {
    const key = pairingGrantStorageKey(vaultStoreId)
    const stored = await getLocalStorage(key)
    const grant = stored[key]
    if (!isStoredExtensionPairingGrant(grant)) return unavailable

    await ensureExtensionSessionDocument()
    const statusResponse = (await sendSessionMessage({
      type: 'nook:extension-session-status',
    })) as ExtensionSessionStatusResponse
    if (statusResponse.status !== 'unlocked') {
      return {
        type: 'nook:extension-paired-vault-identity-status',
        payload: { requestId, vaultStoreId, status: 'locked' },
      }
    }
    const sessionDevice = unlockedSessionDevice(statusResponse)
    if (
      !sessionDevice ||
      sessionDevice.deviceId !== grant.deviceId ||
      sessionDevice.devicePublicKey !== grant.devicePublicKey ||
      sessionDevice.deviceSigningPublicKey !== grant.deviceSigningPublicKey
    ) {
      return unavailable
    }

    const nonce = randomNonce()
    await issueIdentityHandoff(nonce, {
      kind: 'paired-vault',
      vaultStoreId,
      deviceId: grant.deviceId,
      devicePublicKey: grant.devicePublicKey,
      deviceSigningPublicKey: grant.deviceSigningPublicKey,
    })
    return {
      type: 'nook:extension-paired-vault-identity-status',
      payload: {
        requestId,
        vaultStoreId,
        status: 'unlocked',
        extensionRuntimeId: chrome.runtime.id,
        deviceId: grant.deviceId,
        devicePublicKey: grant.devicePublicKey,
        deviceSigningPublicKey: grant.deviceSigningPublicKey,
        deviceLabel: grant.deviceLabel,
        nonce,
        scopes: grant.scopes,
      },
    }
  } catch {
    return unavailable
  }
}

async function requestPairedVaultUnlock(
  message: ExtensionPairedVaultUnlockRequestMessage,
): Promise<Record<string, unknown>> {
  const { requestId, vaultStoreId } = message.payload
  const key = pairingGrantStorageKey(vaultStoreId)
  const stored = await getLocalStorage(key)
  if (!isStoredExtensionPairingGrant(stored[key])) {
    return {
      ok: false,
      requestId,
      vaultStoreId,
      reason: 'vault-not-paired',
    }
  }

  await ensureExtensionSessionDocument()
  const statusResponse = (await sendSessionMessage({
    type: 'nook:extension-session-status',
  })) as ExtensionSessionStatusResponse
  if (statusResponse.status !== 'unlocked') {
    await openCompanionLauncher()
  }
  return { ok: true, requestId, vaultStoreId }
}

function hasPairingApprovedType(
  message: unknown,
): message is { type: 'nook:extension-pairing-approved' } {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'nook:extension-pairing-approved'
  )
}

function setLocalStorage(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      const message = chrome.runtime.lastError?.message
      if (message) reject(new Error(message))
      else resolve()
    })
  })
}

function getLocalStorage(key: string | null): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (items) => {
      const message = chrome.runtime.lastError?.message
      if (message) reject(new Error(message))
      else resolve(items)
    })
  })
}

function requestOriginAndRpId(
  ceremony: WebsitePasskeyCeremony,
  requestJson: string,
):
  | { origin: string; rpId: string; request: Record<string, unknown> }
  | undefined {
  const request = parsedWebsitePasskeyRequest(requestJson)
  if (!request || typeof request.origin !== 'string') return undefined
  if (ceremony === 'get') {
    return typeof request.rpId === 'string'
      ? { origin: request.origin, rpId: request.rpId, request }
      : undefined
  }
  const relyingParty = request.relyingParty
  return relyingParty &&
    typeof relyingParty === 'object' &&
    'id' in relyingParty &&
    typeof relyingParty.id === 'string'
    ? { origin: request.origin, rpId: relyingParty.id, request }
    : undefined
}

function isAuthorizedWebsiteSender(
  sender: chrome.runtime.MessageSender,
  origin: string,
): boolean {
  if (
    sender.id !== chrome.runtime.id ||
    sender.tab?.id === undefined ||
    !sender.url
  ) {
    return false
  }
  try {
    return new URL(sender.url).origin === origin
  } catch {
    return false
  }
}

async function passkeyPairingGrants(): Promise<StoredExtensionPairingGrant[]> {
  const stored = await getLocalStorage(null)
  return Object.values(stored).filter(
    (value): value is StoredExtensionPairingGrant =>
      isStoredExtensionPairingGrant(value) &&
      value.scopes.includes('passkey-management'),
  )
}

async function passwordPairingGrants(): Promise<StoredExtensionPairingGrant[]> {
  const stored = await getLocalStorage(null)
  return Object.values(stored).filter(
    (value): value is StoredExtensionPairingGrant =>
      isStoredExtensionPairingGrant(value) &&
      value.scopes.includes('password-filling'),
  )
}

async function availableWebsiteGrants(
  origin: string,
  sender: chrome.runtime.MessageSender,
  forbiddenReason: string,
): Promise<
  | { grants: StoredExtensionPairingGrant[] }
  | { response: Record<string, unknown> }
> {
  if (!isAuthorizedWebsiteSender(sender, origin)) {
    return { response: { ok: false, reason: forbiddenReason } }
  }
  const grants = await passwordPairingGrants()
  if (grants.length === 0) {
    return { response: { ok: true, status: 'unavailable', accounts: [] } }
  }
  await ensureExtensionSessionDocument()
  const status = await sendSessionMessage({
    type: 'nook:extension-session-status',
  })
  if (!isUnlockedSessionStatus(status)) {
    openCompanionLauncher()
    return { response: { ok: true, status: 'locked', accounts: [] } }
  }
  return { grants }
}

function isUnlockedSessionStatus(status: unknown): boolean {
  return Boolean(
    status &&
    typeof status === 'object' &&
    'status' in status &&
    status.status === 'unlocked',
  )
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

async function storeAuthenticatorPicker(
  request: PendingAuthenticatorPicker,
): Promise<void> {
  pendingAuthenticatorPickers.set(request.requestId, request)
  await setSessionStorage({
    [authenticatorPickerStorageKey(request.requestId)]: request,
  })
}

async function removeAuthenticatorPicker(requestId: string): Promise<void> {
  pendingAuthenticatorPickers.delete(requestId)
  await removeSessionStorage(authenticatorPickerStorageKey(requestId))
}

async function loadAuthenticatorPicker(
  requestId: string,
): Promise<PendingAuthenticatorPicker | undefined> {
  let request = pendingAuthenticatorPickers.get(requestId)
  if (!request) {
    const key = authenticatorPickerStorageKey(requestId)
    const stored = (await getSessionStorage(key))[key]
    if (
      !isPendingAuthenticatorPicker(stored) ||
      stored.requestId !== requestId
    ) {
      if (stored !== undefined) await removeSessionStorage(key)
      return undefined
    }
    request = stored
    pendingAuthenticatorPickers.set(requestId, request)
  }
  if (request.expiresAt <= Date.now()) {
    await removeAuthenticatorPicker(requestId)
    return undefined
  }
  return request
}

function isAuthenticatorPickerSender(
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

async function authenticatorAccounts(
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

async function authorizedWebsiteGrant(
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
  const status = await sendSessionMessage({
    type: 'nook:extension-session-status',
  })
  if (!isUnlockedSessionStatus(status)) {
    openCompanionLauncher()
    return { response: { ok: false, reason: reasons.locked } }
  }
  return { grant }
}

async function websiteLoginOptions(
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

  const accounts: WebsiteLoginAccountOption[] = []
  for (const grant of access.grants) {
    const response = await sendSessionMessage({
      type: 'nook:extension-session-list-logins',
      payload: { ...grant, origin: message.payload.origin },
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
      accounts.push({
        vaultStoreId: grant.vaultStoreId,
        vaultName: grant.vaultName,
        secretId: account.secretId,
        username: account.username,
        websiteUrl: account.websiteUrl,
        websiteHost: account.websiteHost,
      })
    }
  }
  return { ok: true, status: 'ready', accounts }
}

async function websiteLoginSaveOffer(
  message: {
    payload: {
      origin: string
      username: string
      password: string
    }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (!isAuthorizedWebsiteSender(sender, message.payload.origin)) {
    message.payload.password = ''
    return { ok: false, reason: 'login-save-forbidden-origin' }
  }
  const grants = await passwordPairingGrants()
  if (grants.length === 0) {
    message.payload.password = ''
    return { ok: true, status: 'unavailable' }
  }
  await ensureExtensionSessionDocument()
  const status = await sendSessionMessage({
    type: 'nook:extension-session-status',
  })
  if (
    !status ||
    typeof status !== 'object' ||
    !('status' in status) ||
    status.status !== 'unlocked'
  ) {
    message.payload.password = ''
    openCompanionLauncher()
    return { ok: true, status: 'locked' }
  }

  // Prefer the selected/ready vault, then the first password-filling grant.
  const grant = grants[0]
  const response = await sendSessionMessage({
    type: 'nook:extension-session-plan-login-save',
    payload: {
      ...grant,
      origin: message.payload.origin,
      username: message.payload.username,
      password: message.payload.password,
    },
  })
  message.payload.password = ''
  if (
    !response ||
    typeof response !== 'object' ||
    !('ok' in response) ||
    response.ok !== true ||
    !('decision' in response) ||
    typeof response.decision !== 'string'
  ) {
    return { ok: false, reason: 'login-save-plan-failed' }
  }
  if (
    response.decision === 'already-saved' ||
    response.decision === 'invalid'
  ) {
    return { ok: true, status: 'ready', decision: response.decision }
  }
  if (
    (response.decision !== 'create' && response.decision !== 'update') ||
    !('offerId' in response) ||
    typeof response.offerId !== 'string'
  ) {
    return { ok: false, reason: 'login-save-plan-failed' }
  }
  const offer: WebsiteLoginSaveOfferView = {
    offerId: response.offerId,
    decision: response.decision,
    vaultStoreId: grant.vaultStoreId,
    vaultName: grant.vaultName,
  }
  return { ok: true, status: 'ready', decision: response.decision, offer }
}

async function websiteLoginSavePending(
  message: { payload: { origin: string } },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (!isAuthorizedWebsiteSender(sender, message.payload.origin)) {
    return { ok: false, reason: 'login-save-forbidden-origin' }
  }
  const grants = await passwordPairingGrants()
  if (grants.length === 0) {
    return { ok: true, offer: undefined }
  }
  await ensureExtensionSessionDocument()
  const response = await sendSessionMessage({
    type: 'nook:extension-session-pending-login-save',
    payload: { origin: message.payload.origin },
  })
  if (
    !response ||
    typeof response !== 'object' ||
    !('ok' in response) ||
    response.ok !== true
  ) {
    return { ok: false, reason: 'login-save-pending-failed' }
  }
  if (
    !('offer' in response) ||
    !response.offer ||
    typeof response.offer !== 'object'
  ) {
    return { ok: true, offer: undefined }
  }
  const staged = response.offer as {
    offerId?: string
    decision?: string
    vaultStoreId?: string
  }
  const grant = grants.find(
    (candidate) => candidate.vaultStoreId === staged.vaultStoreId,
  )
  if (
    !grant ||
    typeof staged.offerId !== 'string' ||
    (staged.decision !== 'create' && staged.decision !== 'update')
  ) {
    return { ok: true, offer: undefined }
  }
  const offer: WebsiteLoginSaveOfferView = {
    offerId: staged.offerId,
    decision: staged.decision,
    vaultStoreId: grant.vaultStoreId,
    vaultName: grant.vaultName,
  }
  return { ok: true, offer }
}

async function websiteLoginSaveCommit(
  message: {
    payload: {
      origin: string
      offerId: string
      evidence: {
        navigatedAwayFromAuthPath: boolean
        authFieldsPresent: boolean
        successMarkerPresent: boolean
        errorMarkerPresent: boolean
        sameDocumentMutation: boolean
        inIframe: boolean
        elapsedMs: number
      }
    }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (!isAuthorizedWebsiteSender(sender, message.payload.origin)) {
    return { ok: false, reason: 'login-save-forbidden-origin' }
  }
  const verdict = await classifyAuthenticationOutcome(message.payload.evidence)
  if (!verdict.allowsCredentialCommit) {
    return {
      ok: false,
      reason: 'login-save-evidence-insufficient',
      verdict: verdict.name,
    }
  }
  const grants = await passwordPairingGrants()
  if (grants.length === 0) {
    return { ok: false, reason: 'login-save-unavailable' }
  }
  await ensureExtensionSessionDocument()
  const pending = await sendSessionMessage({
    type: 'nook:extension-session-pending-login-save',
    payload: { origin: message.payload.origin },
  })
  const stagedVaultStoreId =
    pending &&
    typeof pending === 'object' &&
    'offer' in pending &&
    pending.offer &&
    typeof pending.offer === 'object' &&
    'vaultStoreId' in pending.offer &&
    typeof pending.offer.vaultStoreId === 'string'
      ? pending.offer.vaultStoreId
      : undefined
  const grant =
    grants.find((candidate) => candidate.vaultStoreId === stagedVaultStoreId) ??
    grants[0]
  const status = await sendSessionMessage({
    type: 'nook:extension-session-status',
  })
  if (
    !status ||
    typeof status !== 'object' ||
    !('status' in status) ||
    status.status !== 'unlocked'
  ) {
    openCompanionLauncher()
    return { ok: false, reason: 'login-save-locked' }
  }
  return sendSessionMessage({
    type: 'nook:extension-session-commit-login-save',
    payload: {
      ...grant,
      origin: message.payload.origin,
      offerId: message.payload.offerId,
    },
  })
}

async function websiteLoginSaveDismiss(
  message: { payload: { origin: string; offerId: string } },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (!isAuthorizedWebsiteSender(sender, message.payload.origin)) {
    return { ok: false, reason: 'login-save-forbidden-origin' }
  }
  await ensureExtensionSessionDocument()
  return sendSessionMessage({
    type: 'nook:extension-session-dismiss-login-save',
    payload: {
      origin: message.payload.origin,
      offerId: message.payload.offerId,
    },
  })
}

async function websiteLoginFill(
  message: {
    payload: {
      origin: string
      vaultStoreId: string
      secretId: string
    }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const access = await authorizedWebsiteGrant(
    message.payload.origin,
    message.payload.vaultStoreId,
    sender,
    {
      forbidden: 'login-forbidden-origin',
      missing: 'login-vault-not-granted',
      locked: 'login-locked',
    },
  )
  if ('response' in access) return access.response
  return sendSessionMessage({
    type: 'nook:extension-session-reveal-login',
    payload: {
      ...access.grant,
      origin: message.payload.origin,
      secretId: message.payload.secretId,
    },
  })
}

async function websiteAuthenticatorOptions(
  message: { payload: { origin: string } },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const access = await availableWebsiteGrants(
    message.payload.origin,
    sender,
    'authenticator-forbidden-origin',
  )
  if ('response' in access) return access.response

  const accounts = await authenticatorAccounts(access.grants, '')
  return { ok: true, status: 'ready', accounts }
}

async function openWebsiteAuthenticatorPicker(
  message: { payload: { origin: string } },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const access = await availableWebsiteGrants(
    message.payload.origin,
    sender,
    'authenticator-forbidden-origin',
  )
  if ('response' in access) return access.response
  if (sender.tab?.id === undefined) {
    return { ok: false, reason: 'authenticator-picker-tab-missing' }
  }

  const requestId = randomNonce()
  const request = {
    requestId,
    origin: message.payload.origin,
    tabId: sender.tab.id,
    allowedVaultStoreIds: access.grants.map((grant) => grant.vaultStoreId),
    expiresAt: Date.now() + AUTHENTICATOR_PICKER_TTL_MS,
  }
  await storeAuthenticatorPicker(request)
  const pickerUrl = new URL(chrome.runtime.getURL('popup/index.html'))
  pickerUrl.searchParams.set('intent', 'authenticator-picker')
  pickerUrl.searchParams.set('request', requestId)
  try {
    if (chrome.windows?.create) {
      await chrome.windows.create({
        url: pickerUrl.toString(),
        type: 'popup',
        width: 460,
        height: 620,
        focused: true,
      })
    } else {
      await chrome.tabs.create({ url: pickerUrl.toString() })
    }
  } catch {
    await removeAuthenticatorPicker(requestId)
    return { ok: false, reason: 'authenticator-picker-open-failed' }
  }
  return { ok: true, status: 'ready', requestId, expiresAt: request.expiresAt }
}

async function queryAuthenticatorPicker(
  message: { payload: { requestId: string; query: string } },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (!isAuthenticatorPickerSender(sender)) {
    return { ok: false, reason: 'authenticator-picker-forbidden' }
  }
  const request = await loadAuthenticatorPicker(message.payload.requestId)
  if (!request) {
    return { ok: false, reason: 'authenticator-picker-expired' }
  }
  const grants = (await passwordPairingGrants()).filter((grant) =>
    request.allowedVaultStoreIds.includes(grant.vaultStoreId),
  )
  const accounts = await authenticatorAccounts(grants, message.payload.query)
  return { ok: true, origin: request.origin, accounts }
}

async function selectAuthenticatorPicker(
  message: {
    payload: {
      requestId: string
      vaultStoreId: string
      secretId: string
    }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (!isAuthenticatorPickerSender(sender)) {
    return { ok: false, reason: 'authenticator-picker-forbidden' }
  }
  const request = await loadAuthenticatorPicker(message.payload.requestId)
  if (!request) {
    return { ok: false, reason: 'authenticator-picker-expired' }
  }
  const grants = (await passwordPairingGrants()).filter((grant) =>
    request.allowedVaultStoreIds.includes(grant.vaultStoreId),
  )
  const accounts = await authenticatorAccounts(grants, '')
  const selected = accounts.find(
    (account) =>
      account.vaultStoreId === message.payload.vaultStoreId &&
      account.secretId === message.payload.secretId,
  )
  if (!selected) {
    return { ok: false, reason: 'authenticator-picker-selection-invalid' }
  }
  try {
    const response: unknown = await chrome.tabs.sendMessage(request.tabId, {
      type: 'nook:website-authenticator-selected',
      payload: {
        origin: request.origin,
        requestId: request.requestId,
        account: {
          vaultStoreId: selected.vaultStoreId,
          secretId: selected.secretId,
        },
      },
    })
    if (
      !response ||
      typeof response !== 'object' ||
      !('ok' in response) ||
      response.ok !== true
    ) {
      return { ok: false, reason: 'authenticator-picker-page-unavailable' }
    }
  } catch {
    return { ok: false, reason: 'authenticator-picker-page-unavailable' }
  }
  await removeAuthenticatorPicker(request.requestId)
  return { ok: true }
}

async function cancelAuthenticatorPicker(
  message: { payload: { requestId: string } },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const request = await loadAuthenticatorPicker(message.payload.requestId)
  if (!request) {
    return { ok: true }
  }
  if (
    !isAuthenticatorPickerSender(sender) &&
    !isAuthorizedWebsiteSender(sender, request.origin)
  ) {
    return { ok: false, reason: 'authenticator-picker-forbidden' }
  }
  await removeAuthenticatorPicker(request.requestId)
  try {
    await chrome.tabs.sendMessage(request.tabId, {
      type: 'nook:website-authenticator-canceled',
      payload: {
        origin: request.origin,
        requestId: request.requestId,
      },
    })
  } catch {
    // The website may have navigated while its picker was open. The pending
    // request is still canceled and must not remain reusable.
  }
  return { ok: true }
}

async function websiteAuthenticatorFill(
  message: {
    payload: { origin: string; vaultStoreId: string; secretId: string }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const access = await authorizedWebsiteGrant(
    message.payload.origin,
    message.payload.vaultStoreId,
    sender,
    {
      forbidden: 'authenticator-forbidden-origin',
      missing: 'authenticator-vault-not-granted',
      locked: 'authenticator-locked',
    },
  )
  if ('response' in access) return access.response
  return sendSessionMessage({
    type: 'nook:extension-session-authenticator-code',
    payload: { ...access.grant, secretId: message.payload.secretId },
  })
}

async function websiteAuthenticatorEnrollPreview(
  message: {
    payload: { origin: string; otpauthUri: string }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (!isAuthorizedWebsiteSender(sender, message.payload.origin)) {
    return { ok: false, reason: 'authenticator-forbidden-origin' }
  }
  const grants = await passwordPairingGrants()
  if (grants.length === 0) {
    return { ok: true, status: 'unavailable' }
  }
  await ensureExtensionSessionDocument()
  try {
    const response = await sendSessionMessage({
      type: 'nook:extension-session-authenticator-enroll-preview',
      payload: { otpauthUri: message.payload.otpauthUri },
    })
    if (
      !response ||
      typeof response !== 'object' ||
      !('ok' in response) ||
      response.ok !== true ||
      !('preview' in response) ||
      !response.preview ||
      typeof response.preview !== 'object'
    ) {
      return { ok: false, reason: 'authenticator-preview-failed' }
    }
    const preview = response.preview as OtpauthEnrollmentPreview
    return {
      ok: true,
      status: 'ready',
      preview,
      vaultStoreId: grants[0]?.vaultStoreId,
      vaultName: grants[0]?.vaultName,
    }
  } catch {
    return { ok: false, reason: 'authenticator-preview-invalid' }
  }
}

type StagedAuthenticatorEnrollment = {
  stageId: string
  origin: string
  vaultStoreId: string
  otpauthUri: string
  expiresAt: number
}

const STAGED_ENROLLMENT_TTL_MS = 5 * 60 * 1000
const stagedAuthenticatorEnrollments = new Map<
  string,
  StagedAuthenticatorEnrollment
>()

function purgeExpiredStagedEnrollments(now = Date.now()): void {
  for (const [stageId, staged] of stagedAuthenticatorEnrollments) {
    if (staged.expiresAt <= now) {
      staged.otpauthUri = ''
      stagedAuthenticatorEnrollments.delete(stageId)
    }
  }
}

function clearStagedEnrollment(stageId: string): void {
  const staged = stagedAuthenticatorEnrollments.get(stageId)
  if (!staged) return
  staged.otpauthUri = ''
  stagedAuthenticatorEnrollments.delete(stageId)
}

async function websiteAuthenticatorEnrollStage(
  message: {
    payload: { origin: string; vaultStoreId: string; otpauthUri: string }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (!isAuthorizedWebsiteSender(sender, message.payload.origin)) {
    return { ok: false, reason: 'authenticator-forbidden-origin' }
  }
  const grant = (await passwordPairingGrants()).find(
    (candidate) => candidate.vaultStoreId === message.payload.vaultStoreId,
  )
  if (!grant) return { ok: false, reason: 'authenticator-vault-not-granted' }
  purgeExpiredStagedEnrollments()
  for (const [stageId, staged] of stagedAuthenticatorEnrollments) {
    if (staged.origin === message.payload.origin) {
      clearStagedEnrollment(stageId)
    }
  }
  const stageId = crypto.randomUUID()
  stagedAuthenticatorEnrollments.set(stageId, {
    stageId,
    origin: message.payload.origin,
    vaultStoreId: message.payload.vaultStoreId,
    otpauthUri: message.payload.otpauthUri,
    expiresAt: Date.now() + STAGED_ENROLLMENT_TTL_MS,
  })
  return { ok: true, stageId }
}

async function websiteAuthenticatorEnrollCode(
  message: {
    payload: { origin: string; stageId: string }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (!isAuthorizedWebsiteSender(sender, message.payload.origin)) {
    return { ok: false, reason: 'authenticator-forbidden-origin' }
  }
  purgeExpiredStagedEnrollments()
  const staged = stagedAuthenticatorEnrollments.get(message.payload.stageId)
  if (!staged || staged.origin !== message.payload.origin) {
    return { ok: false, reason: 'authenticator-stage-missing' }
  }
  await ensureExtensionSessionDocument()
  try {
    return await sendSessionMessage({
      type: 'nook:extension-session-authenticator-enroll-code',
      payload: { otpauthUri: staged.otpauthUri },
    })
  } catch {
    return { ok: false, reason: 'authenticator-code-failed' }
  }
}

async function websiteAuthenticatorEnrollConfirm(
  message: {
    payload: { origin: string; vaultStoreId: string; stageId: string }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (!isAuthorizedWebsiteSender(sender, message.payload.origin)) {
    return { ok: false, reason: 'authenticator-forbidden-origin' }
  }
  purgeExpiredStagedEnrollments()
  const staged = stagedAuthenticatorEnrollments.get(message.payload.stageId)
  if (
    !staged ||
    staged.origin !== message.payload.origin ||
    staged.vaultStoreId !== message.payload.vaultStoreId
  ) {
    return { ok: false, reason: 'authenticator-stage-missing' }
  }
  const access = await authorizedWebsiteGrant(
    message.payload.origin,
    message.payload.vaultStoreId,
    sender,
    {
      forbidden: 'authenticator-forbidden-origin',
      missing: 'authenticator-vault-not-granted',
      locked: 'authenticator-locked',
    },
  )
  if ('response' in access) return access.response
  try {
    const response = await sendSessionMessage({
      type: 'nook:extension-session-authenticator-enroll-confirm',
      payload: {
        ...access.grant,
        otpauthUri: staged.otpauthUri,
        origin: message.payload.origin,
      },
    })
    clearStagedEnrollment(message.payload.stageId)
    return response
  } catch {
    return { ok: false, reason: 'authenticator-enroll-failed' }
  }
}

async function websiteAuthenticatorEnrollDismiss(
  message: {
    payload: { origin: string; stageId: string }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (!isAuthorizedWebsiteSender(sender, message.payload.origin)) {
    return { ok: false, reason: 'authenticator-forbidden-origin' }
  }
  const staged = stagedAuthenticatorEnrollments.get(message.payload.stageId)
  if (staged && staged.origin === message.payload.origin) {
    clearStagedEnrollment(message.payload.stageId)
  }
  return { ok: true }
}

async function websiteAuthenticatorEnrollPending(
  message: {
    payload: { origin: string }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (!isAuthorizedWebsiteSender(sender, message.payload.origin)) {
    return { ok: false, reason: 'authenticator-forbidden-origin' }
  }
  purgeExpiredStagedEnrollments()
  for (const staged of stagedAuthenticatorEnrollments.values()) {
    if (staged.origin === message.payload.origin) {
      return {
        ok: true,
        stageId: staged.stageId,
        vaultStoreId: staged.vaultStoreId,
      }
    }
  }
  return { ok: true }
}

async function websiteAuthenticatorBackupAttach(
  message: {
    payload: {
      origin: string
      vaultStoreId: string
      secretId: string
      codes: string[]
      mode: 'replace' | 'merge'
    }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const access = await authorizedWebsiteGrant(
    message.payload.origin,
    message.payload.vaultStoreId,
    sender,
    {
      forbidden: 'authenticator-forbidden-origin',
      missing: 'authenticator-vault-not-granted',
      locked: 'authenticator-locked',
    },
  )
  if ('response' in access) return access.response
  return sendSessionMessage({
    type: 'nook:extension-session-authenticator-backup-attach',
    payload: {
      ...access.grant,
      secretId: message.payload.secretId,
      codes: message.payload.codes,
      mode: message.payload.mode,
    },
  })
}

function passkeyRequestKey(
  sender: chrome.runtime.MessageSender,
  requestId: string,
): string {
  return `${sender.tab?.id ?? -1}:${sender.frameId ?? 0}:${requestId}`
}

const PASSKEY_ACCOUNT_LOOKUP_TIMEOUT_MS = 1500

async function matchingPasskeyAccountCountForOrigin(
  origin: string,
  queueExpiresAt: number,
): Promise<number> {
  let hostname: string
  try {
    hostname = new URL(origin).hostname
  } catch {
    return 0
  }
  if (!hostname) return 0
  const grants = await passkeyPairingGrants()
  if (grants.length === 0) return 0
  try {
    await ensureExtensionSessionDocument()
  } catch {
    return 0
  }
  const status = await sendSessionMessage({
    type: 'nook:extension-session-status',
    payload: { queueExpiresAt },
  })
  if (
    !status ||
    typeof status !== 'object' ||
    !('status' in status) ||
    status.status !== 'unlocked'
  ) {
    return 0
  }
  let count = 0
  for (const grant of grants) {
    const response = await sendSessionMessage({
      type: 'nook:extension-session-list-passkeys',
      payload: { ...grant, rpId: hostname, origin, queueExpiresAt },
    })
    if (
      response &&
      typeof response === 'object' &&
      'ok' in response &&
      response.ok === true &&
      'accounts' in response &&
      Array.isArray(response.accounts)
    ) {
      count += response.accounts.length
    }
  }
  return Math.min(count, 100)
}

/** Never fail a workflow snapshot on passkey lookup; slow/failed → 0. */
async function matchingPasskeyAccountCountForOriginSafe(
  origin: string,
): Promise<number> {
  const queueExpiresAt = Date.now() + PASSKEY_ACCOUNT_LOOKUP_TIMEOUT_MS
  try {
    return await Promise.race([
      matchingPasskeyAccountCountForOrigin(origin, queueExpiresAt),
      new Promise<number>((resolve) => {
        setTimeout(() => resolve(0), PASSKEY_ACCOUNT_LOOKUP_TIMEOUT_MS)
      }),
    ])
  } catch {
    return 0
  }
}

async function websitePasskeyOptions(
  message: Parameters<typeof isWebsitePasskeyOptionsMessage>[0] & {
    payload: {
      requestId: string
      ceremony: WebsitePasskeyCeremony
      requestJson: string
    }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const context = requestOriginAndRpId(
    message.payload.ceremony,
    message.payload.requestJson,
  )
  if (!context || !isAuthorizedWebsiteSender(sender, context.origin)) {
    return { ok: false, reason: 'passkey-forbidden-origin' }
  }
  const grants = await passkeyPairingGrants()
  if (grants.length === 0)
    return { ok: true, status: 'unavailable', options: [] }
  await ensureExtensionSessionDocument()
  const status = await sendSessionMessage({
    type: 'nook:extension-session-status',
  })
  if (
    !status ||
    typeof status !== 'object' ||
    !('status' in status) ||
    status.status !== 'unlocked'
  ) {
    return { ok: true, status: 'locked', options: [] }
  }
  if (message.payload.ceremony === 'create') {
    return {
      ok: true,
      status: 'ready',
      options: grants.map((grant) => ({
        vaultStoreId: grant.vaultStoreId,
        vaultName: grant.vaultName,
      })),
    }
  }
  const options: unknown[] = []
  for (const grant of grants) {
    const response = await sendSessionMessage({
      type: 'nook:extension-session-list-passkeys',
      payload: { ...grant, rpId: context.rpId, origin: context.origin },
    })
    if (
      response &&
      typeof response === 'object' &&
      'ok' in response &&
      response.ok === true &&
      'accounts' in response &&
      Array.isArray(response.accounts)
    ) {
      for (const account of response.accounts) {
        options.push({
          vaultStoreId: grant.vaultStoreId,
          vaultName: grant.vaultName,
          account,
        })
      }
    }
  }
  return { ok: true, status: 'ready', options }
}

async function performWebsitePasskey(
  message: Parameters<typeof isWebsitePasskeyPerformMessage>[0] & {
    payload: {
      requestId: string
      ceremony: WebsitePasskeyCeremony
      requestJson: string
      vaultStoreId: string
      credentialId?: string
    }
  },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const context = requestOriginAndRpId(
    message.payload.ceremony,
    message.payload.requestJson,
  )
  if (!context || !isAuthorizedWebsiteSender(sender, context.origin)) {
    return { ok: false, reason: 'passkey-forbidden-origin' }
  }
  const key = passkeyRequestKey(sender, message.payload.requestId)
  if (pendingWebsitePasskeyRequests.has(key)) {
    return { ok: false, reason: 'passkey-request-already-pending' }
  }
  pendingWebsitePasskeyRequests.add(key)
  try {
    const grant = (await passkeyPairingGrants()).find(
      (candidate) => candidate.vaultStoreId === message.payload.vaultStoreId,
    )
    if (!grant) return { ok: false, reason: 'passkey-vault-not-granted' }
    if (message.payload.ceremony === 'get' && message.payload.credentialId) {
      context.request.allowCredentials = [{ id: message.payload.credentialId }]
    }
    await ensureExtensionSessionDocument()
    return sendSessionMessage({
      type:
        message.payload.ceremony === 'create'
          ? 'nook:extension-session-register-passkey'
          : 'nook:extension-session-assert-passkey',
      payload: {
        ...grant,
        requestJson: JSON.stringify(context.request),
      },
    })
  } finally {
    pendingWebsitePasskeyRequests.delete(key)
  }
}

function removeLocalStorage(keys: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      const message = chrome.runtime.lastError?.message
      if (message) reject(new Error(message))
      else resolve()
    })
  })
}

async function importApprovedPairing(
  message: ExtensionPairingApprovedMessage,
): Promise<{ ok: boolean; reason?: string; eventCount?: number }> {
  try {
    const imported = await importExtensionEventLog(
      message.payload,
      message.eventLogRecords,
    )
    if (!imported.accessGranted) {
      return { ok: false, reason: 'event-log-access-not-granted' }
    }
    await setLocalStorage(
      extensionPairingGrantStorageItems(message.payload, imported),
    )
    await ensureExtensionSessionDocument()
    const sessionImport = await sendSessionMessage({
      type: 'nook:extension-session-import-vault',
      payload: {
        vaultStoreId: message.payload.vaultStoreId,
        deviceId: message.payload.deviceId,
        devicePublicKey: message.payload.devicePublicKey,
        deviceSigningPublicKey: message.payload.deviceSigningPublicKey,
        eventLogRecords: message.eventLogRecords,
        providers: message.payload.providers,
      },
    })
    if (
      !sessionImport ||
      typeof sessionImport !== 'object' ||
      !('ok' in sessionImport) ||
      sessionImport.ok !== true
    ) {
      await removeLocalStorage([
        pairingGrantStorageKey(message.payload.vaultStoreId),
        setupStorageKey,
      ])
      return { ok: false, reason: 'extension-vault-import-failed' }
    }
    return { ok: true, eventCount: imported.eventCount }
  } catch {
    return { ok: false, reason: 'event-log-import-failed' }
  }
}

async function importLocalEventLogUpdate(
  vaultStoreId: string,
  eventLogRecords: Parameters<typeof importExtensionEventLog>[1],
): Promise<{ ok: boolean; reason?: string; eventCount?: number }> {
  const key = pairingGrantStorageKey(vaultStoreId)
  try {
    const stored = await getLocalStorage(key)
    const grant = stored[key]
    if (!isStoredExtensionPairingGrant(grant)) {
      return { ok: false, reason: 'vault-not-paired' }
    }
    const imported = await importExtensionEventLog(grant, eventLogRecords)
    if (!imported.accessGranted) {
      await removeLocalStorage([key, setupStorageKey])
      return { ok: false, reason: 'event-log-access-revoked' }
    }
    await setLocalStorage(
      extensionStoredPairingGrantStorageItems(grant, imported),
    )
    await ensureExtensionSessionDocument()
    await sendSessionMessage({
      type: 'nook:extension-session-update-vault',
      payload: {
        vaultStoreId: grant.vaultStoreId,
        deviceId: grant.deviceId,
        devicePublicKey: grant.devicePublicKey,
        deviceSigningPublicKey: grant.deviceSigningPublicKey,
        eventLogRecords,
      },
    })
    return { ok: true, eventCount: imported.eventCount }
  } catch {
    return { ok: false, reason: 'event-log-import-failed' }
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install') {
    return
  }

  chrome.storage.local.set({
    installedAt: new Date().toISOString(),
  })
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isWebsiteAuthenticatorPickerOpenMessage(message)) {
    void openWebsiteAuthenticatorPicker(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'authenticator-picker-open-failed' }),
      )
    return true
  }

  if (isAuthenticatorPickerQueryMessage(message)) {
    void queryAuthenticatorPicker(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({
          ok: false,
          reason: 'authenticator-picker-query-failed',
        }),
      )
    return true
  }

  if (isAuthenticatorPickerSelectMessage(message)) {
    void selectAuthenticatorPicker(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({
          ok: false,
          reason: 'authenticator-picker-select-failed',
        }),
      )
    return true
  }

  if (isAuthenticatorPickerCancelMessage(message)) {
    void cancelAuthenticatorPicker(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({
          ok: false,
          reason: 'authenticator-picker-cancel-failed',
        }),
      )
    return true
  }

  if (isAuthenticationWorkflowSnapshotMessage(message)) {
    if (!isAuthorizedWebsiteSender(sender, message.payload.origin)) {
      sendResponse({ ok: false, reason: 'workflow-forbidden-origin' })
      return false
    }
    const needsPasskeyLookup = message.payload.observations.some(
      (observation) => observation.passkeyControlPresent,
    )
    void (
      needsPasskeyLookup
        ? matchingPasskeyAccountCountForOriginSafe(message.payload.origin)
        : Promise.resolve(0)
    )
      .then((matchingPasskeyAccountCount) =>
        authenticationWorkflowSnapshot(
          message.payload.observations.map((observation) => ({
            ...observation,
            matchingPasskeyAccountCount: observation.passkeyControlPresent
              ? matchingPasskeyAccountCount
              : 0,
          })),
        ),
      )
      .then((snapshot) => sendResponse({ ok: true, snapshot }))
      .catch(() =>
        sendResponse({ ok: false, reason: 'workflow-snapshot-failed' }),
      )
    return true
  }

  if (isAuthenticationOutcomeClassifyMessage(message)) {
    void classifyAuthenticationOutcome(
      message.payload.observation,
      message.payload.timeoutMs,
    )
      .then((verdict) => sendResponse({ ok: true, verdict }))
      .catch(() =>
        sendResponse({ ok: false, reason: 'outcome-classify-failed' }),
      )
    return true
  }

  if (
    message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'nook:website-generate-password' &&
    'payload' in message &&
    typeof message.payload === 'object' &&
    message.payload &&
    'origin' in message.payload &&
    typeof message.payload.origin === 'string'
  ) {
    if (
      !isAuthorizedWebsiteSender(
        sender,
        (message.payload as { origin: string }).origin,
      )
    ) {
      sendResponse({ ok: false, reason: 'generate-password-forbidden-origin' })
      return false
    }
    void generateSuggestedPassword()
      .then((password) => sendResponse({ ok: true, password }))
      .catch(() =>
        sendResponse({ ok: false, reason: 'generate-password-failed' }),
      )
    return true
  }

  if (isWebsitePasskeyOptionsMessage(message)) {
    void websitePasskeyOptions(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'passkey-options-failed' }),
      )
    return true
  }

  if (isWebsitePasskeyPerformMessage(message)) {
    void performWebsitePasskey(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'passkey-ceremony-failed' }),
      )
    return true
  }

  if (isWebsiteLoginOptionsMessage(message)) {
    void websiteLoginOptions(message, sender)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, reason: 'login-options-failed' }))
    return true
  }

  if (isWebsiteLoginRevealMessage(message)) {
    void websiteLoginFill(message, sender)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, reason: 'login-fill-failed' }))
    return true
  }

  if (isWebsiteLoginSaveOfferMessage(message)) {
    void websiteLoginSaveOffer(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'login-save-offer-failed' }),
      )
    return true
  }

  if (isWebsiteLoginSavePendingMessage(message)) {
    void websiteLoginSavePending(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'login-save-pending-failed' }),
      )
    return true
  }

  if (isWebsiteLoginSaveCommitMessage(message)) {
    void websiteLoginSaveCommit(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'login-save-commit-failed' }),
      )
    return true
  }

  if (isWebsiteLoginSaveDismissMessage(message)) {
    void websiteLoginSaveDismiss(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'login-save-dismiss-failed' }),
      )
    return true
  }

  if (isWebsiteAuthenticatorOptionsMessage(message)) {
    void websiteAuthenticatorOptions(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'authenticator-options-failed' }),
      )
    return true
  }

  if (isWebsiteAuthenticatorFillMessage(message)) {
    void websiteAuthenticatorFill(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'authenticator-fill-failed' }),
      )
    return true
  }

  if (isWebsiteAuthenticatorEnrollPreviewMessage(message)) {
    void websiteAuthenticatorEnrollPreview(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'authenticator-preview-failed' }),
      )
    return true
  }

  if (isWebsiteAuthenticatorEnrollStageMessage(message)) {
    void websiteAuthenticatorEnrollStage(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'authenticator-stage-failed' }),
      )
    return true
  }

  if (isWebsiteAuthenticatorEnrollCodeMessage(message)) {
    void websiteAuthenticatorEnrollCode(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'authenticator-code-failed' }),
      )
    return true
  }

  if (isWebsiteAuthenticatorEnrollConfirmMessage(message)) {
    void websiteAuthenticatorEnrollConfirm(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'authenticator-enroll-failed' }),
      )
    return true
  }

  if (isWebsiteAuthenticatorEnrollDismissMessage(message)) {
    void websiteAuthenticatorEnrollDismiss(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'authenticator-dismiss-failed' }),
      )
    return true
  }

  if (isWebsiteAuthenticatorEnrollPendingMessage(message)) {
    void websiteAuthenticatorEnrollPending(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'authenticator-pending-failed' }),
      )
    return true
  }

  if (isWebsiteAuthenticatorBackupAttachMessage(message)) {
    void websiteAuthenticatorBackupAttach(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'authenticator-backup-failed' }),
      )
    return true
  }

  if (isExtensionSessionEnsureMessage(message)) {
    if (sender.id !== chrome.runtime.id) {
      sendResponse({ ok: false, reason: 'forbidden-sender' })
      return false
    }
    void ensureExtensionSessionDocument()
      .then(() => sendResponse({ ok: true }))
      .catch(() =>
        sendResponse({ ok: false, reason: 'session-runtime-failed' }),
      )
    return true
  }

  if (isExtensionSessionLockMessage(message)) {
    const extensionSender =
      sender.id === chrome.runtime.id &&
      (sender.url === undefined ||
        sender.url.startsWith(chrome.runtime.getURL('')))
    if (!extensionSender) {
      sendResponse({ ok: false, reason: 'forbidden-sender' })
      return false
    }
    void closeExtensionSessionDocument()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false, reason: 'session-lock-failed' }))
    return true
  }

  if (isExtensionSessionExpiryMessage(message)) {
    if (
      sender.id !== chrome.runtime.id ||
      !sender.url?.endsWith(`/${extensionSessionDocument}`)
    ) {
      sendResponse({ ok: false, reason: 'forbidden-sender' })
      return false
    }
    void closeExtensionSessionDocument().then(() => sendResponse({ ok: true }))
    return true
  }

  if (
    hasPairingApprovedType(message) &&
    !isExtensionPairingApprovedMessage(message)
  ) {
    sendResponse({ ok: false, reason: 'invalid-pairing-grant' })
    return false
  }

  if (isExtensionPairingApprovedMessage(message)) {
    if (sender.id !== chrome.runtime.id) {
      sendResponse({ ok: false, reason: 'forbidden-sender' })
      return false
    }

    void importApprovedPairing(message).then(sendResponse)
    return true
  }

  if (isExtensionLocalEventLogUpdatedMessage(message)) {
    if (sender.id !== chrome.runtime.id || !isNokeySender(sender)) {
      sendResponse({ ok: false, reason: 'forbidden-sender' })
      return false
    }
    void importLocalEventLogUpdate(
      message.payload.vaultStoreId,
      message.payload.eventLogRecords,
    ).then(sendResponse)
    return true
  }

  if (isOpenSimpleVaultMessage(message)) {
    if (sender.id !== chrome.runtime.id) {
      sendResponse({ ok: false, reason: 'forbidden-sender' })
      return false
    }
    openSimpleVault()
    sendResponse({ ok: true })
    return false
  }

  if (isOpenCompanionLauncherMessage(message)) {
    if (sender.id !== chrome.runtime.id) {
      sendResponse({ ok: false, reason: 'forbidden-sender' })
      return false
    }
    void openCompanionLauncher(message.payload?.intent)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false, reason: 'launcher-failed' }))
    return true
  }

  if (isBeginExtensionPairingMessage(message)) {
    if (sender.id !== chrome.runtime.id) {
      sendResponse({ ok: false, reason: 'forbidden-sender' })
      return false
    }
    void openExtensionPairing(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false, reason: 'pairing-launch-failed' }))
    return true
  }

  return false
})

chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    if (isOpenCompanionLauncherMessage(message)) {
      if (!isNokeySender(sender)) {
        sendResponse({ ok: false, reason: 'forbidden-sender' })
        return false
      }
      void openCompanionLauncher(message.payload?.intent)
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false, reason: 'launcher-failed' }))
      return true
    }

    if (isExtensionPairedVaultIdentityDiscoveryMessage(message)) {
      if (!isNokeySender(sender)) {
        sendResponse({ ok: false, reason: 'forbidden-sender' })
        return false
      }
      void discoverPairedVaultIdentity(message).then(sendResponse)
      return true
    }

    if (isExtensionPairedVaultUnlockRequestMessage(message)) {
      if (!isNokeySender(sender)) {
        sendResponse({ ok: false, reason: 'forbidden-sender' })
        return false
      }
      void requestPairedVaultUnlock(message)
        .then(sendResponse)
        .catch(() =>
          sendResponse({
            ok: false,
            requestId: message.payload.requestId,
            vaultStoreId: message.payload.vaultStoreId,
            reason: 'unlock-launch-failed',
          }),
        )
      return true
    }

    if (isExtensionIdentityHandoffRequestMessage(message)) {
      if (!isNokeySender(sender)) {
        sendResponse({ ok: false, reason: 'forbidden-sender' })
        return false
      }
      void createIdentityHandoff(message).then(sendResponse)
      return true
    }

    if (isExtensionPairedVaultIdentityHandoffRequestMessage(message)) {
      if (!isNokeySender(sender)) {
        sendResponse({ ok: false, reason: 'forbidden-sender' })
        return false
      }
      void createIdentityHandoff(message).then(sendResponse)
      return true
    }

    if (!isExtensionPairingApprovedMessage(message) || !isNokeySender(sender)) {
      sendResponse({ ok: false, reason: 'invalid-pairing-grant' })
      return false
    }

    void importApprovedPairing(message).then(sendResponse)
    return true
  },
)
