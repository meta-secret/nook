import { Schema } from 'effect'
import type { PendingAuthenticatorPicker } from './account-pickers'
import type {
  ExtensionPairingItems,
  ExtensionReadySetupState,
  LegacyPairingStorageItems,
  StoredExtensionPairingGrant,
} from '../pairing-grants'
import {
  extensionPairingGrantPolicyReady,
  setupStorageKey,
} from '../pairing-grants'
import { backgroundVaultRuntime } from '../vault-runtime'

export enum PendingIdentityHandoffKind {
  Pairing = 'pairing',
}

export type PendingIdentityHandoff = {
  kind: PendingIdentityHandoffKind.Pairing
  deviceId: string
  devicePublicKey: string
  deviceSigningPublicKey: string
}

type PendingIdentityHandoffSchemaFields = {
  kind: Schema.Schema<PendingIdentityHandoff['kind']>
  deviceId: Schema.Schema<string>
  devicePublicKey: Schema.Schema<string>
  deviceSigningPublicKey: Schema.Schema<string>
}

const pendingIdentityHandoffSchemaFields: PendingIdentityHandoffSchemaFields = {
  kind: Schema.Literal(PendingIdentityHandoffKind.Pairing),
  deviceId: Schema.String,
  devicePublicKey: Schema.String,
  deviceSigningPublicKey: Schema.String,
}

const pendingIdentityHandoffSchema = Schema.Struct(
  pendingIdentityHandoffSchemaFields,
) satisfies Schema.Schema<PendingIdentityHandoff>

export function decodePendingIdentityHandoff(
  value: ExtensionSessionStorageValue,
) {
  return Schema.decodeUnknown(pendingIdentityHandoffSchema)(value)
}

export type ExtensionSessionStorageValue =
  | PendingIdentityHandoff
  | PendingAuthenticatorPicker
  | ExtensionPairingItems[string]
  | ExtensionReadySetupState
  | StoredExtensionPairingGrant
  | string
  | boolean

export type ExtensionSessionStorageWrite = Record<
  string,
  ExtensionSessionStorageValue
>
export type ExtensionSessionStorageItems = Record<
  string,
  ExtensionSessionStorageValue
>

type IssueIdentityHandoffRequest = {
  nonce: string
  pending: PendingIdentityHandoff
}

enum LegacyPairingMigrationKind {
  NotStarted = 'not-started',
  Running = 'running',
}

type LegacyPairingMigration =
  | { kind: LegacyPairingMigrationKind.NotStarted }
  | { kind: LegacyPairingMigrationKind.Running; operation: Promise<void> }

type LegacyPairingStorageKeys = string[]

/** Owns session storage and the one-time migration from legacy pairing rows. */
export class ExtensionPairingStorage {
  private legacyPairingMigration: LegacyPairingMigration = {
    kind: LegacyPairingMigrationKind.NotStarted,
  }

  pendingIdentityHandoffStorageKey(nonce: string): string {
    return `nook.extension.identity-handoff.${nonce}`
  }

  setSessionStorage(items: ExtensionSessionStorageWrite): Promise<void> {
    return chrome.storage.session.set(items)
  }

  getSessionStorage(key: string): Promise<ExtensionSessionStorageItems> {
    return chrome.storage.session.get<ExtensionSessionStorageItems>(key)
  }

  getAllSessionStorage(): Promise<ExtensionSessionStorageItems> {
    return chrome.storage.session.get<ExtensionSessionStorageItems>()
  }

  removeSessionStorage(key: string): Promise<void> {
    return chrome.storage.session.remove(key)
  }

  async issueIdentityHandoff(
    request: IssueIdentityHandoffRequest,
  ): Promise<void> {
    const items: ExtensionSessionStorageWrite = {
      [this.pendingIdentityHandoffStorageKey(request.nonce)]: request.pending,
    }
    await this.setSessionStorage(items)
  }

  async setPairingStorage(items: ExtensionPairingItems): Promise<void> {
    await this.ensureLegacyPairingMigration()
    await backgroundVaultRuntime.persistExtensionPairingItems(items)
  }

  private legacyPairingStorageKeys(
    stored: LegacyPairingStorageItems,
  ): LegacyPairingStorageKeys {
    return Object.keys(stored).filter(
      (key) =>
        key === setupStorageKey ||
        key.startsWith('nook:extension-pairing-grant:'),
    )
  }

  private readLegacyPairingStorage(): Promise<LegacyPairingStorageItems> {
    return chrome.storage.local.get<LegacyPairingStorageItems>()
  }

  private removeLegacyPairingStorage(
    keys: LegacyPairingStorageKeys,
  ): Promise<void> {
    return chrome.storage.local.remove(keys)
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
      const legacyPairingRecords: LegacyPairingStorageItems =
        Object.fromEntries(
          Object.entries(legacy).filter(([key]) => legacyKeys.includes(key)),
        )
      const current = await backgroundVaultRuntime.loadExtensionPairingItems()
      const pairingPolicy = await extensionPairingGrantPolicyReady
      const migrated =
        pairingPolicy.migratedLegacyPairingStorageItems(legacyPairingRecords)
      if (Object.keys(current).length > 0) {
        const completedKeys = Object.keys(migrated).filter((key) => {
          const currentRecord = current[key]
          const migratedRecord = migrated[key]
          if (!legacyKeys.includes(key) || !currentRecord || !migratedRecord)
            return false
          const compareRequest: Parameters<
            typeof pairingPolicy.compare_extension_pairing_records
          >[0] = {
            current: currentRecord,
            migrated: migratedRecord,
          }
          return (
            pairingPolicy.compare_extension_pairing_records(compareRequest) ===
            'Equivalent'
          )
        })
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
    const record = stored[key]
    return record ? { [key]: record } : {}
  }
}
