import type {
  IdentityMountView,
  ProviderRowLayout,
  StorageProvider,
} from "$app-wasm";

/** Typed questions about an identity mount row shown on the Sync page. */
export class IdentityMountPresentation {
  constructor(private readonly mount: IdentityMountView) {}

  isICloud(): boolean {
    const icloud: IdentityMountView["provider"] = "icloud";
    return this.mount.provider === icloud;
  }

  /** The single vault a legacy-root mount replicates, or false. */
  legacyVaultId(): string | false {
    const layout = this.mount.layout;
    return "storeId" in layout ? layout.storeId : false;
  }
}

/** Whether a saved provider row is mounted at the identity namespace. */
export class ProviderRowLayoutPresentation {
  constructor(private readonly provider: StorageProvider) {}

  isIdentityMount(): boolean {
    const namespaced: ProviderRowLayout = "identityNamespaced";
    return this.provider.layout === namespaced;
  }
}
