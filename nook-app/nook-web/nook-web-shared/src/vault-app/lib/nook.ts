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
  SecretType,
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
  SecretType,
  VaultAccessStatus,
};

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
      type: SecretType.Login;
      websiteUrl: string;
      username: string;
      password: string;
      notes: string;
    }
  | {
      type: SecretType.ApiKey;
      websiteUrl: string;
      key: string;
      expiresAt: string;
    }
  | { type: SecretType.SeedPhrase; name: string; seed: string }
  | { type: SecretType.SecureNote; title: string; note: string }
  | {
      type: SecretType.Authenticator;
      issuer: string;
      account: string;
      websiteUrl: string;
      totpSecret: string;
      algorithm: string;
      digits: string;
      period: string;
      backupCodes: string;
    }
  | {
      type: SecretType.CreditCard;
      title: string;
      cardholderName: string;
      number: string;
      expirationMonth: string;
      expirationYear: string;
      cvv: string;
      notes: string;
    }
  | {
      type: SecretType.FileAttachment;
      title: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      contentBase64: string;
    };

/** Build a validated YAML payload from one core-owned secret form variant. */
export function buildSecretYaml(input: SecretFormInput): string {
  let fields: NookSecretFormFields;
  switch (input.type) {
    case SecretType.Login:
      fields = NookSecretFormFields.login(
        input.websiteUrl,
        input.username,
        input.password,
        input.notes,
      );
      break;
    case SecretType.ApiKey:
      fields = NookSecretFormFields.apiKey(
        input.websiteUrl,
        input.key,
        input.expiresAt,
      );
      break;
    case SecretType.SeedPhrase:
      fields = NookSecretFormFields.seedPhrase(input.name, input.seed);
      break;
    case SecretType.SecureNote:
      fields = NookSecretFormFields.secureNote(input.title, input.note);
      break;
    case SecretType.Authenticator:
      fields = NookSecretFormFields.authenticator(
        input.issuer,
        input.account,
        input.websiteUrl,
        input.totpSecret,
        input.algorithm,
        input.digits,
        input.period,
        input.backupCodes,
      );
      break;
    case SecretType.CreditCard:
      fields = NookSecretFormFields.creditCard(
        input.title,
        input.cardholderName,
        input.number,
        input.expirationMonth,
        input.expirationYear,
        input.cvv,
        input.notes,
      );
      break;
    case SecretType.FileAttachment:
      fields = NookSecretFormFields.fileAttachment(
        input.title,
        input.fileName,
        input.mimeType,
        input.sizeBytes,
        input.contentBase64,
      );
      break;
  }
  try {
    return wasmBuildSecretYaml(fields);
  } finally {
    fields.free();
  }
}
