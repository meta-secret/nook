import {
  ExtensionIdentityHandoffRequestMessageType,
  ExtensionPairedVaultIdentityHandoffRequestMessageType,
  ExtensionPairedVaultIdentityStatusMessageStatus,
  ExtensionPairedVaultIdentityStatusMessageType,
  type BeginExtensionPairingMessage,
  type ExtensionIdentityHandoffRequestMessage,
  type ExtensionPairedVaultIdentityDiscoveryMessage,
  type ExtensionPairedVaultIdentityHandoffRequestMessage,
  type ExtensionPairedVaultIdentityStatusMessage,
  type ExtensionPairedVaultUnlockRequestMessage,
} from '../../../../nook-web-shared/src/extension/runtime-messages'
import { ExtensionConnectScope } from '../../../../nook-web-shared/src/extension/extension-connect-scope'
import {
  isRuntimeSimpleVaultUrl,
  runtimeSimpleVaultUrl,
} from '../../lib/simple-vault-runtime'
import {
  parsedWebsitePasskeyRequest,
  WebsitePasskeyRequestParseKind,
  type WebsitePasskeyCeremony,
} from '../../lib/webauthn-messages'
import type { StoredExtensionPairingGrant } from '../pairing-grants'
import {
  isStoredExtensionPairingGrant,
  migratedLegacyPairingStorageItems,
  pairingGrantStorageKey,
  selectedPairingGrant,
  selectedPairingGrantFirst,
  SelectedPairingGrantKind,
  setupStorageKey,
} from '../pairing-grants'
import {
  readExtensionPairingState,
  writeExtensionPairingState,
} from '../vault-runtime'
import {
  SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS,
  ensureExtensionSessionDocument,
  isUnlockedSessionStatus,
  openCompanionLauncher,
} from './session-lifecycle'

enum PendingIdentityHandoffKind {
  Pairing = 'pairing',
  PairedVault = 'paired-vault',
}

type PendingIdentityHandoff =
  | {
      kind: PendingIdentityHandoffKind.Pairing
      deviceId: string
      devicePublicKey: string
      deviceSigningPublicKey: string
    }
  | {
      kind: PendingIdentityHandoffKind.PairedVault
      vaultStoreId: string
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
    (value.kind === PendingIdentityHandoffKind.Pairing ||
      (value.kind === PendingIdentityHandoffKind.PairedVault &&
        'vaultStoreId' in value &&
        typeof value.vaultStoreId === 'string'))
  )
}

export function setSessionStorage(
  items: Record<string, unknown>,
): Promise<void> {
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
  return new Promise((resolve, reject) => {
    chrome.storage.session.get(key, (items) => {
      const message = chrome.runtime.lastError?.message
      if (message) reject(new Error(message))
      else resolve(items)
    })
  })
}

export function removeSessionStorage(key: string): Promise<void> {
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

export async function openExtensionPairing(
  device: BeginExtensionPairingMessage['payload'],
): Promise<void> {
  const nonce = randomNonce()
  await issueIdentityHandoff(nonce, {
    kind: PendingIdentityHandoffKind.Pairing,
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
    [
      ExtensionConnectScope.VaultAccess,
      ExtensionConnectScope.PasswordFilling,
      ExtensionConnectScope.PasskeyManagement,
      ExtensionConnectScope.SyncProviderCredentials,
    ].join(','),
  )
  chrome.tabs.create({ url: url.toString() })
}

export function isNokeySender(sender: chrome.runtime.MessageSender): boolean {
  if (!sender.url) return false
  try {
    return isRuntimeSimpleVaultUrl(sender.url)
  } catch {
    return false
  }
}

export function sendSessionMessage(message: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError?.message
      if (error) reject(new Error(error))
      else resolve(response)
    })
  })
}

async function pairedVaultGrantIsCurrent(
  pending: Extract<
    PendingIdentityHandoff,
    { kind: PendingIdentityHandoffKind.PairedVault }
  >,
): Promise<boolean> {
  const key = pairingGrantStorageKey(pending.vaultStoreId)
  const stored = await getPairingStorage(key)
  const grant = stored[key]
  return (
    isStoredExtensionPairingGrant(grant) &&
    grant.deviceId === pending.deviceId &&
    grant.devicePublicKey === pending.devicePublicKey &&
    grant.deviceSigningPublicKey === pending.deviceSigningPublicKey
  )
}

export async function createIdentityHandoff(
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
      (pending.kind === PendingIdentityHandoffKind.Pairing &&
        message.type !==
          ExtensionIdentityHandoffRequestMessageType.NookExtensionIdentityHandoffRequest) ||
      (pending.kind === PendingIdentityHandoffKind.PairedVault &&
        (message.type !==
          ExtensionPairedVaultIdentityHandoffRequestMessageType.NookExtensionPairedVaultIdentityHandoffRequest ||
          pending.vaultStoreId !== message.payload.vaultStoreId)) ||
      pending.deviceId !== message.payload.expectedDeviceId ||
      pending.devicePublicKey !== message.payload.expectedDevicePublicKey ||
      pending.deviceSigningPublicKey !==
        message.payload.expectedDeviceSigningPublicKey
    ) {
      return { ok: false, reason: 'extension-identity-handoff-not-issued' }
    }
    if (
      pending.kind === PendingIdentityHandoffKind.PairedVault &&
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
        pending.kind === PendingIdentityHandoffKind.PairedVault &&
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

enum UnlockedSessionDeviceParseKind {
  Invalid = 'invalid',
  Parsed = 'parsed',
}

type UnlockedSessionDeviceParse =
  | { kind: UnlockedSessionDeviceParseKind.Invalid }
  | {
      kind: UnlockedSessionDeviceParseKind.Parsed
      device: UnlockedSessionDevice
    }

function unlockedSessionDevice(response: unknown): UnlockedSessionDeviceParse {
  if (
    !response ||
    typeof response !== 'object' ||
    !('ok' in response) ||
    response.ok !== true ||
    !isUnlockedSessionStatus(response) ||
    !('device' in response) ||
    !response.device ||
    typeof response.device !== 'object'
  ) {
    return { kind: UnlockedSessionDeviceParseKind.Invalid }
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
    return { kind: UnlockedSessionDeviceParseKind.Invalid }
  }
  return {
    kind: UnlockedSessionDeviceParseKind.Parsed,
    device: {
      deviceId: device.deviceId,
      devicePublicKey: device.devicePublicKey,
      deviceSigningPublicKey: device.deviceSigningPublicKey,
    },
  }
}

export async function discoverPairedVaultIdentity(
  message: ExtensionPairedVaultIdentityDiscoveryMessage,
): Promise<ExtensionPairedVaultIdentityStatusMessage> {
  const { requestId, vaultStoreId } = message.payload
  const unavailable = {
    type: ExtensionPairedVaultIdentityStatusMessageType.NookExtensionPairedVaultIdentityStatus,
    payload: {
      requestId,
      vaultStoreId,
      status: ExtensionPairedVaultIdentityStatusMessageStatus.Unavailable,
    },
  } satisfies ExtensionPairedVaultIdentityStatusMessage
  try {
    const key = pairingGrantStorageKey(vaultStoreId)
    const stored = await getPairingStorage()
    const grant = stored[key]
    const selectedGrant = selectedPairingGrant(stored)
    if (
      selectedGrant.kind === SelectedPairingGrantKind.Selected &&
      selectedGrant.grant.vaultStoreId !== vaultStoreId
    ) {
      return {
        type: ExtensionPairedVaultIdentityStatusMessageType.NookExtensionPairedVaultIdentityStatus,
        payload: {
          requestId,
          vaultStoreId,
          status:
            ExtensionPairedVaultIdentityStatusMessageStatus.DifferentVault,
          connectedVaultStoreId: selectedGrant.grant.vaultStoreId,
          connectedVaultName: selectedGrant.grant.vaultName,
        },
      }
    }
    if (!isStoredExtensionPairingGrant(grant)) {
      const connectedGrant =
        selectedGrant ??
        Object.entries(stored).find(
          ([storedKey, value]) =>
            storedKey.startsWith('nook:extension-pairing-grant:') &&
            isStoredExtensionPairingGrant(value),
        )?.[1]
      if (isStoredExtensionPairingGrant(connectedGrant)) {
        return {
          type: ExtensionPairedVaultIdentityStatusMessageType.NookExtensionPairedVaultIdentityStatus,
          payload: {
            requestId,
            vaultStoreId,
            status:
              ExtensionPairedVaultIdentityStatusMessageStatus.DifferentVault,
            connectedVaultStoreId: connectedGrant.vaultStoreId,
            connectedVaultName: connectedGrant.vaultName,
          },
        }
      }
      return unavailable
    }

    await ensureExtensionSessionDocument()
    const statusResponse = (await sendSessionMessage({
      type: 'nook:extension-session-status',
      payload: { queueExpiresAt: message.payload.expiresAt },
    })) as ExtensionSessionStatusResponse
    if (!isUnlockedSessionStatus(statusResponse)) {
      return {
        type: ExtensionPairedVaultIdentityStatusMessageType.NookExtensionPairedVaultIdentityStatus,
        payload: {
          requestId,
          vaultStoreId,
          status: ExtensionPairedVaultIdentityStatusMessageStatus.Locked,
        },
      }
    }
    const parsedSessionDevice = unlockedSessionDevice(statusResponse)
    if (
      parsedSessionDevice.kind === UnlockedSessionDeviceParseKind.Invalid ||
      parsedSessionDevice.device.deviceId !== grant.deviceId ||
      parsedSessionDevice.device.devicePublicKey !== grant.devicePublicKey ||
      parsedSessionDevice.device.deviceSigningPublicKey !==
        grant.deviceSigningPublicKey
    ) {
      return unavailable
    }
    const nonce = randomNonce()
    await issueIdentityHandoff(nonce, {
      kind: PendingIdentityHandoffKind.PairedVault,
      vaultStoreId,
      deviceId: grant.deviceId,
      devicePublicKey: grant.devicePublicKey,
      deviceSigningPublicKey: grant.deviceSigningPublicKey,
    })
    return {
      type: ExtensionPairedVaultIdentityStatusMessageType.NookExtensionPairedVaultIdentityStatus,
      payload: {
        requestId,
        vaultStoreId,
        status: ExtensionPairedVaultIdentityStatusMessageStatus.Unlocked,
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

export async function requestPairedVaultUnlock(
  message: ExtensionPairedVaultUnlockRequestMessage,
): Promise<Record<string, unknown>> {
  const { requestId, vaultStoreId } = message.payload
  const key = pairingGrantStorageKey(vaultStoreId)
  const stored = await getPairingStorage(key)
  if (!isStoredExtensionPairingGrant(stored[key])) {
    return {
      ok: false,
      requestId,
      vaultStoreId,
      reason: 'vault-not-paired',
    }
  }

  await ensureExtensionSessionDocument()
  const queueExpiresAt = Date.now() + SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS
  const statusResponse = (await sendSessionMessage({
    type: 'nook:extension-session-status',
    payload: { queueExpiresAt, queuePriority: 'interactive' },
  })) as ExtensionSessionStatusResponse
  if (!isUnlockedSessionStatus(statusResponse)) {
    await openCompanionLauncher()
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
  items: Record<string, unknown>,
): Promise<void> {
  await ensureLegacyPairingMigration()
  await writeExtensionPairingState(items)
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

function legacyPairingStorageKeys(stored: Record<string, unknown>): string[] {
  return Object.keys(stored).filter(
    (key) =>
      key === setupStorageKey ||
      key.startsWith('nook:extension-pairing-grant:'),
  )
}

function readLegacyPairingStorage(): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get((items) => {
      if (chrome.runtime.lastError) {
        reject(
          new Error(
            chrome.runtime.lastError.message ??
              'Unable to read legacy extension pairing state.',
          ),
        )
        return
      }
      resolve(items)
    })
  })
}

function removeLegacyPairingStorage(keys: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime.lastError) {
        reject(
          new Error(
            chrome.runtime.lastError.message ??
              'Unable to remove legacy extension pairing state.',
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
    const current = await readExtensionPairingState()
    const migrated = migratedLegacyPairingStorageItems(legacy)
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
      await writeExtensionPairingState(migrated)
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
): Promise<Record<string, unknown>> {
  await ensureLegacyPairingMigration()
  const stored = await readExtensionPairingState()
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
      request: Record<string, unknown>
    }

export function requestOriginAndRpId(
  ceremony: WebsitePasskeyCeremony,
  requestJson: string,
): WebsitePasskeyRequestContext {
  const parsed = parsedWebsitePasskeyRequest(requestJson)
  if (parsed.kind === WebsitePasskeyRequestParseKind.Rejected) {
    return { kind: WebsitePasskeyRequestContextKind.Rejected }
  }
  const { request } = parsed
  if (typeof request.origin !== 'string') {
    return { kind: WebsitePasskeyRequestContextKind.Rejected }
  }
  if (ceremony === 'get') {
    return typeof request.rpId === 'string'
      ? {
          kind: WebsitePasskeyRequestContextKind.Validated,
          origin: request.origin,
          rpId: request.rpId,
          request,
        }
      : { kind: WebsitePasskeyRequestContextKind.Rejected }
  }
  const relyingParty = request.relyingParty
  return relyingParty &&
    typeof relyingParty === 'object' &&
    'id' in relyingParty &&
    typeof relyingParty.id === 'string'
    ? {
        kind: WebsitePasskeyRequestContextKind.Validated,
        origin: request.origin,
        rpId: relyingParty.id,
        request,
      }
    : { kind: WebsitePasskeyRequestContextKind.Rejected }
}

export function isAuthorizedWebsiteSender(
  sender: chrome.runtime.MessageSender,
  origin: string,
): boolean {
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
  const stored = await getPairingStorage()
  const grants = Object.values(stored).filter(
    (value): value is StoredExtensionPairingGrant =>
      isStoredExtensionPairingGrant(value) &&
      value.scopes.includes(ExtensionConnectScope.PasskeyManagement),
  )
  return selectedPairingGrantFirst(stored, grants)
}

export async function passwordPairingGrants(): Promise<
  StoredExtensionPairingGrant[]
> {
  const stored = await getPairingStorage()
  const grants = Object.values(stored).filter(
    (value): value is StoredExtensionPairingGrant =>
      isStoredExtensionPairingGrant(value) &&
      value.scopes.includes(ExtensionConnectScope.PasswordFilling),
  )
  return selectedPairingGrantFirst(stored, grants)
}

export async function availableWebsiteGrants(
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
  const queueExpiresAt = Date.now() + SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS
  const status = await sendSessionMessage({
    type: 'nook:extension-session-status',
    payload: { queueExpiresAt, queuePriority: 'interactive' },
  })
  if (!isUnlockedSessionStatus(status)) {
    openCompanionLauncher()
    return { response: { ok: true, status: 'locked', accounts: [] } }
  }
  return { grants }
}
