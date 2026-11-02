import { provider_wasm_args, type NookStorageConnection } from "$app-wasm";
import { err, ok, type Result } from "neverthrow";
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from "$lib/runtime/storage-failure";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import {
  default as initNookWasm,
  default_github_repo,
  localize_provider_label,
  provider_storage_detail,
  type AuthProvidersSnapshot,
  type ActiveVaultScope,
  type StorageProvider,
  type ProviderVaultScope,
  type NookVaultManager,
} from "$app-wasm";

await initNookWasm();

export type {
  AuthProvidersSnapshot,
  ActiveVaultScope,
  GoogleDriveProvider,
  OAuthAccountIdentity,
  OAuthFilePreset,
  OAuthFileProvider,
  ProviderDraft,
  ProviderKind,
  ProviderVaultScope,
  StorageProvider,
  StoredProvider,
} from "$app-wasm";

export const DEFAULT_GITHUB_REPO = default_github_repo();

export function unselectedVaultScope(): ActiveVaultScope {
  return { state: "unselected" };
}

export function activeVaultScope(storeId: string): ActiveVaultScope {
  return { state: "storeId", value: storeId };
}

export function unscopedProviderVault(): ProviderVaultScope {
  return { state: "unscoped" };
}

export function scopedProviderVault(storeId: string): ProviderVaultScope {
  return { state: "storeId", value: storeId };
}

export type AuthProviderPersistenceRequest = {
  readonly manager: NookVaultManager;
  readonly snapshot: AuthProvidersSnapshot;
};

export type ProviderLabelLocalization = {
  readonly label: string;
  readonly t: (key: string) => string;
};

export type LocalizedProviderStorageDescriptionRequest = {
  readonly provider: StorageProvider;
  readonly t: (key: string) => string;
};

export class AuthProviderPersistence {
  constructor(private readonly request: AuthProviderPersistenceRequest) {}

  async save(): Promise<Result<AuthProvidersSnapshot, VaultStorageFailure>> {
    const { manager, snapshot } = this.request;
    try {
      await manager.save_auth_providers_snapshot(snapshot);
      return ok(snapshot);
    } catch {
      return err(
        new VaultStorageFailure(VaultStorageFailureKind.OperationFailed),
      );
    }
  }
}

export function localizeProviderLabel({
  label,
  t,
}: ProviderLabelLocalization): string {
  return localize_provider_label(
    label,
    t(I18N_KEYS.ProviderPickerThisDevice),
    t(I18N_KEYS.ProviderPickerGithub),
    t(I18N_KEYS.ProviderPickerLocalFolder),
    t(I18N_KEYS.ProviderPickerGoogleDrive),
    t(I18N_KEYS.ProviderPickerIcloud),
  );
}

/** Secondary line for provider rows in management / picker UIs. */
export function localizedProviderStorageDetail({
  provider,
  t,
}: LocalizedProviderStorageDescriptionRequest): string {
  return provider_storage_detail(
    provider,
    t(I18N_KEYS.ProviderPickerThisDeviceDesc),
    t(I18N_KEYS.AuthStorageGoogleSignedIn),
    t(I18N_KEYS.AuthStorageIcloudSignedIn),
    t(I18N_KEYS.AuthStorageLocalFolderNeedsReconnect),
  );
}

export class StorageProviderPresentation {
  constructor(private readonly value: StorageProvider) {}
  storageArgs(): NookStorageConnection {
    return provider_wasm_args(this.value);
  }
}
