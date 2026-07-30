import type { ExtensionPairingApprovedMessage } from '../../../../nook-web-shared/src/extension/runtime-messages'
import {
  ProviderCredentialStagingKind,
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

export async function importApprovedPairing(
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
    await ensureExtensionSessionDocument()
    const staging = stageProviderCredentials(message.payload.providers)
    const providers =
      staging.kind === ProviderCredentialStagingKind.Staged
        ? staging.providers
        : message.payload.providers
    const pairingItems = extensionPairingGrantStorageItems(
      message.payload,
      imported,
    )
    const previousPairingState = await getPairingStorage()
    await setPairingStorage(pairingItems)
    try {
      await sendSessionMessage({
        type: 'nook:extension-session-migrate-auth-providers',
      })
      await sendSessionMessage({ type: 'nook:extension-session-reset' })
      // Snapshot before scrubbing so lazy extension IPC cannot observe emptied
      // credential fields mid-handoff.
      const importMessage = {
        type: 'nook:extension-session-import-vault' as const,
        payload: {
          vaultStoreId: message.payload.vaultStoreId,
          deviceId: message.payload.deviceId,
          devicePublicKey: message.payload.devicePublicKey,
          deviceSigningPublicKey: message.payload.deviceSigningPublicKey,
          eventLogRecords: message.eventLogRecords,
          providers: structuredClone(providers),
        },
      }
      scrubProviderCredentials(providers)
      const sessionImport = await sendSessionMessage(importMessage)
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
    } finally {
      scrubProviderCredentials(providers)
    }
    return { ok: true, eventCount: imported.eventCount }
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
