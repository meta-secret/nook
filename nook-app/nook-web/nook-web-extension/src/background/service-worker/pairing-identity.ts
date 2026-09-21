import { err, ok, type Result } from 'neverthrow'
import { Effect } from 'effect'
import type {
  DecodedExtensionSessionTransportDelivery,
  ExtensionSessionTransportDelivery,
  ExtensionSessionTransportFailure,
  ExtensionSessionTransportResult,
} from './session-document'
import type { ExtensionSessionResponse } from '../../offscreen/session'
import {
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
  admit_companion_handoff_identity_status,
  admit_companion_identity_status,
  decode_companion_identity_discovery_observation,
  decode_extension_paired_vault_identity_handoff_request_message,
  decode_extension_paired_vault_unlock_request_message,
  decode_extension_session_status_response,
  ExtensionSessionStatusAvailability,
  type CompanionExtensionPresence,
  type CompanionIdentityHandoffStatusAdmission,
  type CompanionIdentityHandoffRequest,
  type CompanionUnlockedAppKey,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  RuntimeMessageDecodeFailure,
  RuntimeMessageDecodeFailureKind,
} from '../../../../nook-web-shared/src/extension/runtime-message-decode-failure'
import { simpleVaultRuntime } from '../../lib/simple-vault-runtime'
import { WebsiteAuthenticatorResponseStatus } from '../../lib/login-fill-messages'
import {
  COMPANION_IDENTITY_DISCOVERY_SESSION_MESSAGE_TYPE,
  COMPANION_IDENTITY_HANDOFF_SESSION_MESSAGE_TYPE,
  extensionSessionInteractiveDeadline,
  extensionSessionProbeDeadline,
  type ExtensionSessionTransportRequest,
  type CompanionIdentityDiscoverySessionTransportRequest,
  type CompanionIdentityHandoffSessionTransportRequest,
} from '../../offscreen/session-request-adapter'
import {
  WebsitePasskeyRequestParseKind,
  WebsitePasskeyCeremony,
  type WebsitePasskeyRequest,
  WebsitePasskeyOptionsMessage as WebsitePasskeyOptionsMessageSchema,
} from '../../lib/webauthn-messages'
import type {
  ExtensionPairingItems,
  StoredExtensionPairingGrant,
} from '../pairing-grants'
import { extensionPairingGrantPolicyReady } from '../pairing-grants'
import {
  SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS,
  extensionSessionLifecycle,
} from './session-lifecycle'
import { identityHandoffSessionRequest } from './session-request-projections'
import {
  ConcreteDecoderResultKind,
  runConcreteDecoder,
} from '../../lib/concrete-decoder'
import {
  ExtensionPairingStorage,
  PendingIdentityHandoffKind,
  type ExtensionSessionStorageItems,
  type ExtensionSessionStorageWrite,
  decodePendingIdentityHandoff,
} from './pairing-identity-storage'

export {
  type ExtensionSessionStorageItems,
  type ExtensionSessionStorageValue,
  type ExtensionSessionStorageWrite,
} from './pairing-identity-storage'

function decodeCompanionIdentityDiscoveryObservation(value: unknown) {
  const decoded = Effect.try(() =>
    decode_companion_identity_discovery_observation(value),
  )
  return decoded.pipe(
    Effect.mapError((cause) => {
      const failureRequest: Parameters<
        typeof RuntimeMessageDecodeFailure.fromCause
      >[0] = {
        kind: RuntimeMessageDecodeFailureKind.ExtensionPairedVaultIdentityDiscovery,
        cause,
      }
      return RuntimeMessageDecodeFailure.fromCause(failureRequest)
    }),
  )
}

function decodeCompanionPairedVaultIdentityHandoffRequest(value: unknown) {
  const decoded = Effect.try(() =>
    decode_extension_paired_vault_identity_handoff_request_message(value),
  )
  return decoded.pipe(
    Effect.mapError((cause) => {
      const failureRequest: Parameters<
        typeof RuntimeMessageDecodeFailure.fromCause
      >[0] = {
        kind: RuntimeMessageDecodeFailureKind.ExtensionPairedVaultIdentityHandoffRequest,
        cause,
      }
      return RuntimeMessageDecodeFailure.fromCause(failureRequest)
    }),
  )
}

function decodeCompanionPairedVaultUnlockRequest(value: unknown) {
  const decoded = Effect.try(() =>
    decode_extension_paired_vault_unlock_request_message(value),
  )
  return decoded.pipe(
    Effect.mapError((cause) => {
      const failureRequest: Parameters<
        typeof RuntimeMessageDecodeFailure.fromCause
      >[0] = {
        kind: RuntimeMessageDecodeFailureKind.ExtensionPairedVaultUnlockRequest,
        cause,
      }
      return RuntimeMessageDecodeFailure.fromCause(failureRequest)
    }),
  )
}

type CurrentPairedVaultPresenceArgs = {
  vaultStoreId: string
  nonce: string
}

type CompanionUnlockedPresenceShape = {
  app_key: CompanionUnlockedAppKey
}

export type SessionMessageRequest = [message: ExtensionSessionTransportRequest]

export type DecodedSessionMessageRequest<Response, DecodeFailure> = [
  message: ExtensionSessionTransportRequest,
  decodeResponse: (
    response: ExtensionSessionResponse,
  ) => Result<Response, DecodeFailure>,
]

export { ExtensionSessionStatusAvailability }

export enum HasPairingApprovedTypeResultType {
  NookExtensionPairingApproved = 'nook:extension-pairing-approved',
}

type ExtensionPairedVaultUnlockResponse =
  | { ok: true; requestId: string; vaultStoreId: string }
  | {
      ok: false
      requestId: string
      vaultStoreId: string
      reason: string
    }

export enum WebsitePasskeyRequestContextKind {
  Rejected = 'rejected',
  Validated = 'validated',
}

enum CompanionIdentityDiscoveryDecodeFailureKind {
  InvalidResponse = 'companion-identity-discovery-response-invalid',
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
  private readonly pairingStorage = new ExtensionPairingStorage()
  randomNonce(): string {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    )
  }

  setSessionStorage(items: ExtensionSessionStorageWrite): Promise<void> {
    return this.pairingStorage.setSessionStorage(items)
  }

  getSessionStorage(key: string): Promise<ExtensionSessionStorageItems> {
    return this.pairingStorage.getSessionStorage(key)
  }

  getAllSessionStorage(): Promise<ExtensionSessionStorageItems> {
    return this.pairingStorage.getAllSessionStorage()
  }

  removeSessionStorage(key: string): Promise<void> {
    return this.pairingStorage.removeSessionStorage(key)
  }

  async openExtensionPairing(
    device: BeginExtensionPairingMessage['payload'],
  ): Promise<void> {
    await companionWasmReady
    const nonce = this.randomNonce()
    const nookTypedArgs0_1: Parameters<
      typeof this.pairingStorage.issueIdentityHandoff
    >[0] = {
      nonce,
      pending: {
        kind: PendingIdentityHandoffKind.Pairing,
        deviceId: device.deviceId,
        devicePublicKey: device.devicePublicKey,
        deviceSigningPublicKey: device.deviceSigningPublicKey,
      },
    }
    await this.pairingStorage.issueIdentityHandoff(nookTypedArgs0_1)
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

  sendSessionMessage(
    ...request: SessionMessageRequest
  ): Promise<ExtensionSessionTransportResult<ExtensionSessionResponse>>
  sendSessionMessage<Response, DecodeFailure>(
    ...request: DecodedSessionMessageRequest<Response, DecodeFailure>
  ): Promise<ExtensionSessionTransportResult<Response, DecodeFailure>>
  async sendSessionMessage<
    Response = ExtensionSessionResponse,
    DecodeFailure = never,
  >(
    ...request:
      | SessionMessageRequest
      | DecodedSessionMessageRequest<Response, DecodeFailure>
  ): Promise<
    | ExtensionSessionTransportResult<ExtensionSessionResponse>
    | ExtensionSessionTransportResult<Response, DecodeFailure>
  > {
    const [message, decodeResponse] = request
    const document = await extensionSessionLifecycle.openSessionDocument()
    if (document.isErr()) {
      return err<ExtensionSessionResponse, ExtensionSessionTransportFailure>(
        document.error,
      )
    }
    if (decodeResponse) {
      const delivery: DecodedExtensionSessionTransportDelivery<
        Response,
        DecodeFailure
      > = { message, decodeResponse }
      return document.value.sendMessage(delivery)
    }
    const delivery: ExtensionSessionTransportDelivery = { message }
    return document.value.sendMessage(delivery)
  }

  async createIdentityHandoff(
    message: ExtensionIdentityHandoffRequestMessage,
  ): Promise<{
    ok: boolean
    envelope?: string
    nextNonce?: string
    reason?: string
  }> {
    await companionWasmReady
    const handoffRequest = message.payload
    const nonce = handoffRequest.nonce
    if (this.pendingIdentityHandoffConsumptions.has(nonce)) {
      return { ok: false, reason: 'extension-identity-handoff-not-issued' }
    }
    this.pendingIdentityHandoffConsumptions.add(nonce)
    try {
      const key = this.pairingStorage.pendingIdentityHandoffStorageKey(nonce)
      const stored = await this.getSessionStorage(key)
      const storedEntry = Object.entries(stored).find(
        ([storedKey]) => storedKey === key,
      )
      if (!storedEntry) {
        return { ok: false, reason: 'extension-identity-handoff-not-issued' }
      }
      const pendingAdmission = runConcreteDecoder(
        decodePendingIdentityHandoff,
        storedEntry[1],
      )
      if (pendingAdmission.kind === ConcreteDecoderResultKind.Rejected) {
        return { ok: false, reason: 'extension-identity-handoff-not-issued' }
      }
      const pending = pendingAdmission.value
      if (
        pending.deviceId !== handoffRequest.expectedDeviceId ||
        pending.devicePublicKey !== handoffRequest.expectedDevicePublicKey ||
        pending.deviceSigningPublicKey !==
          handoffRequest.expectedDeviceSigningPublicKey
      ) {
        return { ok: false, reason: 'extension-identity-handoff-not-issued' }
      }
      await this.removeSessionStorage(key)

      const handoffProjection: Parameters<
        typeof identityHandoffSessionRequest
      >[0] = {
        recipientPublicKey: handoffRequest.recipientPublicKey,
        nonce,
        expectedDeviceId: handoffRequest.expectedDeviceId,
        expectedDevicePublicKey: handoffRequest.expectedDevicePublicKey,
        expectedDeviceSigningPublicKey:
          handoffRequest.expectedDeviceSigningPublicKey,
      }
      const nookTypedArgs0_3 = identityHandoffSessionRequest(handoffProjection)
      const delivery = await this.sendSessionMessage(nookTypedArgs0_3)
      if (delivery.isErr()) return delivery.error.response
      const response = delivery.value
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
          typeof this.pairingStorage.issueIdentityHandoff
        >[0] = {
          nonce: nextNonce,
          pending,
        }
        await this.pairingStorage.issueIdentityHandoff(nookTypedArgs0_4)
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
  }: CurrentPairedVaultPresenceArgs): Promise<
    Result<CompanionExtensionPresence, ExtensionSessionTransportFailure>
  > {
    const pairingPolicy = await extensionPairingGrantPolicyReady
    const key = pairingPolicy.pairingGrantStorageKey(vaultStoreId)
    const stored = await this.getPairingStorage()
    const grant = stored[key]
    const grantDecode = runConcreteDecoder(
      pairingPolicy.decodeStoredExtensionPairingGrant,
      grant,
    )
    if (grantDecode.kind === ConcreteDecoderResultKind.Rejected) {
      const unavailablePresence: CompanionExtensionPresence = {
        kind: 'unavailable',
      }
      return ok(unavailablePresence)
    }
    const decodedGrant = grantDecode.value
    const selected = pairingPolicy.selectedPairingGrant(stored)
    const currentGrant =
      selected.kind === 'selected' ? selected.grant : decodedGrant

    const statusRequest: Parameters<typeof this.sendSessionMessage>[0] = {
      type: 'nook:extension-session-status',
      payload: {
        queue: extensionSessionProbeDeadline(Date.now() + 5_000),
      },
    }
    const delivery = await this.sendSessionMessage(statusRequest)
    if (delivery.isErr()) return err(delivery.error)
    const statusResponse = delivery.value
    if (
      this.websiteSessionStatusTransport(statusResponse) !==
      ExtensionSessionStatusAvailability.Unlocked
    ) {
      const lockedPresence: CompanionExtensionPresence = {
        kind: 'locked',
        vault_type: currentGrant.vaultType,
        vault_store_id: currentGrant.vaultStoreId,
        vault_name: currentGrant.vaultName,
      }
      return ok(lockedPresence)
    }
    const unlockedPresence: Extract<
      CompanionExtensionPresence,
      CompanionUnlockedPresenceShape
    > = {
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
    return ok(unlockedPresence)
  }

  async createPairedIdentityHandoff(
    message: ExtensionPairedVaultIdentityHandoffRequestMessage,
  ): Promise<CompanionIdentityHandoffTransportResponse> {
    try {
      await companionWasmReady
      const decodedRequest = runConcreteDecoder(
        decodeCompanionPairedVaultIdentityHandoffRequest,
        message,
      )
      if (decodedRequest.kind === ConcreteDecoderResultKind.Rejected) {
        return { ok: false, reason: 'extension-identity-handoff-not-issued' }
      }
      const handoffRequest: CompanionIdentityHandoffRequest =
        decodedRequest.value.payload
      const statusAdmission: CompanionIdentityHandoffStatusAdmission = {
        request: handoffRequest,
        observedAt: Date.now(),
      }
      const admission = admit_companion_handoff_identity_status(statusAdmission)
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
      if (presence.isErr()) return presence.error.response

      const authorization = {
        request: handoffRequest,
        observedAt: Date.now(),
        presence: presence.value,
      }
      const sessionRequest: CompanionIdentityHandoffSessionTransportRequest = {
        type: COMPANION_IDENTITY_HANDOFF_SESSION_MESSAGE_TYPE,
        payload: { authorization },
      }
      const delivery = await this.sendSessionMessage(sessionRequest)
      if (delivery.isErr()) return delivery.error.response
      const response = delivery.value
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
      return decode_extension_session_status_response(response)
    } catch {
      return ExtensionSessionStatusAvailability.Unavailable
    }
  }

  async discoverPairedVaultIdentity(
    message: ExtensionPairedVaultIdentityDiscoveryMessage,
  ): Promise<CompanionIdentityDiscoveryTransportResponse> {
    await companionWasmReady
    const observationDecode = runConcreteDecoder(
      decodeCompanionIdentityDiscoveryObservation,
      message.payload,
    )
    if (observationDecode.kind === ConcreteDecoderResultKind.Rejected) {
      return { ok: false }
    }
    const observation = observationDecode.value
    const discover = async (
      presence: CompanionExtensionPresence,
    ): Promise<CompanionIdentityDiscoveryTransportResponse> => {
      const sessionRequest: CompanionIdentityDiscoverySessionTransportRequest =
        {
          type: COMPANION_IDENTITY_DISCOVERY_SESSION_MESSAGE_TYPE,
          payload: { presence, discovery: observation },
        }
      const decodeResponse = (
        response: ExtensionSessionResponse,
      ): Result<
        CompanionIdentityDiscoveryTransportResponse,
        CompanionIdentityDiscoveryDecodeFailureKind
      > => {
        if (
          !response ||
          typeof response !== 'object' ||
          !('ok' in response) ||
          response.ok !== true ||
          !('status' in response)
        ) {
          return err(
            CompanionIdentityDiscoveryDecodeFailureKind.InvalidResponse,
          )
        }
        const statusAdmission: Parameters<
          typeof admit_companion_identity_status
        >[0] = {
          discovery: observation,
          status: response.status,
          observedAt: Date.now(),
        }
        const admission = admit_companion_identity_status(statusAdmission)
        if (admission.kind !== 'accepted') {
          return err(
            CompanionIdentityDiscoveryDecodeFailureKind.InvalidResponse,
          )
        }
        const decodedResponse: CompanionIdentityDiscoveryTransportResponse = {
          ok: true,
          status: admission.transaction.status,
        }
        return ok(decodedResponse)
      }
      const sessionMessage: DecodedSessionMessageRequest<
        CompanionIdentityDiscoveryTransportResponse,
        CompanionIdentityDiscoveryDecodeFailureKind
      > = [sessionRequest, decodeResponse]
      const delivery = await this.sendSessionMessage(...sessionMessage)
      if (delivery.isErr()) return { ok: false }
      return delivery.value
    }
    const unavailablePresence: CompanionExtensionPresence = {
      kind: 'unavailable',
    }
    try {
      const vaultStoreId = observation.request.vaultStoreId
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
      const grantDecode = runConcreteDecoder(
        pairingPolicy.decodeStoredExtensionPairingGrant,
        grant,
      )
      if (grantDecode.kind === ConcreteDecoderResultKind.Rejected) {
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
      const decodedGrant = grantDecode.value

      const nookTypedArgs0_5: Parameters<typeof this.sendSessionMessage>[0] = {
        type: 'nook:extension-session-status',
        payload: {
          queue: extensionSessionProbeDeadline(Date.now() + 5_000),
        },
      }
      const statusDelivery = await this.sendSessionMessage(nookTypedArgs0_5)
      if (statusDelivery.isErr()) return statusDelivery.error.response
      const statusResponse = statusDelivery.value
      if (
        this.websiteSessionStatusTransport(statusResponse) !==
        ExtensionSessionStatusAvailability.Unlocked
      ) {
        const lockedPresence: CompanionExtensionPresence = {
          kind: 'locked',
          vault_type: decodedGrant.vaultType,
          vault_store_id: decodedGrant.vaultStoreId,
          vault_name: decodedGrant.vaultName,
        }
        return await discover(lockedPresence)
      }
      const nonce = this.randomNonce()
      const presence: Extract<
        CompanionExtensionPresence,
        CompanionUnlockedPresenceShape
      > = {
        kind: 'unlocked',
        vault_type: decodedGrant.vaultType,
        vault_store_id: decodedGrant.vaultStoreId,
        vault_name: decodedGrant.vaultName,
        app_key: {
          extensionRuntimeId: chrome.runtime.id,
          appKey: {
            appId: decodedGrant.deviceId,
            encryptionPublicKey: decodedGrant.devicePublicKey,
            signingPublicKey: decodedGrant.deviceSigningPublicKey,
            installationLabel: decodedGrant.deviceLabel,
          },
          nonce,
          scopes: decodedGrant.scopes,
        },
      }
      return await discover(presence)
    } catch {
      return await discover(unavailablePresence)
    }
  }

  async requestPairedVaultUnlock(
    message: ExtensionPairedVaultUnlockRequestMessage,
  ): Promise<ExtensionPairedVaultUnlockResponse> {
    const decodedRequest = runConcreteDecoder(
      decodeCompanionPairedVaultUnlockRequest,
      message,
    )
    if (decodedRequest.kind === ConcreteDecoderResultKind.Rejected) {
      return {
        ok: false,
        requestId: message.payload.requestId,
        vaultStoreId: message.payload.vaultStoreId,
        reason: 'invalid-unlock-request',
      }
    }
    const { requestId, vaultStoreId } = decodedRequest.value.payload

    try {
      const pairingPolicy = await extensionPairingGrantPolicyReady
      const key = pairingPolicy.pairingGrantStorageKey(vaultStoreId)
      const stored = await this.getPairingStorage(key)
      const grantDecode = runConcreteDecoder(
        pairingPolicy.decodeStoredExtensionPairingGrant,
        stored[key],
      )
      if (grantDecode.kind === ConcreteDecoderResultKind.Rejected) {
        return {
          ok: false,
          requestId,
          vaultStoreId,
          reason: 'vault-not-paired',
        }
      }

      const queueExpiresAt = Date.now() + SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS
      const statusRequest: Parameters<typeof this.sendSessionMessage>[0] = {
        type: 'nook:extension-session-status',
        payload: { queue: extensionSessionInteractiveDeadline(queueExpiresAt) },
      }
      const statusDelivery = await this.sendSessionMessage(statusRequest)
      if (statusDelivery.isErr())
        return { ...statusDelivery.error.response, requestId, vaultStoreId }
      const statusResponse = statusDelivery.value
      if (!extensionSessionLifecycle.isUnlockedSessionStatus(statusResponse)) {
        await extensionSessionLifecycle.openCompanionLauncher(
          OpenCompanionLauncherIntent.Default,
        )
      }
      return { ok: true, requestId, vaultStoreId }
    } catch {
      return {
        ok: false,
        requestId,
        vaultStoreId,
        reason: 'unlock-launch-failed',
      }
    }
  }

  async setPairingStorage(items: ExtensionPairingItems): Promise<void> {
    return this.pairingStorage.setPairingStorage(items)
  }

  ensureLegacyPairingMigration(): Promise<void> {
    return this.pairingStorage.ensureLegacyPairingMigration()
  }

  async getPairingStorage(key?: string): Promise<ExtensionPairingItems> {
    return this.pairingStorage.getPairingStorage(key)
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
      origin: parsed.request.value.origin,
      rpId:
        parsed.request.ceremony === WebsitePasskeyCeremony.Get
          ? parsed.request.value.rpId
          : parsed.request.value.relyingParty.id,
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

    const queueExpiresAt = Date.now() + SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS
    const queue = openLockedCompanion
      ? extensionSessionInteractiveDeadline(queueExpiresAt)
      : extensionSessionProbeDeadline(queueExpiresAt)
    const nookTypedArgs0_9: Parameters<typeof this.sendSessionMessage>[0] = {
      type: 'nook:extension-session-status',
      payload: { queue },
    }
    const statusDelivery = await this.sendSessionMessage(nookTypedArgs0_9)
    if (statusDelivery.isErr())
      return { response: statusDelivery.error.response }
    const status = statusDelivery.value
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
