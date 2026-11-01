import { I18N_KEYS, type I18nKey } from "../../../generated/i18n-keys";
import {
  GITHUB_PROVIDER_TYPE,
  GOOGLE_DRIVE_OAUTH_FILE_PRESET,
  ICLOUD_OAUTH_FILE_PRESET,
  LOCAL_FOLDER_PROVIDER_TYPE,
  LOCAL_PROVIDER_TYPE,
  OAUTH_FILE_PROVIDER_TYPE,
  S3_PROVIDER_TYPE,
  type OAuthFilePreset,
  type StorageProviderType,
} from "$lib/auth/providers";
import type { VaultState } from "$lib/vault.svelte";
import {
  LoginSetupKind,
  type LoginSetup,
} from "$lib/vault/state/provider.svelte";

/** The provider a setup heading names, and the host's words for this browser. */
export type ProviderSetupNameRequest = {
  readonly vault: VaultState;
  readonly setup: LoginSetup;
  readonly oauthPreset: OAuthFilePreset;
  /** What the host calls keeping the vault in this browser only. */
  readonly localWords: I18nKey;
};

/** The name the hosts of the setup wizards give the provider being set up. */
export class ProviderSetupName {
  constructor(private readonly request: ProviderSetupNameRequest) {}

  text(): string {
    const { vault, setup, localWords } = this.request;
    switch (setup.kind) {
      case LoginSetupKind.Inactive:
        return vault.t(localWords);
      case LoginSetupKind.Active:
        return vault.t(this.providerKey(setup.providerType));
    }
  }

  private providerKey(type: StorageProviderType): I18nKey {
    switch (type) {
      case GITHUB_PROVIDER_TYPE:
        return I18N_KEYS.AuthStorageGithub;
      case OAUTH_FILE_PROVIDER_TYPE:
        return this.oauthPresetKey();
      case LOCAL_FOLDER_PROVIDER_TYPE:
        return I18N_KEYS.ProviderPickerLocalFolder;
      case S3_PROVIDER_TYPE:
        return I18N_KEYS.ProviderPickerS3;
      case LOCAL_PROVIDER_TYPE:
        return this.request.localWords;
    }
  }

  private oauthPresetKey(): I18nKey {
    switch (this.request.oauthPreset) {
      case ICLOUD_OAUTH_FILE_PRESET:
        return I18N_KEYS.ProviderPickerIcloud;
      case GOOGLE_DRIVE_OAUTH_FILE_PRESET:
        return I18N_KEYS.ProviderPickerGoogleDrive;
    }
  }
}
