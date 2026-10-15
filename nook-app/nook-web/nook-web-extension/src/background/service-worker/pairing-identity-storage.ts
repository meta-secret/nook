import { Schema } from 'effect'
import type { PendingAuthenticatorPicker } from './account-pickers'
import type {
  ExtensionPairingItems,
  ExtensionReadySetupState,
  StoredExtensionPairingGrant,
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
  kind: Schema.Codec<PendingIdentityHandoff['kind']>
  deviceId: Schema.Codec<string>
  devicePublicKey: Schema.Codec<string>
  deviceSigningPublicKey: Schema.Codec<string>
}

const pendingIdentityHandoffSchemaFields: PendingIdentityHandoffSchemaFields = {
  kind: Schema.Literal(PendingIdentityHandoffKind.Pairing),
  deviceId: Schema.String,
  devicePublicKey: Schema.String,
  deviceSigningPublicKey: Schema.String,
}

const pendingIdentityHandoffSchema = Schema.Struct(
  pendingIdentityHandoffSchemaFields,
) satisfies Schema.Codec<PendingIdentityHandoff>

export function decodePendingIdentityHandoff(
  value: ExtensionSessionStorageValue,
) {
  return Schema.decodeUnknownEffect(pendingIdentityHandoffSchema)(value)
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

/** Owns session storage and the extension's pairing records. */
export class ExtensionPairingStorage {
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
    await backgroundVaultRuntime.persistExtensionPairingItems(items)
  }

  async getPairingStorage(key?: string): Promise<ExtensionPairingItems> {
    const stored = await backgroundVaultRuntime.loadExtensionPairingItems()
    if (!key) return stored
    const record = stored[key]
    return record ? { [key]: record } : {}
  }
}
