import type { NookVaultManager } from "$app-wasm";
import type { DeviceMode } from "$lib/vault-architecture";

const PASSKEY_PRF_UNAVAILABLE = "PASSKEY_PRF_UNAVAILABLE";
const PASSKEY_UNAVAILABLE = "PASSKEY_UNAVAILABLE";

export function isPasskeyUnavailableError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(PASSKEY_UNAVAILABLE);
}

export function isPasskeyPrfUnavailableError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes(PASSKEY_PRF_UNAVAILABLE)
  );
}

export async function setupDeviceProtection(
  manager: NookVaultManager,
  passkeyLabel: string,
  deviceMode: DeviceMode = "standard",
): Promise<void> {
  await manager.setupDeviceProtectionWithPasskeyMode(
    location.hostname,
    "Nook",
    passkeyLabel,
    deviceMode,
  );
}

export async function unlockDeviceProtection(
  manager: NookVaultManager,
): Promise<void> {
  await manager.unlockDeviceProtectionWithPasskey(location.hostname);
}

export async function recoverDeviceProtectionWithPasskey(
  manager: NookVaultManager,
): Promise<void> {
  await manager.recoverDeviceProtectionWithPasskey(location.hostname);
}
