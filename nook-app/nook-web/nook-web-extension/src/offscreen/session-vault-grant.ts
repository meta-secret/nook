import type { ExtensionVaultGrant } from './session-vault-operations'

export type ExtensionVaultGrantPayload = {
  vaultStoreId: string
  deviceId: string
  devicePublicKey: string
  deviceSigningPublicKey: string
}

export function extensionVaultGrant(
  payload: ExtensionVaultGrantPayload,
): ExtensionVaultGrant {
  return {
    vaultStoreId: payload.vaultStoreId,
    deviceId: payload.deviceId,
    devicePublicKey: payload.devicePublicKey,
    deviceSigningPublicKey: payload.deviceSigningPublicKey,
  }
}
