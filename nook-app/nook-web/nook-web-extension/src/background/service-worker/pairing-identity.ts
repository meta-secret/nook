import type {
  BeginExtensionPairingMessage,
  ExtensionIdentityHandoffRequestMessage,
  ExtensionPairedVaultIdentityDiscoveryMessage,
  ExtensionPairedVaultIdentityHandoffRequestMessage,
  ExtensionPairedVaultIdentityStatusMessage,
  ExtensionPairedVaultUnlockRequestMessage,
} from '../../../../nook-web-shared/src/extension/runtime-messages'
import {
  EMPTY_VALUE,
  presentValue,
  type ValueState,
} from '../../../../nook-web-shared/src/explicit-state'
import {
  isRuntimeSimpleVaultUrl,
  runtimeSimpleVaultUrl,
} from '../../lib/simple-vault-runtime'
import {
  parsedWebsitePasskeyRequest,
  type WebsitePasskeyCeremony,
} from '../../lib/webauthn-messages'
import type { StoredExtensionPairingGrant } from '../pairing-grants'
import {
  isStoredExtensionPairingGrant,
  migratedLegacyPairingStorageItems,
  pairingGrantStorageKey,
  selectedPairingGrant,
  selectedPairingGrantFirst,
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
    (value.kind === 'pairing' ||
      (value.kind === 'paired-vault' &&
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
  pending: Extract<PendingIdentityHandoff, { kind: 'paired-vault' }>,
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

export async function discoverPairedVaultIdentity(
  message: ExtensionPairedVaultIdentityDiscoveryMessage,
): Promise<ExtensionPairedVaultIdentityStatusMessage> {
  const { requestId, vaultStoreId } = message.payload
  const unavailable = {
    type: 'nook:extension-paired-vault-identity-status',
    payload: { requestId, vaultStoreId, status: 'unavailable' },
  } satisfies ExtensionPairedVaultIdentityStatusMessage
  try {
    const key = pairingGrantStorageKey(vaultStoreId)
    const stored = await getPairingStorage()
    const grant = stored[key]
    const selectedGrant = selectedPairingGrant(stored)
    if (selectedGrant && selectedGrant.vaultStoreId !== vaultStoreId) {
      return {
        type: 'nook:extension-paired-vault-identity-status',
        payload: {
          requestId,
          vaultStoreId,
          status: 'different-vault',
          connectedVaultStoreId: selectedGrant.vaultStoreId,
          connectedVaultName: selectedGrant.vaultName,
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
          type: 'nook:extension-paired-vault-identity-status',
          payload: {
            requestId,
            vaultStoreId,
            status: 'different-vault',
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
  if (statusResponse.status !== 'unlocked') {
    await openCompanionLauncher()
  }
  return { ok: true, requestId, vaultStoreId }
}

export function hasPairingApprovedType(
  message: unknown,
): message is { type: 'nook:extension-pairing-approved' } {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'nook:extension-pairing-approved'
  )
}

export async function setPairingStorage(
  items: Record<string, unknown>,
): Promise<void> {
  await ensureLegacyPairingMigration()
  await writeExtensionPairingState(items)
}

let legacyPairingMigration: ValueState<Promise<void>> = EMPTY_VALUE

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
  if (legacyPairingMigration.kind === 'present') {
    return legacyPairingMigration.value
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
  legacyPairingMigration = presentValue(operation)
  return operation
}

export async function getPairingStorage(
  key?: string,
): Promise<Record<string, unknown>> {
  await ensureLegacyPairingMigration()
  const stored = await readExtensionPairingState()
  if (key === undefined) return stored
  return key in stored ? { [key]: stored[key] } : {}
}

export function requestOriginAndRpId(
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

export function isAuthorizedWebsiteSender(
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

export async function passkeyPairingGrants(): Promise<
  StoredExtensionPairingGrant[]
> {
  const stored = await getPairingStorage()
  const grants = Object.values(stored).filter(
    (value): value is StoredExtensionPairingGrant =>
      isStoredExtensionPairingGrant(value) &&
      value.scopes.includes('passkey-management'),
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
      value.scopes.includes('password-filling'),
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
