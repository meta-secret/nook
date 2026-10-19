import {
  NativeVaultStorageFailure,
  type VaultStorageFailure,
} from "$lib/runtime/storage-failure";
import {
  VaultManagerStartup,
  VaultEngineFailure,
} from "$lib/runtime/wasm-bootstrap";
import { err, ok, type Result } from "neverthrow";
import type { NookStorageConnectArgs } from "$app-wasm";
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

/** Public passkey facts for the detail panel; label fields are translation keys. */
export type PasskeyDetailsView = {
  readonly credentialId: string;
  readonly relyingPartyName: string | undefined;
  readonly distinctUserName: string | undefined;
  readonly algorithmLabelKey: string;
  readonly publicKeyFingerprint: string;
  readonly signatureCount: number;
  readonly discoverableLabelKey: string;
  readonly backupStatusLabelKey: string;
};

/**
 * Event-log history of one item. Label fields are translation keys; a device
 * row shows exactly when its label key is present, with its value as the
 * `{device}` replacement. Absent rows do not apply to the item.
 */
export type SecretHistoryView = {
  readonly originLabelKey: string;
  readonly originAt: string;
  readonly originDeviceLabelKey: string | undefined;
  readonly originDeviceValue: string;
  readonly modifiedAt: string | undefined;
  readonly modifiedDeviceLabelKey: string | undefined;
  readonly modifiedDeviceValue: string;
};

export interface VaultStorageSynchronizationRequest {
  readonly manager: NookVaultManager;
  readonly mode: NookStorageConnectArgs["mode"];
  readonly pat: NookStorageConnectArgs["pat"];
  readonly repo: NookStorageConnectArgs["repo"];
}

export function isoTimestamp(): string {
  return new Date().toISOString();
}

export class VaultManagerRuntime {
  async open(): Promise<Result<NookVaultManager, VaultEngineFailure>> {
    const manager = await new VaultManagerStartup(
      configured_vault_application(),
    ).open();
    if (manager.isOk()) {
      try {
        browserLogRuntime.initWasmLogging();
        this.drainStatusIntoLog(manager.value);
      } catch {
        manager.value.free();
        return err(VaultEngineFailure.ManagerCreation);
      }
    }
    return manager;
  }

  private drainStatusIntoLog(manager: NookVaultManager) {
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
}

/** Narrow the generated wasm transport result at its API boundary. */
export class VaultStorageSynchronization {
  constructor(private readonly request: VaultStorageSynchronizationRequest) {}

  async run(): Promise<Result<NookVaultSyncResult, VaultStorageFailure>> {
    const { manager, mode, pat, repo } = this.request;
    try {
      return ok(await manager.sync_vault_from_storage(mode, pat, repo));
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure));
    }
  }
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
/** Build a validated YAML payload from a core-owned secret form variant. */
export function buildSecretYaml(fields: NookSecretFormFields): string {
  try {
    return build_secret_yaml(fields);
  } finally {
    fields.free();
  }
}
