import type { ExtensionPairingApprovedMessage } from '../../../../nook-web-shared/src/extension/runtime-messages'
import type { StorageProvider } from '../../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  type ProviderCredentialCleanupArgs,
  ProviderCredentialStagingKind,
  runWithProviderCredentialCleanup,
  scrubProviderCredentials,
  stageProviderCredentials,
} from '../../lib/provider-credential-staging'
import {
  extensionPairingGrantStorageItems,
  extensionStoredPairingGrantStorageItems,
  isExtensionReadySetupState,
  isStoredExtensionPairingGrant,
  pairingGrantStorageKey,
  setupAfterPairingGrantRemoval,
  PairingSetupAfterRemovalKind,
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

async function reconcilePairingStorage(
  items: Record<string, unknown>,
  removedKeys: string[],
): Promise<void> {
  await ensureLegacyPairingMigration()
  await reconcileExtensionPairingState(items, removedKeys)
}

async function restorePairingStorage(
  previous: Record<string, unknown>,
  written: Record<string, unknown>,
): Promise<void> {
  const touchedKeys = Object.keys(written)
  const restore = Object.fromEntries(
    touchedKeys
      .filter((key) => key in previous)
      .map((key) => [key, previous[key]]),
  )
  const addedKeys = touchedKeys.filter((key) => !(key in previous))
  await reconcilePairingStorage(restore, addedKeys)
}

type ImportDecodedApprovedPairingArgs = {
  message: ExtensionPairingApprovedMessage
  providers: StorageProvider[]
}

async function importDecodedApprovedPairing(
  args: ImportDecodedApprovedPairingArgs,
): Promise<{ ok: boolean; reason?: string; eventCount?: number }> {
  const { message, providers } = args
  const grant: ExtensionPairingApprovedMessage['payload'] = {
    ...message.payload,
    providers,
  }
  try {
    const imported = await importExtensionEventLog(
      grant,
      message.eventLogRecords,
    )
    if (!imported.accessGranted) {
      return { ok: false, reason: 'event-log-access-not-granted' }
    }
    await ensureExtensionSessionDocument()
    const pairingItems = extensionPairingGrantStorageItems(grant, imported)
    const previousPairingState = await getPairingStorage()
    await setPairingStorage(pairingItems)
    try {
      await sendSessionMessage({
        type: 'nook:extension-session-migrate-auth-providers',
      })
      await sendSessionMessage({ type: 'nook:extension-session-reset' })
      // Snapshot before scrubbing so lazy extension IPC cannot observe
      // emptied credential fields mid-handoff.
      const importMessage = {
        type: 'nook:extension-session-import-vault' as const,
        payload: {
          vaultStoreId: grant.vaultStoreId,
          deviceId: grant.deviceId,
          devicePublicKey: grant.devicePublicKey,
          deviceSigningPublicKey: grant.deviceSigningPublicKey,
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
        await restorePairingStorage(previousPairingState, pairingItems)
        return { ok: false, reason }
      }
    } catch (error) {
      await restorePairingStorage(previousPairingState, pairingItems)
      throw error
    }
    return { ok: true, eventCount: imported.eventCount }
  } finally {
    scrubProviderCredentials(providers)
  }
}

export async function importApprovedPairing(
  message: ExtensionPairingApprovedMessage,
): Promise<{ ok: boolean; reason?: string; eventCount?: number }> {
  try {
    const sourceProviders = message.payload.providers
    const staging = stageProviderCredentials(sourceProviders)
    scrubProviderCredentials(sourceProviders)
    message.payload.providers = []
    if (staging.kind !== ProviderCredentialStagingKind.Staged) {
      return { ok: false, reason: 'invalid-provider-payload' }
    }
    const stagedProviders = staging.providers
    try {
      let providers: StorageProvider[]
      try {
        providers = await decodeExtensionStorageProviders(stagedProviders)
      } catch {
        return { ok: false, reason: 'invalid-provider-payload' }
      }
      const args: ImportDecodedApprovedPairingArgs = { message, providers }
      return await importDecodedApprovedPairing(args)
    } finally {
      scrubProviderCredentials(stagedProviders)
    }
  } catch {
    return { ok: false, reason: 'event-log-import-failed' }
  }
}

export async function importLocalEventLogUpdate(
  vaultStoreId: string,
  eventLogRecords: Parameters<typeof importExtensionEventLog>[1],
): Promise<{ ok: boolean; reason?: string; eventCount?: number }> {
  const key = pairingGrantStorageKey(vaultStoreId)
  try {
    const stored = await getPairingStorage()
    const grant = stored[key]
    if (!isStoredExtensionPairingGrant(grant)) {
      return { ok: false, reason: 'vault-not-paired' }
    }
    const imported = await importExtensionEventLog(grant, eventLogRecords)
    if (!imported.accessGranted) {
      const setup = setupAfterPairingGrantRemoval(stored, vaultStoreId)
      await reconcilePairingStorage(
        setup.kind === PairingSetupAfterRemovalKind.Ready
          ? { [setupStorageKey]: setup.setup }
          : {},
        [
          key,
          ...(setup.kind === PairingSetupAfterRemovalKind.Ready
            ? []
            : [setupStorageKey]),
        ],
      )
      return { ok: false, reason: 'event-log-access-revoked' }
    }
    const setup = stored[setupStorageKey]
    const select =
      isExtensionReadySetupState(setup) &&
      setup.selectedVaultStoreId === vaultStoreId
    await setPairingStorage(
      extensionStoredPairingGrantStorageItems(grant, imported, select),
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
