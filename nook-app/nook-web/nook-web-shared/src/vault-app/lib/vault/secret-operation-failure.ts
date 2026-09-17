import type { Result } from "neverthrow";
import type { OAuthFailure } from "$lib/auth/oauth-failure";
import type { VaultStorageFailure } from "$lib/runtime/storage-failure";
import type { VaultEditRestriction } from "$lib/vault/runtime-state.svelte";
import { VaultEditDecision } from "$app-wasm";
import type { VaultState } from "$lib/vault.svelte";

/** Retains the Rust-produced edit decision and translated reason. */
export class SecretEditRejection {
  constructor(
    readonly restriction: Exclude<
      VaultEditRestriction,
      { decision: VaultEditDecision.Allowed }
    >,
  ) {}
}
export type SecretOperationFailure =
  VaultStorageFailure | SecretEditRejection | OAuthFailure;
export type SecretOperationResult<T> = Result<T, SecretOperationFailure>;

export enum SecretMutationOutcome {
  Prepared = "prepared",
  Added = "added",
  Deleted = "deleted",
  Replaced = "replaced",
}

export class SecretFailurePresentation {
  constructor(private readonly vault: VaultState) {}
  message(failure: SecretOperationFailure): string {
    return failure instanceof SecretEditRejection
      ? failure.restriction.reason
      : this.vault.t(failure.translationKey);
  }
  show(failure: SecretOperationFailure): void {
    this.vault.errorMsg = this.message(failure);
  }
}
