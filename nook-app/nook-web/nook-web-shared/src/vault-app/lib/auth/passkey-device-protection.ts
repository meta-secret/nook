import { DeviceMode, type NookVaultManager } from "$app-wasm";

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

export enum PasskeyCeremonyOutcome {
  PasskeyUnavailable = "passkey_unavailable",
  PrfUnavailable = "passkey_prf_unavailable",
  CeremonyNotAllowed = "passkey_ceremony_not_allowed",
  CeremonyFailed = "passkey_ceremony_failed",
}

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

export function passkeyCeremonyOutcome(error: unknown): PasskeyCeremonyOutcome {
  if (isPasskeyUnavailableError(error)) {
    return PasskeyCeremonyOutcome.PasskeyUnavailable;
  }
  if (isPasskeyPrfUnavailableError(error)) {
    return PasskeyCeremonyOutcome.PrfUnavailable;
  }
  if (isPasskeyCeremonyNotAllowedError(error)) {
    return PasskeyCeremonyOutcome.CeremonyNotAllowed;
  }
  return PasskeyCeremonyOutcome.CeremonyFailed;
}

/** Sanitized fields safe to persist for AI-debug / app-log correlation. */
export function sanitizedPasskeyCeremonyData(error: unknown): {
  outcome: PasskeyCeremonyOutcome;
  errorName?: string;
} {
  const outcome = passkeyCeremonyOutcome(error);
  const errorName = sanitizedPasskeyErrorName(error);
  return errorName.kind === SanitizedPasskeyErrorNameKind.Safe
    ? { outcome, errorName: errorName.name }
    : { outcome };
}

enum SanitizedPasskeyErrorNameKind {
  Omitted = "omitted",
  Safe = "safe",
}

type SanitizedPasskeyErrorName =
  | { kind: SanitizedPasskeyErrorNameKind.Omitted }
  | { kind: SanitizedPasskeyErrorNameKind.Safe; name: string };

function sanitizedPasskeyErrorName(error: unknown): SanitizedPasskeyErrorName {
  if (!(error instanceof Error)) {
    return { kind: SanitizedPasskeyErrorNameKind.Omitted };
  }
  if (SAFE_PASSKEY_ERROR_NAMES.has(error.name)) {
    return { kind: SanitizedPasskeyErrorNameKind.Safe, name: error.name };
  }

  const fromMessage = error.message.match(
    /\b(NotAllowedError|NotSupportedError|SecurityError|InvalidStateError|AbortError|NetworkError|UnknownError)\b/,
  );
  const name = fromMessage?.[1];
  return name
    ? { kind: SanitizedPasskeyErrorNameKind.Safe, name }
    : { kind: SanitizedPasskeyErrorNameKind.Omitted };
}

export async function setupDeviceProtection({
  manager,
  passkeyLabel,
  deviceMode,
}: {
  readonly manager: NookVaultManager;
  readonly passkeyLabel: string;
  readonly deviceMode: DeviceMode;
}): Promise<void> {
  await manager.setup_device_protection_with_passkey_mode(
    location.hostname,
    "Nook",
    passkeyLabel,
    deviceMode,
  );
}

export async function unlockDeviceProtection(
  manager: NookVaultManager,
): Promise<void> {
  await manager.unlock_device_protection_with_passkey(location.hostname);
}

export async function recoverDeviceProtectionWithPasskey(
  manager: NookVaultManager,
): Promise<void> {
  await manager.recover_device_protection_with_passkey(location.hostname);
}
