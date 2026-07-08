import type { NookVaultManager } from '$lib/nook-wasm/nook_wasm'

const PASSKEY_PRF_UNAVAILABLE = 'PASSKEY_PRF_UNAVAILABLE'

export function isPasskeyPrfUnavailableError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes(PASSKEY_PRF_UNAVAILABLE)
  )
}

export async function setupDeviceProtection(
  manager: NookVaultManager,
): Promise<void> {
  await manager.setupDeviceProtectionWithPasskey(location.hostname, 'Nook')
}

export async function unlockDeviceProtection(
  manager: NookVaultManager,
): Promise<void> {
  await manager.unlockDeviceProtectionWithPasskey(location.hostname)
}

export async function recoverDeviceProtectionWithPasskey(
  manager: NookVaultManager,
): Promise<void> {
  await manager.recoverDeviceProtectionWithPasskey(location.hostname)
}
