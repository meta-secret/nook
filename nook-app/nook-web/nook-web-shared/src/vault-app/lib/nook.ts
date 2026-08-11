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
  authenticator_setup_key_changed,
  default_password_generation_options,
  default as initNookWasm,
  generate_id,
  NookVaultManager as NookVaultManagerClass,
  NookSecretFormFields,
  SecretType,
  build_secret_yaml,
  generate_password,
  generate_secret_id,
  VaultAccessStatus,
} from "$app-wasm";
import { createLogger, initWasmLogging } from "$lib/runtime/log";

await initNookWasm();
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
  authenticator_setup_key_changed,
  default_password_generation_options,
  generate_id,
  generate_password,
  generate_secret_id,
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

  // eslint-disable-next-line max-params -- Promise owns this positional executor signature.
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

/** Narrow the generated wasm transport result at its API boundary. */
export function syncVaultFromStorage({
  manager,
  mode,
  pat,
  repo,
}: {
  readonly manager: NookVaultManager;
  readonly mode: string;
  readonly pat: string;
  readonly repo: string;
}): Promise<NookVaultSyncResult> {
  return manager.sync_vault_from_storage(
    mode,
    pat,
    repo,
  ) as Promise<NookVaultSyncResult>;
}

const wasmLog = createLogger("wasm");

/**
 * Pipe the wasm manager's status channel (e.g. `GITHUB_FETCH_START`,
 * `DECRYPT_SUCCESS`) into the persistent IndexedDB log at debug level.
 *
 * Uses the non-blocking `drain_status_log` on an interval — the awaiting
 * `next_status` variant would hold the wasm-bindgen borrow and deadlock
 * every `&mut self` manager call.
 */
function drainWasmStatusIntoLog(manager: NookVaultManager) {
  setInterval(() => {
    try {
      for (const status of manager.drain_status_log()) {
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
    return build_secret_yaml(fields);
  } finally {
    fields.free();
  }
}
