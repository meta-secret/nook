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
import { simpleVaultRuntime } from '../../lib/simple-vault-runtime'
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
  WebsitePasskeyRequestParseKind,
  type WebsitePasskeyCeremony,
  type WebsitePasskeyRequest,
  WebsitePasskeyOptionsMessage as WebsitePasskeyOptionsMessageSchema,
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
import { backgroundVaultRuntime } from '../vault-runtime'
import {
  SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS,
  extensionSessionLifecycle,
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

type ExtensionSessionStorageWrite = Record<string, unknown>

type IssueIdentityHandoffArgs = {
  nonce: string
  pending: PendingIdentityHandoff
}

type CurrentPairedVaultPresenceArgs = {
  vaultStoreId: string
  nonce: string
}

type CompanionUnlockedPresenceShape = {
  app_key: CompanionUnlockedAppKey
}

type ExtensionSessionStatusResponse = {
  ok?: unknown
  status?: unknown
}

export { ExtensionSessionStatusAvailability }

export enum HasPairingApprovedTypeResultType {
  NookExtensionPairingApproved = 'nook:extension-pairing-approved',
}

enum LegacyPairingMigrationKind {
  NotStarted = 'not-started',
  Running = 'running',
}

type LegacyPairingMigration =
  | { kind: LegacyPairingMigrationKind.NotStarted }
  | { kind: LegacyPairingMigrationKind.Running; operation: Promise<void> }

type LegacyPairingStorageKeys = string[]

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

type IsAuthorizedWebsiteSenderArgs = {
  sender: chrome.runtime.MessageSender
  origin: string
}

type AvailableWebsiteGrantsArgs = {
  origin: string
  sender: chrome.runtime.MessageSender
  forbiddenReason: string
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

/** Owns the browser runtime resources shared by these interactions. */
class ExtensionPairingIdentity {
  private pendingIdentityHandoffConsumptions = new Set<string>()
  private legacyPairingMigration: LegacyPairingMigration = {
    kind: LegacyPairingMigrationKind.NotStarted,
  }
  randomNonce(): string {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    )
  }

  private pendingIdentityHandoffStorageKey(nonce: string): string {
    return `nook.extension.identity-handoff.${nonce}`
  }

  private isPendingIdentityHandoff(
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

  setSessionStorage(items: ExtensionSessionStorageWrite): Promise<void> {
    // eslint-disable-next-line max-params -- Promise owns the executor callback signature.
    return new Promise((resolve, reject) => {
      chrome.storage.session.set(items, () => {
        const message = chrome.runtime.lastError?.message
        if (message) reject(new Error(message))
        else resolve()
      })
    })
  }

  getSessionStorage(key: string): Promise<Record<string, unknown>> {
    // eslint-disable-next-line max-params -- Promise owns the executor callback signature.
    return new Promise((resolve, reject) => {
      chrome.storage.session.get(key, (items) => {
        const message = chrome.runtime.lastError?.message
        if (message) reject(new Error(message))
        else resolve(items)
      })
    })
  }

  getAllSessionStorage(): Promise<Record<string, unknown>> {
    // eslint-disable-next-line max-params -- Promise owns the executor callback signature.
    return new Promise((resolve, reject) => {
      chrome.storage.session.get((items) => {
        const message = chrome.runtime.lastError?.message
        if (message) reject(new Error(message))
        else resolve(items)
      })
    })
  }

  removeSessionStorage(key: string): Promise<void> {
    // eslint-disable-next-line max-params -- Promise owns the executor callback signature.
    return new Promise((resolve, reject) => {
      chrome.storage.session.remove(key, () => {
        const message = chrome.runtime.lastError?.message
        if (message) reject(new Error(message))
        else resolve()
      })
    })
  }

  private async issueIdentityHandoff({
    nonce,
    pending,
  }: IssueIdentityHandoffArgs): Promise<void> {
    const nookTypedArgs0_0: Parameters<typeof this.setSessionStorage>[0] = {
      [this.pendingIdentityHandoffStorageKey(nonce)]: pending,
    }
    await this.setSessionStorage(nookTypedArgs0_0)
  }

  async openExtensionPairing(
    device: BeginExtensionPairingMessage['payload'],
  ): Promise<void> {
    await companionWasmReady
    const nonce = this.randomNonce()
    const nookTypedArgs0_1: Parameters<typeof this.issueIdentityHandoff>[0] = {
      nonce,
      pending: {
        kind: PendingIdentityHandoffKind.Pairing,
        deviceId: device.deviceId,
        devicePublicKey: device.devicePublicKey,
        deviceSigningPublicKey: device.deviceSigningPublicKey,
      },
    }
    await this.issueIdentityHandoff(nookTypedArgs0_1)
    const url = new URL(
      await simpleVaultRuntime.runtimeSimpleVaultUrl('extension-connect'),
    )
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

  async sendSessionMessage(message: unknown): Promise<unknown> {
    const document = await extensionSessionLifecycle.openSessionDocument()
    return document.sendMessage(message)
  }

  async createIdentityHandoff(
    message: ExtensionIdentityHandoffRequestMessage,
  ): Promise<{
    ok: boolean
    envelope?: string
    nextNonce?: string
    reason?: string
  }> {
    const nonce = message.payload.nonce
    if (this.pendingIdentityHandoffConsumptions.has(nonce)) {
      return { ok: false, reason: 'extension-identity-handoff-not-issued' }
    }
    this.pendingIdentityHandoffConsumptions.add(nonce)
    try {
      const key = this.pendingIdentityHandoffStorageKey(nonce)
      const stored = await this.getSessionStorage(key)
      const pending = stored[key]
      if (
        !this.isPendingIdentityHandoff(pending) ||
        message.type !==
          ExtensionIdentityHandoffRequestMessageType.NookExtensionIdentityHandoffRequest ||
        pending.deviceId !== message.payload.expectedDeviceId ||
        pending.devicePublicKey !== message.payload.expectedDevicePublicKey ||
        pending.deviceSigningPublicKey !==
          message.payload.expectedDeviceSigningPublicKey
      ) {
        return { ok: false, reason: 'extension-identity-handoff-not-issued' }
      }
      await this.removeSessionStorage(key)
      await extensionSessionLifecycle.ensureExtensionSessionDocument()
      const nookTypedArgs0_3 = identityHandoffSessionRequest(message)
      const response = await this.sendSessionMessage(nookTypedArgs0_3)
      if (
        !!response &&
        typeof response === 'object' &&
        'ok' in response &&
        response.ok === true &&
        'envelope' in response &&
        typeof response.envelope === 'string'
      ) {
        const nextNonce = this.randomNonce()
        const nookTypedArgs0_4: Parameters<
          typeof this.issueIdentityHandoff
        >[0] = {
          nonce: nextNonce,
          pending,
        }
        await this.issueIdentityHandoff(nookTypedArgs0_4)
        return { ok: true, envelope: response.envelope, nextNonce }
      }
      return { ok: false, reason: 'extension-identity-unavailable' }
    } catch {
      return { ok: false, reason: 'extension-identity-handoff-failed' }
    } finally {
      this.pendingIdentityHandoffConsumptions.delete(nonce)
    }
  }

  private async currentPairedVaultPresence({
    vaultStoreId,
    nonce,
  }: CurrentPairedVaultPresenceArgs): Promise<CompanionExtensionPresence> {
    const pairingPolicy = await extensionPairingGrantPolicyReady
    const key = pairingPolicy.pairingGrantStorageKey(vaultStoreId)
    const stored = await this.getPairingStorage()
    const grant = stored[key]
    if (!pairingPolicy.isStoredExtensionPairingGrant(grant)) {
      return { kind: 'unavailable' }
    }
    const selected = pairingPolicy.selectedPairingGrant(stored)
    const currentGrant = selected.kind === 'selected' ? selected.grant : grant
    await extensionSessionLifecycle.ensureExtensionSessionDocument()
    const statusRequest: Parameters<typeof this.sendSessionMessage>[0] = {
      type: 'nook:extension-session-status',
      payload: {
        queue: extensionSessionProbeDeadline(Date.now() + 5_000),
      },
    }
    const statusResponse = await this.sendSessionMessage(statusRequest)
    if (
      this.websiteSessionStatusTransport(statusResponse) !==
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

  async createPairedIdentityHandoff(
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
      const presence =
        await this.currentPairedVaultPresence(currentPresenceArgs)
      await extensionSessionLifecycle.ensureExtensionSessionDocument()
      const authorization = {
        request: message.payload,
        observedAt: Date.now(),
        presence,
      }
      const sessionRequest: CompanionIdentityHandoffSessionTransportRequest = {
        type: COMPANION_IDENTITY_HANDOFF_SESSION_MESSAGE_TYPE,
        payload: { authorization },
      }
      const response = await this.sendSessionMessage(sessionRequest)
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

  websiteSessionStatusTransport(
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

  async discoverPairedVaultIdentity(
    message: ExtensionPairedVaultIdentityDiscoveryMessage,
  ): Promise<CompanionIdentityDiscoveryTransportResponse> {
    await companionWasmReady
    const observation = message.payload
    const discover = async (presence: CompanionExtensionPresence) => {
      await extensionSessionLifecycle.ensureExtensionSessionDocument()
      const sessionRequest: CompanionIdentityDiscoverySessionTransportRequest =
        {
          type: COMPANION_IDENTITY_DISCOVERY_SESSION_MESSAGE_TYPE,
          payload: { presence, discovery: observation },
        }
      const response = await this.sendSessionMessage(sessionRequest)
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
      const stored = await this.getPairingStorage()
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

      await extensionSessionLifecycle.ensureExtensionSessionDocument()
      const nookTypedArgs0_5: Parameters<typeof this.sendSessionMessage>[0] = {
        type: 'nook:extension-session-status',
        payload: {
          queue: extensionSessionProbeDeadline(Date.now() + 5_000),
        },
      }
      const statusResponse = await this.sendSessionMessage(nookTypedArgs0_5)
      if (
        this.websiteSessionStatusTransport(statusResponse) !==
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
      const nonce = this.randomNonce()
      const presence: Extract<
        CompanionExtensionPresence,
        CompanionUnlockedPresenceShape
      > = {
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
      }
      return await discover(presence)
    } catch {
      return await discover(unavailablePresence)
    }
  }

  async requestPairedVaultUnlock(
    message: ExtensionPairedVaultUnlockRequestMessage,
  ): Promise<Record<string, unknown>> {
    const { requestId, vaultStoreId } = message.payload
    const pairingPolicy = await extensionPairingGrantPolicyReady
    const key = pairingPolicy.pairingGrantStorageKey(vaultStoreId)
    const stored = await this.getPairingStorage(key)
    if (!pairingPolicy.isStoredExtensionPairingGrant(stored[key])) {
      return {
        ok: false,
        requestId,
        vaultStoreId,
        reason: 'vault-not-paired',
      }
    }

    await extensionSessionLifecycle.ensureExtensionSessionDocument()
    const queueExpiresAt = Date.now() + SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS
    const nookTypedArgs0_7: Parameters<typeof this.sendSessionMessage>[0] = {
      type: 'nook:extension-session-status',
      payload: { queue: extensionSessionInteractiveDeadline(queueExpiresAt) },
    }
    const statusResponse = (await this.sendSessionMessage(
      nookTypedArgs0_7,
    )) as ExtensionSessionStatusResponse
    if (!extensionSessionLifecycle.isUnlockedSessionStatus(statusResponse)) {
      await extensionSessionLifecycle.openCompanionLauncher(
        OpenCompanionLauncherIntent.Default,
      )
    }
    return { ok: true, requestId, vaultStoreId }
  }

  hasPairingApprovedType(message: unknown): message is {
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

  async setPairingStorage(items: ExtensionPairingItems): Promise<void> {
    await this.ensureLegacyPairingMigration()
    await backgroundVaultRuntime.persistExtensionPairingItems(items)
  }

  private legacyPairingStorageKeys(
    stored: LegacyPairingStorageItems,
  ): string[] {
    return Object.keys(stored).filter(
      (key) =>
        key === setupStorageKey ||
        key.startsWith('nook:extension-pairing-grant:'),
    )
  }

  private readLegacyPairingStorage(): Promise<LegacyPairingStorageItems> {
    // eslint-disable-next-line max-params -- Promise owns the executor callback signature.
    return new Promise((resolve, reject) => {
      chrome.storage.local.get((items) => {
        if (chrome.runtime.lastError) {
          reject(
            new Error(
              ((...[v = 'Unable to read legacy extension pairing state.']) =>
                v)(chrome.runtime.lastError.message),
            ),
          )
          return
        }
        resolve(items)
      })
    })
  }

  private removeLegacyPairingStorage(
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

  ensureLegacyPairingMigration(): Promise<void> {
    if (
      this.legacyPairingMigration.kind === LegacyPairingMigrationKind.Running
    ) {
      return this.legacyPairingMigration.operation
    }
    const operation = (async () => {
      // Browser storage is a read-once upgrade source only. Rexie remains the
      // sole ongoing owner of pairing state after the legacy rows are removed.
      const legacy = await this.readLegacyPairingStorage()
      const legacyKeys = this.legacyPairingStorageKeys(legacy)
      if (legacyKeys.length === 0) return
      const legacyPairingRecords = Object.fromEntries(
        legacyKeys.map((key) => [key, legacy[key]]),
      )
      const current = await backgroundVaultRuntime.loadExtensionPairingItems()
      const pairingPolicy = await extensionPairingGrantPolicyReady
      const migrated =
        pairingPolicy.migratedLegacyPairingStorageItems(legacyPairingRecords)
      if (Object.keys(current).length > 0) {
        const completedKeys = Object.keys(migrated).filter(
          (key) =>
            legacyKeys.includes(key) &&
            key in current &&
            pairingPolicy.comparePairingRecords({
              current: current[key],
              migrated: migrated[key],
            }) === 'Equivalent',
        )
        if (
          completedKeys.length > 0 &&
          completedKeys.length === Object.keys(migrated).length
        ) {
          await this.removeLegacyPairingStorage(completedKeys)
        }
        return
      }
      if (Object.keys(migrated).length > 0) {
        await backgroundVaultRuntime.persistExtensionPairingItems(migrated)
        await this.removeLegacyPairingStorage(
          Object.keys(migrated).filter((key) => legacyKeys.includes(key)),
        )
      }
    })()
    this.legacyPairingMigration = {
      kind: LegacyPairingMigrationKind.Running,
      operation,
    }
    return operation
  }

  async getPairingStorage(key?: string): Promise<ExtensionPairingItems> {
    await this.ensureLegacyPairingMigration()
    const stored = await backgroundVaultRuntime.loadExtensionPairingItems()
    if (!key) return stored
    return key in stored ? { [key]: stored[key] } : {}
  }

  async requestOriginAndRpId({
    ceremony,
    requestJson,
  }: RequestOriginAndRpIdArgs): Promise<WebsitePasskeyRequestContext> {
    const parseArgs: Parameters<
      typeof WebsitePasskeyOptionsMessageSchema.parsedWebsitePasskeyRequest
    >[0] = {
      ceremony,
      requestJson,
    }
    const parsed =
      await WebsitePasskeyOptionsMessageSchema.parsedWebsitePasskeyRequest(
        parseArgs,
      )
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

  isAuthorizedWebsiteSender({
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

  async passkeyPairingGrants(): Promise<StoredExtensionPairingGrant[]> {
    const pairingPolicy = await extensionPairingGrantPolicyReady
    const stored = await this.getPairingStorage()
    return pairingPolicy
      .selectedPairingGrantFirst(stored)
      .filter((grant) =>
        grant.scopes.includes(ExtensionConnectScope.PasskeyManagement),
      )
  }

  async passwordPairingGrants(): Promise<StoredExtensionPairingGrant[]> {
    const pairingPolicy = await extensionPairingGrantPolicyReady
    const stored = await this.getPairingStorage()
    return pairingPolicy
      .selectedPairingGrantFirst(stored)
      .filter((grant) =>
        grant.scopes.includes(ExtensionConnectScope.PasswordFilling),
      )
  }

  async availableWebsiteGrants({
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
    return this.websiteGrants(request)
  }

  async passiveAvailableWebsiteGrants({
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
    return this.websiteGrants(request)
  }

  private async websiteGrants({
    origin,
    sender,
    forbiddenReason,
    openLockedCompanion,
  }: WebsiteGrantsArgs): Promise<WebsiteGrantAccess> {
    const nookTypedArgs0_8: Parameters<
      typeof this.isAuthorizedWebsiteSender
    >[0] = {
      sender,
      origin,
    }
    if (!this.isAuthorizedWebsiteSender(nookTypedArgs0_8)) {
      return { response: { ok: false, reason: forbiddenReason } }
    }
    const grants = await this.passwordPairingGrants()
    if (grants.length === 0) {
      return {
        response: {
          ok: true,
          status: WebsiteAuthenticatorResponseStatus.Unavailable,
        },
      }
    }
    await extensionSessionLifecycle.ensureExtensionSessionDocument()
    const queueExpiresAt = Date.now() + SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS
    const queue = openLockedCompanion
      ? extensionSessionInteractiveDeadline(queueExpiresAt)
      : extensionSessionProbeDeadline(queueExpiresAt)
    const nookTypedArgs0_9: Parameters<typeof this.sendSessionMessage>[0] = {
      type: 'nook:extension-session-status',
      payload: { queue },
    }
    const status = await this.sendSessionMessage(nookTypedArgs0_9)
    await companionWasmReady
    const sessionStatus = this.websiteSessionStatusTransport(status)
    if (openLockedCompanion) {
      if (sessionStatus !== ExtensionSessionStatusAvailability.Unlocked) {
        extensionSessionLifecycle.openCompanionLauncherBestEffort(
          OpenCompanionLauncherIntent.Default,
        )
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
}

export const extensionPairingIdentity = new ExtensionPairingIdentity()
