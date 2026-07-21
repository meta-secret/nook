import type { NookVaultManager } from "$app-wasm";
import type { DeviceMode } from "$lib/vault-architecture";

const PASSKEY_PRF_UNAVAILABLE = "PASSKEY_PRF_UNAVAILABLE";
const PASSKEY_UNAVAILABLE = "PASSKEY_UNAVAILABLE";
const PASSKEY_CEREMONY_NOT_ALLOWED = "PASSKEY_CEREMONY_NOT_ALLOWED";

const SAFE_PASSKEY_ERROR_NAMES = new Set([
  "NotAllowedError",
  "NotSupportedError",
  "SecurityError",
  "InvalidStateError",
  "AbortError",
  "NetworkError",
  "UnknownError",
]);

export type PasskeyCeremonyOutcome =
  | "passkey_unavailable"
  | "passkey_prf_unavailable"
  | "passkey_ceremony_not_allowed"
  | "passkey_ceremony_failed";

export function isPasskeyUnavailableError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(PASSKEY_UNAVAILABLE);
}

export function isPasskeyPrfUnavailableError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes(PASSKEY_PRF_UNAVAILABLE)
  );
}

export function isPasskeyCeremonyNotAllowedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes(PASSKEY_CEREMONY_NOT_ALLOWED)
  );
}

export function passkeyCeremonyOutcome(
  error: unknown,
): PasskeyCeremonyOutcome {
  if (isPasskeyUnavailableError(error)) return "passkey_unavailable";
  if (isPasskeyPrfUnavailableError(error)) return "passkey_prf_unavailable";
  if (isPasskeyCeremonyNotAllowedError(error)) {
    return "passkey_ceremony_not_allowed";
  }
  return "passkey_ceremony_failed";
}

/** Sanitized fields safe to persist for AI-debug / app-log correlation. */
export function sanitizedPasskeyCeremonyData(error: unknown): {
  outcome: PasskeyCeremonyOutcome;
  errorName?: string;
} {
  const outcome = passkeyCeremonyOutcome(error);
  const errorName = sanitizedPasskeyErrorName(error);
  return errorName ? { outcome, errorName } : { outcome };
}

function sanitizedPasskeyErrorName(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  if (SAFE_PASSKEY_ERROR_NAMES.has(error.name)) return error.name;

  const fromMessage = error.message.match(
    /\b(NotAllowedError|NotSupportedError|SecurityError|InvalidStateError|AbortError|NetworkError|UnknownError)\b/,
  );
  return fromMessage?.[1];
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
