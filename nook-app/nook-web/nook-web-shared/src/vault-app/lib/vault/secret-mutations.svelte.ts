import type { SecretType } from "$lib/nook";
import type { VaultSecretActions } from "$lib/vault/secrets";

export interface SecretCreationInput {
  readonly id: string;
  readonly type: SecretType;
  readonly data: string;
}

export interface SecretDeletionInput {
  readonly id: string;
}

export interface SecretReplacementInput {
  readonly oldId: string;
  readonly type: SecretType;
  readonly data: string;
}

/** Owns CRUD mutation requests delegated by the vault facade. */
export class VaultSecretMutationActions {
  constructor(private readonly actions: VaultSecretActions) {}

  handleAddSecret(request: SecretCreationInput) {
    return this.actions.handleAddSecret(request);
  }

  handleDeleteSecret(
    request: SecretDeletionInput,
  ): ReturnType<VaultSecretActions["handleDeleteSecret"]> {
    return this.actions.handleDeleteSecret(request);
  }

  handleReplaceSecret(
    request: SecretReplacementInput,
  ): ReturnType<VaultSecretActions["handleReplaceSecret"]> {
    return this.actions.handleReplaceSecret(request);
  }
}
