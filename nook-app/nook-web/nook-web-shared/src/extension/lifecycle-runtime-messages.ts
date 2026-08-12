import type { ExtensionVaultEventPayload } from './nook-companion-wasm/nook_companion_wasm'

export enum OpenSimpleVaultMessageType {
  NookOpenSimpleVault = 'nook:open-simple-vault',
}

export type OpenSimpleVaultMessage = {
  type: OpenSimpleVaultMessageType.NookOpenSimpleVault
}

export enum BeginExtensionPairingMessageType {
  NookBeginExtensionPairing = 'nook:begin-extension-pairing',
}

export type BeginExtensionPairingMessage = {
  type: BeginExtensionPairingMessageType.NookBeginExtensionPairing
  payload: {
    deviceId: string
    devicePublicKey: string
    deviceSigningPublicKey: string
    deviceLabel: string
  }
}

export type ExtensionEventLogRecord = {
  eventId: string
  path: string
  event: ExtensionVaultEventPayload
}

export enum ExtensionLocalEventLogUpdatedMessageType {
  NookExtensionLocalEventLogUpdated = 'nook:extension-local-event-log-updated',
}

export type ExtensionLocalEventLogUpdatedMessage = {
  type: ExtensionLocalEventLogUpdatedMessageType.NookExtensionLocalEventLogUpdated
  payload: {
    vaultStoreId: string
    eventLogRecords: ExtensionEventLogRecord[]
  }
}
