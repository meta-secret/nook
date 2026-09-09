import type {
  NookAdoptedExtensionIdentityHandoff,
  NookVaultManager,
} from "$app-wasm";

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
  private constructor(handle: NookAdoptedExtensionIdentityHandoff) {
    this.handle = { kind: BrowserAdoptionHandleKind.Live, handle };
  }
  static async adopt(request: {
    manager: NookVaultManager;
    operation: (
      manager: NookVaultManager,
    ) => Promise<NookAdoptedExtensionIdentityHandoff>;
  }): Promise<AdoptedBrowserIdentity> {
    return new AdoptedBrowserIdentity(await request.operation(request.manager));
  }
  private require(): NookAdoptedExtensionIdentityHandoff {
    if (this.handle.kind !== BrowserAdoptionHandleKind.Live)
      throw new Error("Identity adoption was consumed");
    return this.handle.handle;
  }
  private take(): NookAdoptedExtensionIdentityHandoff {
    const handle = this.require();
    this.handle = { kind: BrowserAdoptionHandleKind.Consumed };
    return handle;
  }
  requiresConnect(manager: NookVaultManager): boolean {
    return this.require().requires_connect(manager);
  }
  markExistingVaultImport(manager: NookVaultManager): void {
    this.require().mark_existing_vault_import(manager);
  }
  async commit(manager: NookVaultManager): Promise<void> {
    const committed = await this.take().commit(manager);
    committed.confirm(manager);
  }
  afterVerifiedConnect(manager: NookVaultManager): void {
    const committed = this.take().after_verified_connect(manager);
    committed.confirm(manager);
  }
  rollback(manager: NookVaultManager): void {
    // A failed consuming Rust transition already performs its existing cleanup.
    if (this.handle.kind === BrowserAdoptionHandleKind.Consumed) return;
    this.take().rollback(manager);
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
