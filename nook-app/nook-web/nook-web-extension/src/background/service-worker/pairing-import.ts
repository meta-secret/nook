import type { ExtensionPairingApprovedMessage } from '../../../../nook-web-shared/src/extension/runtime-messages'
import type { ExtensionPairingGrantApproval } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type { StorageProvider } from '../../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  type ProviderCredentialCleanupArgs,
  ProviderCredentialStagingKind,
  runWithProviderCredentialCleanup,
  scrubProviderCredentials,
  stageProviderCredentials,
} from '../../lib/provider-credential-staging'
import { ExtensionSessionMessageType } from '../../lib/extension-session-message-type'
import {
  type ExtensionPairingItems,
  extensionPairingGrantPolicyReady,
  setupStorageKey,
} from '../pairing-grants'
import {
  decodeExtensionStorageProviders,
  importExtensionEventLog,
  reconcileExtensionPairingState,
} from '../vault-runtime'
import {
  ensureLegacyPairingMigration,
  getPairingStorage,
  sendSessionMessage,
  setPairingStorage,
} from './pairing-identity'
import { ensureExtensionSessionDocument } from './session-lifecycle'

async function reconcilePairingStorage(args: {
  items: ExtensionPairingItems
  removedKeys: string[]
}): Promise<void> {
  await ensureLegacyPairingMigration()
  await reconcileExtensionPairingState(args)
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
  const restore: ExtensionPairingItems = Object.fromEntries(
    touchedKeys
      .filter((key) => key in previous)
      .map((key) => [key, previous[key]]),
  )
  const addedKeys = touchedKeys.filter((key) => !(key in previous))
  const reconcileArgs: Parameters<typeof reconcilePairingStorage>[0] = {
    items: restore,
    removedKeys: addedKeys,
  }
  await reconcilePairingStorage(reconcileArgs)
}

type ImportDecodedApprovedPairingArgs = {
  message: ExtensionPairingApprovedMessage
  providers: StorageProvider[]
}

export type PairingImportResult =
  { ok: true; eventCount: number } | { ok: false; reason: string }

async function importDecodedApprovedPairing(
  args: ImportDecodedApprovedPairingArgs,
): Promise<PairingImportResult> {
  const { message, providers } = args
  const pairingPolicy = await extensionPairingGrantPolicyReady
  const grantApproval: ExtensionPairingGrantApproval = {
    vaultType: message.payload.vaultType,
    deviceId: message.payload.deviceId,
    devicePublicKey: message.payload.devicePublicKey,
    deviceSigningPublicKey: message.payload.deviceSigningPublicKey,
    deviceLabel: message.payload.deviceLabel,
    vaultStoreId: message.payload.vaultStoreId,
    vaultName: message.payload.vaultName,
    approvedAt: message.payload.approvedAt,
    scopes: message.payload.scopes,
    syncProviderCount: providers.length,
  }
  try {
    const nookTypedArgs0_0: Parameters<typeof importExtensionEventLog>[0] = {
      grant: message.payload,
      records: message.eventLogRecords,
    }
    const imported = await importExtensionEventLog(nookTypedArgs0_0)
    if (!imported.accessGranted) {
      return { ok: false, reason: 'event-log-access-not-granted' }
    }
    await ensureExtensionSessionDocument()
    const pairingItemsArgs: Parameters<
      typeof pairingPolicy.extensionPairingGrantStorageItems
    >[0] = { grant: grantApproval, imported }
    const pairingItems =
      pairingPolicy.extensionPairingGrantStorageItems(pairingItemsArgs)
    const previousPairingState = await getPairingStorage()
    await setPairingStorage(pairingItems)
    try {
      const nookTypedArgs0_1: Parameters<typeof sendSessionMessage>[0] = {
        type: ExtensionSessionMessageType.MigrateAuthProviders,
      }
      await sendSessionMessage(nookTypedArgs0_1)
      const nookTypedArgs0_2: Parameters<typeof sendSessionMessage>[0] = {
        type: ExtensionSessionMessageType.Reset,
      }
      await sendSessionMessage(nookTypedArgs0_2)
      // Snapshot before scrubbing so lazy extension IPC cannot observe
      // emptied credential fields mid-handoff.
      const importMessage: {
        type: ExtensionSessionMessageType.ImportVault
        payload: {
          vaultStoreId: string
          deviceId: string
          devicePublicKey: string
          deviceSigningPublicKey: string
          eventLogRecords: ExtensionPairingApprovedMessage['eventLogRecords']
          providers: StorageProvider[]
        }
      } = {
        type: ExtensionSessionMessageType.ImportVault,
        payload: {
          vaultStoreId: grantApproval.vaultStoreId,
          deviceId: grantApproval.deviceId,
          devicePublicKey: grantApproval.devicePublicKey,
          deviceSigningPublicKey: grantApproval.deviceSigningPublicKey,
          eventLogRecords: message.eventLogRecords,
          providers: structuredClone(providers),
        },
      }
      scrubProviderCredentials(providers)
      type SessionImportResponse = Awaited<
        ReturnType<typeof sendSessionMessage>
      >
      const handoffArgs: ProviderCredentialCleanupArgs<SessionImportResponse> =
        {
          providers: importMessage.payload.providers,
          operation: () => sendSessionMessage(importMessage),
        }
      const sessionImport = await runWithProviderCredentialCleanup(handoffArgs)
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
        const restoreArgs: Parameters<typeof restorePairingStorage>[0] = {
          previous: previousPairingState,
          written: pairingItems,
        }
        await restorePairingStorage(restoreArgs)
        return { ok: false, reason }
      }
    } catch (error) {
      const restoreArgs: Parameters<typeof restorePairingStorage>[0] = {
        previous: previousPairingState,
        written: pairingItems,
      }
      await restorePairingStorage(restoreArgs)
      throw error
    }
    return { ok: true, eventCount: imported.eventCount }
  } finally {
    scrubProviderCredentials(providers)
  }
}

export async function importApprovedPairing(
  message: ExtensionPairingApprovedMessage,
): Promise<PairingImportResult> {
  try {
    const sourceProviders = message.payload.providers
    const stagingArgs: Parameters<typeof stageProviderCredentials>[0] = {
      providers: sourceProviders,
      decode: decodeExtensionStorageProviders,
    }
    const stagingOperation = stageProviderCredentials(stagingArgs)
    scrubProviderCredentials(sourceProviders)
    message.payload.providers = []
    const staging = await stagingOperation
    if (staging.kind !== ProviderCredentialStagingKind.Staged) {
      return { ok: false, reason: 'invalid-provider-payload' }
    }
    const stagedProviders = staging.providers
    try {
      const args: ImportDecodedApprovedPairingArgs = {
        message,
        providers: stagedProviders,
      }
      return await importDecodedApprovedPairing(args)
    } finally {
      scrubProviderCredentials(stagedProviders)
    }
  } catch {
    return { ok: false, reason: 'event-log-import-failed' }
  }
}

export async function importLocalEventLogUpdate({
  vaultStoreId,
  eventLogRecords,
}: {
  vaultStoreId: string
  eventLogRecords: Parameters<typeof importExtensionEventLog>[0]['records']
}): Promise<PairingImportResult> {
  const pairingPolicy = await extensionPairingGrantPolicyReady
  const key = pairingPolicy.pairingGrantStorageKey(vaultStoreId)
  try {
    const stored = await getPairingStorage()
    const grant = stored[key]
    if (!pairingPolicy.isStoredExtensionPairingGrant(grant)) {
      return { ok: false, reason: 'vault-not-paired' }
    }
    const nookTypedArgs0_3: Parameters<typeof importExtensionEventLog>[0] = {
      grant,
      records: eventLogRecords,
    }
    const imported = await importExtensionEventLog(nookTypedArgs0_3)
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
      return { ok: false, reason: 'event-log-access-revoked' }
    }
    const setup = stored[setupStorageKey]
    const select =
      pairingPolicy.isExtensionReadySetupState(setup) &&
      setup.selectedVaultStoreId === vaultStoreId
    const pairingItemsArgs: Parameters<
      typeof pairingPolicy.extensionStoredPairingGrantStorageItems
    >[0] = { grant, imported, select }
    const pairingItems =
      pairingPolicy.extensionStoredPairingGrantStorageItems(pairingItemsArgs)
    await setPairingStorage(pairingItems)
    await ensureExtensionSessionDocument()
    const nookTypedArgs0_4: Parameters<typeof sendSessionMessage>[0] = {
      type: 'nook:extension-session-update-vault',
      payload: {
        vaultStoreId: grant.vaultStoreId,
        deviceId: grant.deviceId,
        devicePublicKey: grant.devicePublicKey,
        deviceSigningPublicKey: grant.deviceSigningPublicKey,
        eventLogRecords,
      },
    }
    await sendSessionMessage(nookTypedArgs0_4)
    return { ok: true, eventCount: imported.eventCount }
  } catch {
    return { ok: false, reason: 'event-log-import-failed' }
  }
}
