import {
  ExtensionIdentityHandoffRequestMessageType,
  type BeginExtensionPairingMessage,
  type CompanionIdentityDiscoveryTransportResponse,
  type CompanionIdentityHandoffTransportResponse,
  type ExtensionIdentityHandoffRequestMessage,
  type ExtensionPairedVaultIdentityDiscoveryMessage,
  type ExtensionPairedVaultIdentityHandoffRequestMessage,
  type ExtensionPairedVaultUnlockRequestMessage,
} from '../../../../nook-web-shared/src/extension/runtime-messages'
import { companionWasmReady } from '../../../../nook-web-shared/src/extension/companion-ready'
import { OpenCompanionLauncherIntent } from '../../../../nook-web-shared/src/extension/companion-launcher-message'
import { ExtensionConnectScope } from '../../../../nook-web-shared/src/extension/extension-connect-scope'
import {
  admit_companion_identity_status,
  decode_extension_session_status_response,
  ExtensionSessionStatusAvailability,
  type CompanionExtensionPresence,
  type CompanionIdentityStatusAdmissionRequest,
  type CompanionUnlockedAppKey,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { runtimeSimpleVaultUrl } from '../../lib/simple-vault-runtime'
import { WebsiteAuthenticatorResponseStatus } from '../../lib/login-fill-messages'
import {
  COMPANION_IDENTITY_DISCOVERY_SESSION_MESSAGE_TYPE,
  COMPANION_IDENTITY_HANDOFF_SESSION_MESSAGE_TYPE,
  extensionSessionInteractiveDeadline,
  extensionSessionProbeDeadline,
  type CompanionIdentityDiscoverySessionTransportRequest,
  type CompanionIdentityHandoffSessionTransportRequest,
} from '../../offscreen/session-request-adapter'
import {
  parsedWebsitePasskeyRequest,
  WebsitePasskeyRequestParseKind,
  type WebsitePasskeyCeremony,
  type WebsitePasskeyRequest,
} from '../../lib/webauthn-messages'
import type {
  ExtensionPairingItems,
  LegacyPairingStorageItems,
  StoredExtensionPairingGrant,
} from '../pairing-grants'
import {
  extensionPairingGrantPolicyReady,
  setupStorageKey,
} from '../pairing-grants'
import {
  loadExtensionPairingItems,
  persistExtensionPairingItems,
} from '../vault-runtime'
import {
  SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS,
  ensureExtensionSessionDocument,
  isUnlockedSessionStatus,
  openCompanionLauncher,
  openCompanionLauncherBestEffort,
} from './session-lifecycle'
import { identityHandoffSessionRequest } from './session-request-projections'

enum PendingIdentityHandoffKind {
  Pairing = 'pairing',
}

type PendingIdentityHandoff = {
  kind: PendingIdentityHandoffKind.Pairing
  deviceId: string
  devicePublicKey: string
  deviceSigningPublicKey: string
}

const pendingIdentityHandoffConsumptions = new Set<string>()

export function randomNonce(): string {
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
    value.kind === PendingIdentityHandoffKind.Pairing
  )
}

type ExtensionSessionStorageWrite = Record<string, unknown>

export function setSessionStorage(
  items: ExtensionSessionStorageWrite,
): Promise<void> {
  // eslint-disable-next-line max-params -- Promise owns the executor callback signature.
  return new Promise((resolve, reject) => {
    chrome.storage.session.set(items, () => {
      const message = chrome.runtime.lastError?.message
      if (message) reject(new Error(message))
      else resolve()
    })
  })
}

export function getSessionStorage(
  key: string,
): Promise<Record<string, unknown>> {
  // eslint-disable-next-line max-params -- Promise owns the executor callback signature.
  return new Promise((resolve, reject) => {
    chrome.storage.session.get(key, (items) => {
      const message = chrome.runtime.lastError?.message
      if (message) reject(new Error(message))
      else resolve(items)
    })
  })
}

export function getAllSessionStorage(): Promise<Record<string, unknown>> {
  // eslint-disable-next-line max-params -- Promise owns the executor callback signature.
  return new Promise((resolve, reject) => {
    chrome.storage.session.get((items) => {
      const message = chrome.runtime.lastError?.message
      if (message) reject(new Error(message))
      else resolve(items)
    })
  })
}

export function removeSessionStorage(key: string): Promise<void> {
  // eslint-disable-next-line max-params -- Promise owns the executor callback signature.
  return new Promise((resolve, reject) => {
    chrome.storage.session.remove(key, () => {
      const message = chrome.runtime.lastError?.message
      if (message) reject(new Error(message))
      else resolve()
    })
  })
}

type IssueIdentityHandoffArgs = {
  nonce: string
  pending: PendingIdentityHandoff
}

async function issueIdentityHandoff({
  nonce,
  pending,
}: IssueIdentityHandoffArgs): Promise<void> {
  const nookTypedArgs0_0: Parameters<typeof setSessionStorage>[0] = {
    [pendingIdentityHandoffStorageKey(nonce)]: pending,
  }
  await setSessionStorage(nookTypedArgs0_0)
}

export async function openExtensionPairing(
  device: BeginExtensionPairingMessage['payload'],
): Promise<void> {
  await companionWasmReady
  const nonce = randomNonce()
  const nookTypedArgs0_1: Parameters<typeof issueIdentityHandoff>[0] = {
    nonce,
    pending: {
      kind: PendingIdentityHandoffKind.Pairing,
      deviceId: device.deviceId,
      devicePublicKey: device.devicePublicKey,
      deviceSigningPublicKey: device.deviceSigningPublicKey,
    },
  }
  await issueIdentityHandoff(nookTypedArgs0_1)
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
    [
      ExtensionConnectScope.VaultAccess,
      ExtensionConnectScope.PasswordFilling,
      ExtensionConnectScope.PasskeyManagement,
      ExtensionConnectScope.SyncProviderCredentials,
    ].join(','),
  )
  const nookTypedArgs0_2: Parameters<typeof chrome.tabs.create>[0] = {
    url: url.toString(),
  }
  void chrome.tabs.create(nookTypedArgs0_2)
}

export function sendSessionMessage(message: unknown): Promise<unknown> {
  // eslint-disable-next-line max-params -- Promise owns the executor callback signature.
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError?.message
      if (error) reject(new Error(error))
      else resolve(response)
    })
  })
}

export async function createIdentityHandoff(
  message: ExtensionIdentityHandoffRequestMessage,
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
      message.type !==
        ExtensionIdentityHandoffRequestMessageType.NookExtensionIdentityHandoffRequest ||
      pending.deviceId !== message.payload.expectedDeviceId ||
      pending.devicePublicKey !== message.payload.expectedDevicePublicKey ||
      pending.deviceSigningPublicKey !==
        message.payload.expectedDeviceSigningPublicKey
    ) {
      return { ok: false, reason: 'extension-identity-handoff-not-issued' }
    }
    await removeSessionStorage(key)
    await ensureExtensionSessionDocument()
    const nookTypedArgs0_3 = identityHandoffSessionRequest(message)
    const response = await sendSessionMessage(nookTypedArgs0_3)
    if (
      !!response &&
      typeof response === 'object' &&
      'ok' in response &&
      response.ok === true &&
      'envelope' in response &&
      typeof response.envelope === 'string'
    ) {
      const nextNonce = randomNonce()
      const nookTypedArgs0_4: Parameters<typeof issueIdentityHandoff>[0] = {
        nonce: nextNonce,
        pending,
      }
      await issueIdentityHandoff(nookTypedArgs0_4)
      return { ok: true, envelope: response.envelope, nextNonce }
    }
    return { ok: false, reason: 'extension-identity-unavailable' }
  } catch {
    return { ok: false, reason: 'extension-identity-handoff-failed' }
  } finally {
    pendingIdentityHandoffConsumptions.delete(nonce)
  }
}

type CurrentPairedVaultPresenceArgs = {
  vaultStoreId: string
  nonce: string
}

async function currentPairedVaultPresence({
  vaultStoreId,
  nonce,
}: CurrentPairedVaultPresenceArgs): Promise<CompanionExtensionPresence> {
  const pairingPolicy = await extensionPairingGrantPolicyReady
  const key = pairingPolicy.pairingGrantStorageKey(vaultStoreId)
  const stored = await getPairingStorage()
  const grant = stored[key]
  if (!pairingPolicy.isStoredExtensionPairingGrant(grant)) {
    return { kind: 'unavailable' }
  }
  const selected = pairingPolicy.selectedPairingGrant(stored)
  const currentGrant = selected.kind === 'selected' ? selected.grant : grant
  await ensureExtensionSessionDocument()
  const statusRequest: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-status',
    payload: {
      queue: extensionSessionProbeDeadline(Date.now() + 5_000),
    },
  }
  const statusResponse = await sendSessionMessage(statusRequest)
  if (
    websiteSessionStatusTransport(statusResponse) !==
    ExtensionSessionStatusAvailability.Unlocked
  ) {
    return {
      kind: 'locked',
      vault_type: currentGrant.vaultType,
      vault_store_id: currentGrant.vaultStoreId,
      vault_name: currentGrant.vaultName,
    }
  }
  return {
    kind: 'unlocked',
    vault_type: currentGrant.vaultType,
    vault_store_id: currentGrant.vaultStoreId,
    vault_name: currentGrant.vaultName,
    app_key: {
      extensionRuntimeId: chrome.runtime.id,
      appKey: {
        appId: currentGrant.deviceId,
        encryptionPublicKey: currentGrant.devicePublicKey,
        signingPublicKey: currentGrant.deviceSigningPublicKey,
        installationLabel: currentGrant.deviceLabel,
      },
      nonce,
      scopes: currentGrant.scopes,
    },
  }
}

export async function createPairedIdentityHandoff(
  message: ExtensionPairedVaultIdentityHandoffRequestMessage,
): Promise<CompanionIdentityHandoffTransportResponse> {
  try {
    await companionWasmReady
    const candidate = Object(message.payload)
    const transaction = Object(Reflect.get(candidate, 'transaction'))
    const admissionRequest = {
      discovery: Reflect.get(transaction, 'discovery'),
      status: Reflect.get(transaction, 'status'),
      observedAt: Date.now(),
    } satisfies CompanionIdentityStatusAdmissionRequest
    const admission = Reflect.apply(
      admit_companion_identity_status,
      globalThis,
      [admissionRequest],
    )
    if (
      admission.kind !== 'accepted' ||
      admission.transaction.status.status !== 'unlocked'
    ) {
      return { ok: false, reason: 'extension-identity-handoff-not-issued' }
    }
    const currentPresenceArgs: CurrentPairedVaultPresenceArgs = {
      vaultStoreId: admission.transaction.discovery.request.vaultStoreId,
      nonce: admission.transaction.status.app_key.nonce,
    }
    const presence = await currentPairedVaultPresence(currentPresenceArgs)
    await ensureExtensionSessionDocument()
    const authorization = {
      request: message.payload,
      observedAt: Date.now(),
      presence,
    }
    const sessionRequest: CompanionIdentityHandoffSessionTransportRequest = {
      type: COMPANION_IDENTITY_HANDOFF_SESSION_MESSAGE_TYPE,
      payload: { authorization },
    }
    const response = await sendSessionMessage(sessionRequest)
    if (
      !!response &&
      typeof response === 'object' &&
      'ok' in response &&
      response.ok === true &&
      'response' in response
    ) {
      return { ok: true, response: response.response }
    }
    return { ok: false, reason: 'extension-identity-unavailable' }
  } catch {
    return { ok: false, reason: 'extension-identity-handoff-failed' }
  }
}

type ExtensionSessionStatusResponse = {
  ok?: unknown
  status?: unknown
}

export { ExtensionSessionStatusAvailability }

export function websiteSessionStatusTransport(
  response: unknown,
): ExtensionSessionStatusAvailability {
  try {
    const status: ExtensionSessionStatusAvailability = Reflect.apply(
      decode_extension_session_status_response,
      globalThis,
      [response],
    )
    return status
  } catch {
    return ExtensionSessionStatusAvailability.Unavailable
  }
}

export async function discoverPairedVaultIdentity(
  message: ExtensionPairedVaultIdentityDiscoveryMessage,
): Promise<CompanionIdentityDiscoveryTransportResponse> {
  await companionWasmReady
  const observation = message.payload
  const discover = async (presence: CompanionExtensionPresence) => {
    await ensureExtensionSessionDocument()
    const sessionRequest: CompanionIdentityDiscoverySessionTransportRequest = {
      type: COMPANION_IDENTITY_DISCOVERY_SESSION_MESSAGE_TYPE,
      payload: { presence, discovery: observation },
    }
    const response = await sendSessionMessage(sessionRequest)
    if (
      !!response &&
      typeof response === 'object' &&
      'ok' in response &&
      response.ok === true &&
      'status' in response
    ) {
      return { ok: true as const, status: response.status }
    }
    return { ok: false as const }
  }
  const unavailablePresence: CompanionExtensionPresence = {
    kind: 'unavailable',
  }
  try {
    const discovery = Object(observation)
    const request = Object(Reflect.get(discovery, 'request'))
    const vaultStoreId = Reflect.get(request, 'vaultStoreId')
    const pairingPolicy = await extensionPairingGrantPolicyReady
    const key = pairingPolicy.pairingGrantStorageKey(vaultStoreId)
    const stored = await getPairingStorage()
    const grant = stored[key]
    const selectedGrant = pairingPolicy.selectedPairingGrant(stored)
    if (
      selectedGrant.kind === 'selected' &&
      selectedGrant.grant.vaultStoreId !== vaultStoreId
    ) {
      const selectedPresence: CompanionExtensionPresence = {
        kind: 'locked',
        vault_type: selectedGrant.grant.vaultType,
        vault_store_id: selectedGrant.grant.vaultStoreId,
        vault_name: selectedGrant.grant.vaultName,
      }
      return await discover(selectedPresence)
    }
    if (!pairingPolicy.isStoredExtensionPairingGrant(grant)) {
      const connectedGrant =
        selectedGrant.kind === 'selected'
          ? selectedGrant
          : pairingPolicy.firstStoredPairingGrant(stored)
      if (connectedGrant.kind === 'selected') {
        const connectedPresence: CompanionExtensionPresence = {
          kind: 'locked',
          vault_type: connectedGrant.grant.vaultType,
          vault_store_id: connectedGrant.grant.vaultStoreId,
          vault_name: connectedGrant.grant.vaultName,
        }
        return await discover(connectedPresence)
      }
      return await discover(unavailablePresence)
    }

    await ensureExtensionSessionDocument()
    const nookTypedArgs0_5: Parameters<typeof sendSessionMessage>[0] = {
      type: 'nook:extension-session-status',
      payload: {
        queue: extensionSessionProbeDeadline(Date.now() + 5_000),
      },
    }
    const statusResponse = await sendSessionMessage(nookTypedArgs0_5)
    if (
      websiteSessionStatusTransport(statusResponse) !==
      ExtensionSessionStatusAvailability.Unlocked
    ) {
      const lockedPresence: CompanionExtensionPresence = {
        kind: 'locked',
        vault_type: grant.vaultType,
        vault_store_id: grant.vaultStoreId,
        vault_name: grant.vaultName,
      }
      return await discover(lockedPresence)
    }
    const nonce = randomNonce()
    const presence = {
      kind: 'unlocked',
      vault_type: grant.vaultType,
      vault_store_id: grant.vaultStoreId,
      vault_name: grant.vaultName,
      app_key: {
        extensionRuntimeId: chrome.runtime.id,
        appKey: {
          appId: grant.deviceId,
          encryptionPublicKey: grant.devicePublicKey,
          signingPublicKey: grant.deviceSigningPublicKey,
          installationLabel: grant.deviceLabel,
        },
        nonce,
        scopes: grant.scopes,
      },
    } satisfies Extract<
      CompanionExtensionPresence,
      { app_key: CompanionUnlockedAppKey }
    >
    return await discover(presence)
  } catch {
    return await discover(unavailablePresence)
  }
}

export async function requestPairedVaultUnlock(
  message: ExtensionPairedVaultUnlockRequestMessage,
): Promise<Record<string, unknown>> {
  const { requestId, vaultStoreId } = message.payload
  const pairingPolicy = await extensionPairingGrantPolicyReady
  const key = pairingPolicy.pairingGrantStorageKey(vaultStoreId)
  const stored = await getPairingStorage(key)
  if (!pairingPolicy.isStoredExtensionPairingGrant(stored[key])) {
    return {
      ok: false,
      requestId,
      vaultStoreId,
      reason: 'vault-not-paired',
    }
  }

  await ensureExtensionSessionDocument()
  const queueExpiresAt = Date.now() + SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS
  const nookTypedArgs0_7: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-status',
    payload: { queue: extensionSessionInteractiveDeadline(queueExpiresAt) },
  }
  const statusResponse = (await sendSessionMessage(
    nookTypedArgs0_7,
  )) as ExtensionSessionStatusResponse
  if (!isUnlockedSessionStatus(statusResponse)) {
    await openCompanionLauncher(OpenCompanionLauncherIntent.Default)
  }
  return { ok: true, requestId, vaultStoreId }
}

export enum HasPairingApprovedTypeResultType {
  NookExtensionPairingApproved = 'nook:extension-pairing-approved',
}

export function hasPairingApprovedType(message: unknown): message is {
  type: HasPairingApprovedTypeResultType.NookExtensionPairingApproved
} {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type ===
      HasPairingApprovedTypeResultType.NookExtensionPairingApproved
  )
}

export async function setPairingStorage(
  items: ExtensionPairingItems,
): Promise<void> {
  await ensureLegacyPairingMigration()
  await persistExtensionPairingItems(items)
}

enum LegacyPairingMigrationKind {
  NotStarted = 'not-started',
  Running = 'running',
}

type LegacyPairingMigration =
  | { kind: LegacyPairingMigrationKind.NotStarted }
  | { kind: LegacyPairingMigrationKind.Running; operation: Promise<void> }

let legacyPairingMigration: LegacyPairingMigration = {
  kind: LegacyPairingMigrationKind.NotStarted,
}

function legacyPairingStorageKeys(stored: LegacyPairingStorageItems): string[] {
  return Object.keys(stored).filter(
    (key) =>
      key === setupStorageKey ||
      key.startsWith('nook:extension-pairing-grant:'),
  )
}

function readLegacyPairingStorage(): Promise<LegacyPairingStorageItems> {
  // eslint-disable-next-line max-params -- Promise owns the executor callback signature.
  return new Promise((resolve, reject) => {
    chrome.storage.local.get((items) => {
      if (chrome.runtime.lastError) {
        reject(
          new Error(
            ((...[v = 'Unable to read legacy extension pairing state.']) => v)(
              chrome.runtime.lastError.message,
            ),
          ),
        )
        return
      }
      resolve(items)
    })
  })
}

type LegacyPairingStorageKeys = string[]

function removeLegacyPairingStorage(
  keys: LegacyPairingStorageKeys,
): Promise<void> {
  // eslint-disable-next-line max-params -- Promise owns the executor callback signature.
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime.lastError) {
        reject(
          new Error(
            ((...[v = 'Unable to remove legacy extension pairing state.']) =>
              v)(chrome.runtime.lastError.message),
          ),
        )
        return
      }
      resolve()
    })
  })
}

export function ensureLegacyPairingMigration(): Promise<void> {
  if (legacyPairingMigration.kind === LegacyPairingMigrationKind.Running) {
    return legacyPairingMigration.operation
  }
  const operation = (async () => {
    // Browser storage is a read-once upgrade source only. Rexie remains the
    // sole ongoing owner of pairing state after the legacy rows are removed.
    const legacy = await readLegacyPairingStorage()
    const legacyKeys = legacyPairingStorageKeys(legacy)
    if (legacyKeys.length === 0) return
    const legacyPairingRecords = Object.fromEntries(
      legacyKeys.map((key) => [key, legacy[key]]),
    )
    const current = await loadExtensionPairingItems()
    const pairingPolicy = await extensionPairingGrantPolicyReady
    const migrated =
      pairingPolicy.migratedLegacyPairingStorageItems(legacyPairingRecords)
    if (Object.keys(current).length > 0) {
      const completedKeys = Object.keys(migrated).filter(
        (key) =>
          legacyKeys.includes(key) &&
          key in current &&
          JSON.stringify(current[key]) === JSON.stringify(migrated[key]),
      )
      if (
        completedKeys.length > 0 &&
        completedKeys.length === Object.keys(migrated).length
      ) {
        await removeLegacyPairingStorage(completedKeys)
      }
      return
    }
    if (Object.keys(migrated).length > 0) {
      await persistExtensionPairingItems(migrated)
      await removeLegacyPairingStorage(
        Object.keys(migrated).filter((key) => legacyKeys.includes(key)),
      )
    }
  })()
  legacyPairingMigration = {
    kind: LegacyPairingMigrationKind.Running,
    operation,
  }
  return operation
}

export async function getPairingStorage(
  key?: string,
): Promise<ExtensionPairingItems> {
  await ensureLegacyPairingMigration()
  const stored = await loadExtensionPairingItems()
  if (!key) return stored
  return key in stored ? { [key]: stored[key] } : {}
}

export enum WebsitePasskeyRequestContextKind {
  Rejected = 'rejected',
  Validated = 'validated',
}

export type WebsitePasskeyRequestContext =
  | { kind: WebsitePasskeyRequestContextKind.Rejected }
  | {
      kind: WebsitePasskeyRequestContextKind.Validated
      origin: string
      rpId: string
      request: WebsitePasskeyRequest
    }

type RequestOriginAndRpIdArgs = {
  ceremony: WebsitePasskeyCeremony
  requestJson: string
}

export function requestOriginAndRpId({
  ceremony,
  requestJson,
}: RequestOriginAndRpIdArgs): WebsitePasskeyRequestContext {
  const parseArgs: Parameters<typeof parsedWebsitePasskeyRequest>[0] = {
    ceremony,
    requestJson,
  }
  const parsed = parsedWebsitePasskeyRequest(parseArgs)
  if (parsed.kind === WebsitePasskeyRequestParseKind.Rejected) {
    return { kind: WebsitePasskeyRequestContextKind.Rejected }
  }
  return {
    kind: WebsitePasskeyRequestContextKind.Validated,
    origin: parsed.request.origin,
    rpId: parsed.request.rpId,
    request: parsed.request,
  }
}

type IsAuthorizedWebsiteSenderArgs = {
  sender: chrome.runtime.MessageSender
  origin: string
}

export function isAuthorizedWebsiteSender({
  sender,
  origin,
}: IsAuthorizedWebsiteSenderArgs): boolean {
  if (
    sender.id !== chrome.runtime.id ||
    !sender.tab ||
    !('id' in sender.tab) ||
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

export async function passkeyPairingGrants(): Promise<
  StoredExtensionPairingGrant[]
> {
  const pairingPolicy = await extensionPairingGrantPolicyReady
  const stored = await getPairingStorage()
  return pairingPolicy
    .selectedPairingGrantFirst(stored)
    .filter((grant) =>
      grant.scopes.includes(ExtensionConnectScope.PasskeyManagement),
    )
}

export async function passwordPairingGrants(): Promise<
  StoredExtensionPairingGrant[]
> {
  const pairingPolicy = await extensionPairingGrantPolicyReady
  const stored = await getPairingStorage()
  return pairingPolicy
    .selectedPairingGrantFirst(stored)
    .filter((grant) =>
      grant.scopes.includes(ExtensionConnectScope.PasswordFilling),
    )
}

type AvailableWebsiteGrantsArgs = {
  origin: string
  sender: chrome.runtime.MessageSender
  forbiddenReason: string
}

export async function availableWebsiteGrants({
  origin,
  sender,
  forbiddenReason,
}: AvailableWebsiteGrantsArgs): Promise<WebsiteGrantAccess> {
  const request: WebsiteGrantsArgs = {
    origin,
    sender,
    forbiddenReason,
    openLockedCompanion: true,
  }
  return websiteGrants(request)
}

export async function passiveAvailableWebsiteGrants({
  origin,
  sender,
  forbiddenReason,
}: AvailableWebsiteGrantsArgs): Promise<WebsiteGrantAccess> {
  const request: WebsiteGrantsArgs = {
    origin,
    sender,
    forbiddenReason,
    openLockedCompanion: false,
  }
  return websiteGrants(request)
}

type WebsiteGrantAccess =
  | { grants: StoredExtensionPairingGrant[] }
  | {
      response:
        | { ok: false; reason: string }
        | {
            ok: true
            status:
              | WebsiteAuthenticatorResponseStatus.Unavailable
              | WebsiteAuthenticatorResponseStatus.Locked
          }
    }

type WebsiteGrantsArgs = AvailableWebsiteGrantsArgs & {
  openLockedCompanion: boolean
}

async function websiteGrants({
  origin,
  sender,
  forbiddenReason,
  openLockedCompanion,
}: WebsiteGrantsArgs): Promise<WebsiteGrantAccess> {
  const nookTypedArgs0_8: Parameters<typeof isAuthorizedWebsiteSender>[0] = {
    sender,
    origin,
  }
  if (!isAuthorizedWebsiteSender(nookTypedArgs0_8)) {
    return { response: { ok: false, reason: forbiddenReason } }
  }
  const grants = await passwordPairingGrants()
  if (grants.length === 0) {
    return {
      response: {
        ok: true,
        status: WebsiteAuthenticatorResponseStatus.Unavailable,
      },
    }
  }
  await ensureExtensionSessionDocument()
  const queueExpiresAt = Date.now() + SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS
  const queue = openLockedCompanion
    ? extensionSessionInteractiveDeadline(queueExpiresAt)
    : extensionSessionProbeDeadline(queueExpiresAt)
  const nookTypedArgs0_9: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-status',
    payload: { queue },
  }
  const status = await sendSessionMessage(nookTypedArgs0_9)
  await companionWasmReady
  const sessionStatus = websiteSessionStatusTransport(status)
  if (openLockedCompanion) {
    if (sessionStatus !== ExtensionSessionStatusAvailability.Unlocked) {
      openCompanionLauncherBestEffort(OpenCompanionLauncherIntent.Default)
      return {
        response: {
          ok: true,
          status: WebsiteAuthenticatorResponseStatus.Locked,
        },
      }
    }
    return { grants }
  }
  if (sessionStatus === ExtensionSessionStatusAvailability.Unavailable) {
    return {
      response: {
        ok: true,
        status: WebsiteAuthenticatorResponseStatus.Unavailable,
      },
    }
  }
  return sessionStatus === ExtensionSessionStatusAvailability.Unlocked
    ? { grants }
    : {
        response: {
          ok: true,
          status: WebsiteAuthenticatorResponseStatus.Locked,
        },
      }
}
