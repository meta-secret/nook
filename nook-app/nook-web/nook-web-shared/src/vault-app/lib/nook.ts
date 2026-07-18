import type {
  NookImportResult,
  NookJoinRequest,
  NookSecretListItem,
  NookSecretRecord,
  NookVaultManager,
  NookVaultMember,
  NookVaultSyncResult,
} from "$app-wasm";
import {
  authenticatorSetupKeyChanged,
  default as initNookWasm,
  generateId,
  NookVaultManager as NookVaultManagerClass,
  NookSecretFormFields,
  buildSecretYaml as wasmBuildSecretYaml,
  generatePassword as wasmGeneratePassword,
  generateSecretId,
  VaultAccessStatus,
} from "$app-wasm";
import { createLogger, initWasmLogging } from "$lib/log";
import { ensureAppWasm } from "$lib/wasm-bootstrap";
import { generatePasswordWithOptions } from "$web-shared/password/generator";

await ensureAppWasm();
initWasmLogging();

export type {
  NookImportResult,
  NookJoinRequest,
  NookJoinRequest as JoinRequest,
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
  generateId,
  generateSecretId,
  VaultAccessStatus,
};

/** UI-only tag for the add-secret type picker — canonical schema lives in `nook-core`. */
export type VaultItemType =
  | "login"
  | "api-key"
  | "seed-phrase"
  | "secure-note"
  | "passkey"
  | "authenticator";

export type AuthenticatorCodeView = {
  code: string;
  secondsRemaining: number;
  period: number;
  expiresAtUnixSeconds: number;
};

/** Cryptographically secure password — does not borrow the vault manager. */
export function generatePassword(
  length: number,
  lowercase: boolean,
  uppercase: boolean,
  numbers: boolean,
  symbols: boolean,
): string {
  return generatePasswordWithOptions(wasmGeneratePassword, {
    length,
    lowercase,
    uppercase,
    numbers,
    symbols,
  });
}

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

export type SecretFormInput =
  | {
      type: "login";
      websiteUrl: string;
      username: string;
      password: string;
      notes: string;
    }
  | { type: "api-key"; websiteUrl: string; key: string; expiresAt: string }
  | { type: "seed-phrase"; name: string; seed: string }
  | { type: "secure-note"; title: string; note: string }
  | {
      type: "authenticator";
      issuer: string;
      account: string;
      totpSecret: string;
      algorithm: string;
      digits: string;
      period: string;
      backupCodes: string;
    };

/** Build a validated YAML payload from one core-owned secret form variant. */
export function buildSecretYaml(input: SecretFormInput): string {
  let fields: NookSecretFormFields;
  switch (input.type) {
    case "login":
      fields = NookSecretFormFields.login(
        input.websiteUrl,
        input.username,
        input.password,
        input.notes,
      );
      break;
    case "api-key":
      fields = NookSecretFormFields.apiKey(
        input.websiteUrl,
        input.key,
        input.expiresAt,
      );
      break;
    case "seed-phrase":
      fields = NookSecretFormFields.seedPhrase(input.name, input.seed);
      break;
    case "secure-note":
      fields = NookSecretFormFields.secureNote(input.title, input.note);
      break;
    case "authenticator":
      fields = NookSecretFormFields.authenticator(
        input.issuer,
        input.account,
        input.totpSecret,
        input.algorithm,
        input.digits,
        input.period,
        input.backupCodes,
      );
      break;
  }
  try {
    return wasmBuildSecretYaml(fields);
  } finally {
    fields.free();
  }
}
