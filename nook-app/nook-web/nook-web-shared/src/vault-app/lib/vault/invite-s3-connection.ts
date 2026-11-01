import { err, ok, type Result } from "neverthrow";
import {
  draft_s3_storage_args,
  type NookEnrollmentProvider,
  type NookStorageConnectArgs,
  type S3Connection,
} from "$app-wasm";
import { S3_PROVIDER_TYPE } from "$lib/auth/providers";
import {
  NativeVaultStorageFailure,
  VaultStorageFailure,
  VaultStorageFailureKind,
} from "$lib/runtime/storage-failure";
import type { VaultState } from "$lib/vault.svelte";

/** An invite's provider, as far as an S3 join reads it. */
export type InviteS3Provider = Pick<NookEnrollmentProvider, "s3Configuration">;

/**
 * Joining through an invite that carries the inviter's S3 connection and
 * key, inside the passphrase-encrypted code as a GitHub token travels. Rust
 * validates that connection again; this stages it as the S3 setup, so the
 * join connects through it and the save that follows keeps it, sealed.
 */
export class InviteS3Connection {
  constructor(private readonly state: VaultState) {}

  stage(
    provider: InviteS3Provider,
  ): Result<NookStorageConnectArgs, VaultStorageFailure> {
    const read = this.configuration(provider);
    if (read.isErr()) return err(read.error);
    const state = this.state;
    state.storageMode = S3_PROVIDER_TYPE;
    state.activateLoginSetup(S3_PROVIDER_TYPE);
    state.configureS3(read.value);
    state.githubPat = "";
    state.clearOauthFile();
    state.clearLocalFolder();
    return ok(draft_s3_storage_args(read.value));
  }

  /** The inviter's connection; one Rust rejects joins nothing. */
  private configuration(
    provider: InviteS3Provider,
  ): Result<S3Connection, VaultStorageFailure> {
    try {
      const block = provider.s3Configuration;
      switch (block.state) {
        case "configured":
          return ok(block.config);
        case "notApplicable":
          return err(
            new VaultStorageFailure(
              VaultStorageFailureKind.S3ConfigurationRequired,
            ),
          );
      }
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure));
    }
  }
}
