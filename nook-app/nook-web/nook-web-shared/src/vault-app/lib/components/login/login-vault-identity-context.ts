import { err, ok, type Result } from "neverthrow";
import {
  NativeVaultStorageFailure,
  type VaultStorageFailure,
} from "$lib/runtime/storage-failure";
import {
  NookSelectedVaultIdentityContextKind,
  type NookIdentitySnapshot,
  type NookVaultManager,
} from "$app-wasm";

export enum LoginVaultIdentityContextKind {
  Loading = "loading",
  Failed = "failed",
}

export type LoginVaultLinkedIdentity = {
  readonly identityId: string;
  readonly label: string;
};

type LoadLoginVaultIdentityContextArgs = {
  readonly manager: NookVaultManager;
  readonly storeId: string;
};

export type LoginVaultIdentityContext =
  | { readonly kind: LoginVaultIdentityContextKind.Loading }
  | { readonly kind: LoginVaultIdentityContextKind.Failed }
  | { readonly kind: NookSelectedVaultIdentityContextKind.Empty }
  | {
      readonly kind: NookSelectedVaultIdentityContextKind.LinkedWithoutCurrent;
      readonly identities: readonly LoginVaultLinkedIdentity[];
    }
  | {
      readonly kind: NookSelectedVaultIdentityContextKind.LinkedWithCurrent;
      readonly identities: readonly LoginVaultLinkedIdentity[];
      readonly currentIdentity: LoginVaultLinkedIdentity;
    };

export class LoginVaultIdentityReader {
  constructor(private readonly request: LoadLoginVaultIdentityContextArgs) {}
  async execute(): Promise<
    Result<LoginVaultIdentityContext, VaultStorageFailure>
  > {
    const { manager, storeId } = this.request;
    let request: ReturnType<
      NookVaultManager["selected_vault_identity_context_request"]
    >;
    try {
      request = manager.selected_vault_identity_context_request(storeId);
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure));
    }
    let snapshot: Awaited<ReturnType<typeof request.resolve>>;
    try {
      snapshot = await request.resolve();
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure));
    } finally {
      request.free();
    }
    try {
      const kind = snapshot.selectedVaultContextKind;
      if (kind === NookSelectedVaultIdentityContextKind.Empty)
        return ok({ kind });
      const identities: LoginVaultLinkedIdentity[] = [];
      for (let index = 0; index < snapshot.length; index += 1) {
        const identity = new LinkedLoginIdentity(
          snapshot.identity(index),
        ).read();
        if (identity.isErr()) return err(identity.error);
        identities.push(identity.value);
      }
      if (kind === NookSelectedVaultIdentityContextKind.LinkedWithoutCurrent)
        return ok({ kind, identities });
      const current = new LinkedLoginIdentity(
        snapshot.current_browser_identity(),
      ).read();
      if (current.isErr()) return err(current.error);
      return ok({ kind, identities, currentIdentity: current.value });
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure));
    } finally {
      snapshot.free();
    }
  }
}

/** Owns one native identity snapshot until its public login projection is read. */
class LinkedLoginIdentity {
  constructor(private readonly identity: NookIdentitySnapshot) {}
  read(): Result<LoginVaultLinkedIdentity, VaultStorageFailure> {
    try {
      return ok({
        identityId: this.identity.identityId,
        label: this.identity.label,
      });
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure));
    } finally {
      this.identity.free();
    }
  }
}
