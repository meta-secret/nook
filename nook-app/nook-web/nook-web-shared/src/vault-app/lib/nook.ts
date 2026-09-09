import { VaultManagerStartup, VaultEngineFailure } from "$lib/runtime/wasm-bootstrap";
import { err, type Result } from "neverthrow";
import type { NookStorageConnectArgs } from "$app-wasm";
type StoredVaultSynchronization = NookStorageConnectArgs & {
  readonly manager: NookVaultManager;
};
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
  generate_id,
  configured_vault_application,
  NookSecretFormFields,
  SecretType,
  build_secret_yaml,
  generate_password,
  generate_secret_id,
  VaultAccessStatus,
} from "$app-wasm";
import { browserLogRuntime } from "$lib/runtime/log";


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

export async function getVaultManager(): Promise<Result<NookVaultManager, VaultEngineFailure>> {
  const manager = await new VaultManagerStartup(configured_vault_application()).open();
  if (manager.isOk()) {
    try {
      browserLogRuntime.initWasmLogging();
      drainWasmStatusIntoLog(manager.value);
    } catch {
      manager.value.free();
      return err(VaultEngineFailure.ManagerCreation);
    }
  }
  return manager;
}

/** Narrow the generated wasm transport result at its API boundary. */
export function syncVaultFromStorage({
  manager,
  mode,
  pat,
  repo,
}: StoredVaultSynchronization): Promise<NookVaultSyncResult> {
  return manager.sync_vault_from_storage(mode, pat, repo);
}

const wasmLog = browserLogRuntime.createLogger("wasm");

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
