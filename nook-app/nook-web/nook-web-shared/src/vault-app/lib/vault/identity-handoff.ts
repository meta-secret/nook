import type {
  NookAdoptedExtensionIdentityHandoff,
  NookVaultManager,
} from "$app-wasm";
import { err, ok, type Result } from "neverthrow";
import {
  NativeVaultStorageFailure,
  VaultStorageFailure,
  VaultStorageFailureKind,
} from "$lib/runtime/storage-failure";

export enum BrowserIdentityHandoffKind {
  Inactive = "inactive",
  Adopted = "adopted",
}
export type BrowserIdentityHandoff =
  | { readonly kind: BrowserIdentityHandoffKind.Inactive }
  | {
      readonly kind: BrowserIdentityHandoffKind.Adopted;
      readonly adoption: AdoptedBrowserIdentity;
    };

/** Owns the Rust capability while browser initialization or vault creation awaits. */
export class AdoptedBrowserIdentity {
  private handle: BrowserAdoptionHandle;
  constructor(handle: NookAdoptedExtensionIdentityHandoff) {
    this.handle = { kind: BrowserAdoptionHandleKind.Live, handle };
  }
  private admit(): Result<
    NookAdoptedExtensionIdentityHandoff,
    VaultStorageFailure
  > {
    return this.handle.kind === BrowserAdoptionHandleKind.Live
      ? ok(this.handle.handle)
      : err(
          new VaultStorageFailure(
            VaultStorageFailureKind.IdentityHandoffConsumed,
          ),
        );
  }
  private take(): Result<
    NookAdoptedExtensionIdentityHandoff,
    VaultStorageFailure
  > {
    const handle = this.admit();
    if (handle.isErr()) return err(handle.error);
    this.handle = { kind: BrowserAdoptionHandleKind.Consumed };
    return handle;
  }
  requiresConnect(
    manager: NookVaultManager,
  ): Result<boolean, VaultStorageFailure> {
    const handle = this.admit();
    if (handle.isErr()) return err(handle.error);
    try {
      return ok(handle.value.requires_connect(manager));
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure));
    }
  }
  markExistingVaultImport(
    manager: NookVaultManager,
  ): Result<void, VaultStorageFailure> {
    const handle = this.admit();
    if (handle.isErr()) return err(handle.error);
    try {
      handle.value.mark_existing_vault_import(manager);
      return ok();
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure));
    }
  }
  async commit(
    manager: NookVaultManager,
  ): Promise<Result<void, VaultStorageFailure>> {
    const handle = this.take();
    if (handle.isErr()) return err(handle.error);
    try {
      const committed = await handle.value.commit(manager);
      committed.confirm(manager);
      return ok();
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure));
    }
  }
  afterVerifiedConnect(
    manager: NookVaultManager,
  ): Result<void, VaultStorageFailure> {
    const handle = this.take();
    if (handle.isErr()) return err(handle.error);
    try {
      const committed = handle.value.after_verified_connect(manager);
      committed.confirm(manager);
      return ok();
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure));
    }
  }
  discard(): Result<void, VaultStorageFailure> {
    if (this.handle.kind === BrowserAdoptionHandleKind.Consumed) return ok();
    const handle = this.take();
    if (handle.isErr()) return err(handle.error);
    try {
      handle.value.free();
      return ok();
    } catch {
      return err(
        new VaultStorageFailure(
          VaultStorageFailureKind.IdentityHandoffCleanupFailed,
        ),
      );
    }
  }
  rollback(manager: NookVaultManager): Result<void, VaultStorageFailure> {
    // A failed consuming Rust transition already performs its existing cleanup.
    if (this.handle.kind === BrowserAdoptionHandleKind.Consumed) return ok();
    const handle = this.take();
    if (handle.isErr()) return err(handle.error);
    try {
      handle.value.rollback(manager);
      return ok();
    } catch {
      return err(
        new VaultStorageFailure(
          VaultStorageFailureKind.IdentityHandoffCleanupFailed,
        ),
      );
    }
  }
}
enum BrowserAdoptionHandleKind {
  Live = "live",
  Consumed = "consumed",
}
type BrowserAdoptionHandle =
  | {
      kind: BrowserAdoptionHandleKind.Live;
      handle: NookAdoptedExtensionIdentityHandoff;
    }
  | { kind: BrowserAdoptionHandleKind.Consumed };
