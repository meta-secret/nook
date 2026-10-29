import type { PendingAuthenticatorPicker } from './account-pickers'
import type {
  ExtensionPairingItems,
  ExtensionReadySetupState,
  StoredExtensionPairingGrant,
} from '../pairing-grants'
import { backgroundVaultRuntime } from '../vault-runtime'

export type ExtensionSessionStorageValue =
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

/** Owns session storage and the extension's pairing records. */
export class ExtensionPairingStorage {
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

  async setPairingStorage(items: ExtensionPairingItems): Promise<void> {
    await backgroundVaultRuntime.persistExtensionPairingItems(items)
  }

  async getPairingStorage(key?: string): Promise<ExtensionPairingItems> {
    const stored = await backgroundVaultRuntime.loadExtensionPairingItems()
    if (!key) return stored
    const record = stored[key]
    return record ? { [key]: record } : {}
  }
}
