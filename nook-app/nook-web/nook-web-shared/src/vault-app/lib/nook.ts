import type {
  NookImportResult,
  NookJoinRequest,
  PasswordGenerationOptions,
  NookSecretListItem,
  NookSecretRecord,
  NookVaultManager,
  NookVaultMember,
  NookVaultSyncResult,
} from "$app-wasm";
import {
  authenticatorSetupKeyChanged,
  defaultPasswordGenerationOptions,
  default as initNookWasm,
  generateId,
  NookVaultManager as NookVaultManagerClass,
  NookSecretFormFields,
  SecretType,
  buildSecretYaml as wasmBuildSecretYaml,
  generatePassword,
  generateSecretId,
  VaultAccessStatus,
} from "$app-wasm";
import { createLogger, initWasmLogging } from "$lib/log";
import { ensureAppWasm } from "$lib/wasm-bootstrap";

await ensureAppWasm();
initWasmLogging();

export type {
  NookImportResult,
  NookJoinRequest,
  NookJoinRequest as JoinRequest,
  PasswordGenerationOptions,
  NookSecretListItem,
  NookSecretRecord,
  NookVaultManager,
  NookVaultMember,
  NookVaultMember as VaultMember,
  NookVaultSyncResult,
  NookSecretFormFields,
};
export {
  authenticatorSetupKeyChanged,
  defaultPasswordGenerationOptions,
  generateId,
  generatePassword,
  generateSecretId,
  SecretType,
  VaultAccessStatus,
};

export type AuthenticatorCodeView = {
  code: string;
  secondsRemaining: number;
  period: number;
  expiresAtUnixSeconds: number;
};

export function isoTimestamp(): string {
  return new Date().toISOString();
}

export async function getVaultManager(): Promise<NookVaultManager> {
  const loadWasm = async () => {
    await initNookWasm();
    initWasmLogging();
    const manager = new NookVaultManagerClass();
    drainWasmStatusIntoLog(manager);
    return manager;
  };

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () =>
        reject(
          new Error(
            "Vault engine timed out while loading. Refresh and try again.",
          ),
        ),
      15_000,
    );
  });

  return Promise.race([loadWasm(), timeout]);
}

const wasmLog = createLogger("wasm");

/**
 * Pipe the wasm manager's status channel (e.g. `GITHUB_FETCH_START`,
 * `DECRYPT_SUCCESS`) into the persistent IndexedDB log at debug level.
 *
 * Uses the non-blocking `drainStatusLog` on an interval — the awaiting
 * `next_status` variant would hold the wasm-bindgen borrow and deadlock
 * every `&mut self` manager call.
 */
function drainWasmStatusIntoLog(manager: NookVaultManager) {
  setInterval(() => {
    try {
      for (const status of manager.drainStatusLog()) {
        wasmLog.debug(status);
      }
    } catch {
      // Manager may be mid-borrow by an async &mut call; retry next tick.
    }
  }, 500);
}

/** Build a validated YAML payload from a core-owned secret form variant. */
export function buildSecretYaml(fields: NookSecretFormFields): string {
  try {
    return wasmBuildSecretYaml(fields);
  } finally {
    fields.free();
  }
}
