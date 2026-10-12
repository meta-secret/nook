import type { NookImportResult } from "$lib/nook";
import type { SecretOperationResult } from "$lib/vault/secret-operation-failure";
import type { VaultSecretActions } from "$lib/vault/secrets";

export interface BitwardenVaultImportInput {
  readonly json: string;
  readonly password: string;
}

export interface CsvVaultImportInput {
  readonly csv: string;
}

export interface OnePasswordVaultImportInput {
  readonly archive: Uint8Array;
}

export interface PasswordsVaultImportInput {
  readonly exportBytes: Uint8Array;
}

export interface AuthenticatorMigrationImportInput {
  readonly migrationUris: string[];
}

/** Owns the facade for password-manager and authenticator import operations. */
export class VaultSecretImportActions {
  constructor(private readonly actions: VaultSecretActions) {}

  handleBitwardenImport(
    request: BitwardenVaultImportInput,
  ): Promise<SecretOperationResult<NookImportResult>> {
    return this.actions.handleBitwardenImport(request);
  }

  handleKeePassXcImport(
    request: CsvVaultImportInput,
  ): Promise<SecretOperationResult<NookImportResult>> {
    return this.actions.handleKeePassXcImport(request);
  }

  handleLastPassImport(
    request: CsvVaultImportInput,
  ): Promise<SecretOperationResult<NookImportResult>> {
    return this.actions.handleLastPassImport(request);
  }

  handleKeeperImport(
    request: CsvVaultImportInput,
  ): Promise<SecretOperationResult<NookImportResult>> {
    return this.actions.handleKeeperImport(request);
  }

  handleOnePasswordImport(
    request: OnePasswordVaultImportInput,
  ): Promise<SecretOperationResult<NookImportResult>> {
    return this.actions.handleOnePasswordImport(request);
  }

  handleApplePasswordsImport(
    request: PasswordsVaultImportInput,
  ): Promise<SecretOperationResult<NookImportResult>> {
    return this.actions.handleApplePasswordsImport(request);
  }

  handleChromePasswordsImport(
    request: CsvVaultImportInput,
  ): Promise<SecretOperationResult<NookImportResult>> {
    return this.actions.handleChromePasswordsImport(request);
  }

  handleDashlaneImport(
    request: PasswordsVaultImportInput,
  ): Promise<SecretOperationResult<NookImportResult>> {
    return this.actions.handleDashlaneImport(request);
  }

  handleGoogleAuthenticatorImport(
    request: AuthenticatorMigrationImportInput,
  ): Promise<SecretOperationResult<NookImportResult>> {
    return this.actions.handleGoogleAuthenticatorImport(request);
  }

  handleProtonPassImport(
    request: PasswordsVaultImportInput,
  ): Promise<SecretOperationResult<NookImportResult>> {
    return this.actions.handleProtonPassImport(request);
  }
}
