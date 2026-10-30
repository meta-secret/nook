import { companionWasmReady } from '../../../../nook-web-shared/src/extension/companion-ready'
import {
  decode_extension_grant_authority_response,
  NookPairingVaultId,
  type ExtensionGrantAuthority,
  type StoredExtensionKeyring,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  type ExtensionPairingApprovedMessage,
  ExtensionPairingApprovedMessage as ExtensionPairingApprovedMessageSchema,
  type RuntimeMessageDecodeFailure,
} from '../../../../nook-web-shared/src/extension/runtime-messages'
import type { StorageProvider } from '../../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  ConcreteDecoderResultKind,
  runConcreteDecoder,
} from '../../lib/concrete-decoder'
import { ExtensionSessionMessageType } from '../../lib/extension-session-message-type'
import {
  type ExtensionSessionQueue,
  MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
} from '../../offscreen/session-request-adapter'
import {
  type ExtensionPairingItems,
  extensionPairingGrantPolicyReady,
  setupStorageKey,
} from '../pairing-grants'
import { backgroundVaultRuntime } from '../vault-runtime'
import { extensionPairingIdentity } from './pairing-identity'
import { PairingIdentityConnection } from './pairing-identity-connection'
import type {
  PairedVaultImportRequest,
  PairingIdentityImportResult,
} from './identity-vault-pairing'
import { extensionSessionLifecycle } from './session-lifecycle'

export enum PairingIngressFailure {
  RuntimeUnavailable = 'extension-runtime-unavailable',
}

enum PairingIngressAdmissionKind {
  Admitted = 'admitted',
  Rejected = 'rejected',
}

type PairingIngressAdmission =
  | {
      readonly kind: PairingIngressAdmissionKind.Admitted
      readonly message: ExtensionPairingApprovedMessage
    }
  | {
      readonly kind: PairingIngressAdmissionKind.Rejected
      readonly reason: PairingIngressFailure | RuntimeMessageDecodeFailure
    }

export class ExtensionPairingIngress {
  constructor(private readonly runtimeReady: Promise<void>) {}

  async admit(message: unknown): Promise<PairingIngressAdmission> {
    try {
      await this.runtimeReady
    } catch {
      return {
        kind: PairingIngressAdmissionKind.Rejected,
        reason: PairingIngressFailure.RuntimeUnavailable,
      }
    }
    const admission = runConcreteDecoder(
      ExtensionPairingApprovedMessageSchema.decode,
      message,
    )
    if (admission.kind === ConcreteDecoderResultKind.Rejected) {
      return {
        kind: PairingIngressAdmissionKind.Rejected,
        reason: admission.failure,
      }
    }
    return {
      kind: PairingIngressAdmissionKind.Admitted,
      message: admission.value,
    }
  }
}

const extensionPairingIngress = new ExtensionPairingIngress(companionWasmReady)

export async function importPairingAfterCompanionReady(message: unknown) {
  const admission = await extensionPairingIngress.admit(message)
  if (admission.kind === PairingIngressAdmissionKind.Rejected) {
    return { ok: false, reason: admission.reason }
  }
  return new PairingCredentialImportLifecycle(admission.message).import()
}

type ReconcilePairingStorageArgs = {
  items: ExtensionPairingItems
  removedKeys: string[]
}

async function reconcilePairingStorage(
  args: ReconcilePairingStorageArgs,
): Promise<void> {
  await backgroundVaultRuntime.reconcileExtensionPairingItems(args)
}

type RestorePairingStorageArgs = {
  previous: ExtensionPairingItems
  written: ExtensionPairingItems
}

async function restorePairingStorage(
  args: RestorePairingStorageArgs,
): Promise<void> {
  const { previous, written } = args
  const touchedKeys = Object.keys(written)
  const restore: ExtensionPairingItems = {}
  for (const key of touchedKeys) {
    const record = previous[key]
    if (record) restore[key] = record
  }
  const addedKeys = touchedKeys.filter((key) => !(key in previous))
  const reconcileArgs: Parameters<typeof reconcilePairingStorage>[0] = {
    items: restore,
    removedKeys: addedKeys,
  }
  await reconcilePairingStorage(reconcileArgs)
}

export type PairingImportResult =
  { ok: true; eventCount: number } | { ok: false; reason: string }

/**
 * Import one vault of a keyring the extension joined, with the records the
 * session read once it opened and enrolled in it. The first vault the
 * extension pairs becomes the one it fills from; later ones join the list
 * and the selected vault stays as it is.
 */
export async function importKeyringVault({
  grant,
  eventLogRecords,
}: PairedVaultImportRequest): Promise<PairingIdentityImportResult> {
  const pairingPolicy = await extensionPairingGrantPolicyReady
  const importArgs: Parameters<
    typeof backgroundVaultRuntime.importExtensionEventLog
  >[0] = { grant, records: eventLogRecords }
  const imported =
    await backgroundVaultRuntime.importExtensionEventLog(importArgs)
  if (!imported.accessGranted) {
    return { ok: false, reason: 'event-log-access-not-granted' }
  }
  const openedSession =
    await extensionSessionLifecycle.ensureExtensionSessionDocument()
  if (openedSession.isErr()) return openedSession.error.response
  const previousPairingState =
    await extensionPairingIdentity.getPairingStorage()
  const pairingItemsArgs: Parameters<
    typeof pairingPolicy.extensionPairingGrantStorageItems
  >[0] = { grant, imported }
  const createdItems =
    pairingPolicy.extensionPairingGrantStorageItems(pairingItemsArgs)
  const selectsVault =
    pairingPolicy.selectedPairingGrant(previousPairingState).kind ===
    'not-selected'
  const pairingItems: ExtensionPairingItems = selectsVault
    ? createdItems
    : Object.fromEntries(
        Object.entries(createdItems).filter(([key]) => key !== setupStorageKey),
      )
  await extensionPairingIdentity.setPairingStorage(pairingItems)
  const restoreArgs: RestorePairingStorageArgs = {
    previous: previousPairingState,
    written: pairingItems,
  }
  try {
    const migrationMessage: Parameters<
      typeof extensionPairingIdentity.sendSessionMessage
    >[0] = {
      type: ExtensionSessionMessageType.MigrateAuthProviders,
      payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
    }
    const migration =
      await extensionPairingIdentity.sendSessionMessage(migrationMessage)
    if (migration.isErr()) {
      await restorePairingStorage(restoreArgs)
      return migration.error.response
    }
    const resetMessage: Parameters<
      typeof extensionPairingIdentity.sendSessionMessage
    >[0] = {
      type: ExtensionSessionMessageType.Reset,
      payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
    }
    const reset =
      await extensionPairingIdentity.sendSessionMessage(resetMessage)
    if (reset.isErr()) {
      await restorePairingStorage(restoreArgs)
      return reset.error.response
    }
    const importMessage: {
      type: typeof ExtensionSessionMessageType.ImportVault
      payload: {
        vaultStoreId: string
        deviceId: string
        devicePublicKey: string
        deviceSigningPublicKey: string
        eventLogRecords: PairedVaultImportRequest['eventLogRecords']
        providers: StorageProvider[]
        queue: ExtensionSessionQueue
      }
    } = {
      type: ExtensionSessionMessageType.ImportVault,
      payload: {
        vaultStoreId: grant.vaultStoreId,
        deviceId: grant.deviceId,
        devicePublicKey: grant.devicePublicKey,
        deviceSigningPublicKey: grant.deviceSigningPublicKey,
        eventLogRecords,
        // The keyring's providers reach the extension once, sealed to it;
        // a vault brings none of its own.
        providers: [],
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    }
    const importDelivery =
      await extensionPairingIdentity.sendSessionMessage(importMessage)
    if (importDelivery.isErr()) {
      await restorePairingStorage(restoreArgs)
      return importDelivery.error.response
    }
    const sessionImport = importDelivery.value
    if (
      !sessionImport ||
      typeof sessionImport !== 'object' ||
      !('ok' in sessionImport) ||
      sessionImport.ok !== true
    ) {
      const reason =
        sessionImport &&
        typeof sessionImport === 'object' &&
        'error' in sessionImport &&
        typeof sessionImport.error === 'string' &&
        sessionImport.error.length > 0
          ? sessionImport.error
          : 'extension-vault-import-failed'
      await restorePairingStorage(restoreArgs)
      return { ok: false, reason }
    }
  } catch (error) {
    await restorePairingStorage(restoreArgs)
    throw error
  }
  return { ok: true, eventCount: imported.eventCount }
}

/** Store the keyring the extension joined, beside its vault grants. */
async function recordKeyring(keyring: StoredExtensionKeyring): Promise<void> {
  const pairingPolicy = await extensionPairingGrantPolicyReady
  await extensionPairingIdentity.setPairingStorage(
    pairingPolicy.keyringStorageItems(keyring),
  )
}

/**
 * The web app added the extension to a keyring: join it, take its
 * providers, record it, and pair the vaults the web app handed over. A
 * keyring with no vault yet is connected the same way.
 */
export class PairingCredentialImportLifecycle {
  constructor(private readonly message: ExtensionPairingApprovedMessage) {}

  async import(): Promise<PairingImportResult> {
    try {
      const connectionRequest: ConstructorParameters<
        typeof PairingIdentityConnection
      >[0] = {
        approval: this.message.payload,
        importVault: importKeyringVault,
        sendSessionMessage: (...request) =>
          extensionPairingIdentity.sendSessionMessage(...request),
        takeKeyringProviders: (shares) =>
          backgroundVaultRuntime.takeKeyringProviderShares(shares),
        recordKeyring,
      }
      const connection = new PairingIdentityConnection(connectionRequest)
      // Join first: a join that cannot run (a locked extension) stores
      // nothing.
      const keyring = await connection.join()
      if (!keyring.ok) return keyring
      return await connection.pairVaults(keyring.joined)
    } catch {
      return { ok: false, reason: 'event-log-import-failed' }
    }
  }
}

type ImportLocalEventLogUpdateArgs = {
  vaultStoreId: string
  eventLogRecords: Parameters<
    typeof backgroundVaultRuntime.importExtensionEventLog
  >[0]['records']
}

export enum LocalEventLogUpdateFailure {
  VaultNotPaired = 'vault-not-paired',
  EventLogAccessRevoked = 'event-log-access-revoked',
  EventLogImportFailed = 'event-log-import-failed',
}

export type LocalEventLogUpdateResult =
  | { ok: true; eventCount: number }
  | { ok: false; reason: LocalEventLogUpdateFailure }

type LocalEventLogUpdateDependencies = {
  ensureSession: typeof extensionSessionLifecycle.ensureExtensionSessionDocument
  persistPairingStorage: typeof extensionPairingIdentity.setPairingStorage
  loadPairingStorage: typeof extensionPairingIdentity.getPairingStorage
  pairingPolicyReady: typeof extensionPairingGrantPolicyReady
  importEventLog: typeof backgroundVaultRuntime.importExtensionEventLog
  sendSession: typeof extensionPairingIdentity.sendSessionMessage
}

export function importLocalEventLogUpdate(
  request: ImportLocalEventLogUpdateArgs,
): Promise<LocalEventLogUpdateResult> {
  const delegated: Parameters<
    typeof importLocalEventLogUpdateWithDependencies
  >[0] = {
    ...request,
    ensureSession:
      extensionSessionLifecycle.ensureExtensionSessionDocument.bind(
        extensionSessionLifecycle,
      ),
    persistPairingStorage: extensionPairingIdentity.setPairingStorage.bind(
      extensionPairingIdentity,
    ),
    loadPairingStorage: extensionPairingIdentity.getPairingStorage.bind(
      extensionPairingIdentity,
    ),
    pairingPolicyReady: extensionPairingGrantPolicyReady,
    importEventLog: backgroundVaultRuntime.importExtensionEventLog.bind(
      backgroundVaultRuntime,
    ),
    sendSession: extensionPairingIdentity.sendSessionMessage.bind(
      extensionPairingIdentity,
    ),
  }
  return importLocalEventLogUpdateWithDependencies(delegated)
}

export async function importLocalEventLogUpdateWithDependencies({
  vaultStoreId,
  eventLogRecords,
  ensureSession,
  persistPairingStorage,
  loadPairingStorage,
  pairingPolicyReady,
  importEventLog,
  sendSession,
}: ImportLocalEventLogUpdateArgs &
  LocalEventLogUpdateDependencies): Promise<LocalEventLogUpdateResult> {
  try {
    const pairingPolicy = await pairingPolicyReady
    const stored = await loadPairingStorage()
    await ensureSession()
    const authorityRequest: Parameters<typeof sendSession>[0] = {
      type: ExtensionSessionMessageType.ClassifyGrantAuthority,
      payload: {
        stored_json: JSON.stringify(stored),
        vault_store_id: vaultStoreId,
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    }
    const authorityDelivery = await sendSession(authorityRequest)
    if (authorityDelivery.isErr()) {
      return {
        ok: false,
        reason: LocalEventLogUpdateFailure.EventLogImportFailed,
      }
    }
    const requestedVaultId = new NookPairingVaultId(vaultStoreId)
    let authority: ExtensionGrantAuthority
    try {
      authority = decode_extension_grant_authority_response(
        JSON.stringify(authorityDelivery.value),
        requestedVaultId,
      )
    } finally {
      requestedVaultId.free()
    }
    switch (authority.kind) {
      case 'Authorized':
        break
      case 'NoMatchingAuthority':
        return { ok: false, reason: LocalEventLogUpdateFailure.VaultNotPaired }
      case 'InvalidStoredAuthority':
      case 'MissingActiveAuthority':
        return {
          ok: false,
          reason: LocalEventLogUpdateFailure.EventLogImportFailed,
        }
    }
    const grant = authority.grant
    const key = pairingPolicy.pairingGrantStorageKey(vaultStoreId)
    const nookTypedArgs0_3: Parameters<
      typeof backgroundVaultRuntime.importExtensionEventLog
    >[0] = {
      grant,
      records: eventLogRecords,
    }
    const imported = await importEventLog(nookTypedArgs0_3)
    if (!imported.accessGranted) {
      const setupArgs: Parameters<
        typeof pairingPolicy.setupAfterPairingGrantRemoval
      >[0] = {
        stored,
        removedVaultStoreId: vaultStoreId,
      }
      const setup = pairingPolicy.setupAfterPairingGrantRemoval(setupArgs)
      const items: ExtensionPairingItems =
        setup.kind === 'ready' ? { [setupStorageKey]: setup.setup } : {}
      const reconcileArgs: Parameters<typeof reconcilePairingStorage>[0] = {
        items,
        removedKeys: [
          key,
          ...(setup.kind === 'ready' ? [] : [setupStorageKey]),
        ],
      }
      await reconcilePairingStorage(reconcileArgs)
      return {
        ok: false,
        reason: LocalEventLogUpdateFailure.EventLogAccessRevoked,
      }
    }
    const setup = stored[setupStorageKey]
    const setupDecode = runConcreteDecoder(
      pairingPolicy.decodeExtensionReadySetupState,
      setup,
    )
    const select =
      setupDecode.kind === ConcreteDecoderResultKind.Decoded &&
      setupDecode.value.selectedVaultStoreId === vaultStoreId
    const pairingItemsArgs: Parameters<
      typeof pairingPolicy.extensionStoredPairingGrantStorageItems
    >[0] = { grant, imported, select }
    const pairingItems =
      pairingPolicy.extensionStoredPairingGrantStorageItems(pairingItemsArgs)
    await persistPairingStorage(pairingItems)
    const nookTypedArgs0_4: Parameters<
      typeof extensionPairingIdentity.sendSessionMessage
    >[0] = {
      type: 'nook:extension-session-update-vault',
      payload: {
        vaultStoreId: grant.vaultStoreId,
        deviceId: grant.deviceId,
        devicePublicKey: grant.devicePublicKey,
        deviceSigningPublicKey: grant.deviceSigningPublicKey,
        eventLogRecords,
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    }
    const updateDelivery = await sendSession(nookTypedArgs0_4)
    if (updateDelivery.isErr()) {
      return {
        ok: false,
        reason: LocalEventLogUpdateFailure.EventLogImportFailed,
      }
    }
    return { ok: true, eventCount: imported.eventCount }
  } catch {
    return {
      ok: false,
      reason: LocalEventLogUpdateFailure.EventLogImportFailed,
    }
  }
}
