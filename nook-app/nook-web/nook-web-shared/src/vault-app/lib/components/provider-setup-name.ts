import { I18N_KEYS, type I18nKey } from "../../../generated/i18n-keys";
import {
  GITHUB_PROVIDER_TYPE,
  ICLOUD_OAUTH_FILE_PRESET,
  LOCAL_FOLDER_PROVIDER_TYPE,
  OAUTH_FILE_PROVIDER_TYPE,
  type OAuthFilePreset,
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
    const { vault, setup, oauthPreset, localWords } = this.request;
    if (setup.kind !== LoginSetupKind.Active) return vault.t(localWords);
    if (setup.providerType === GITHUB_PROVIDER_TYPE)
      return vault.t(I18N_KEYS.AuthStorageGithub);
    if (setup.providerType === OAUTH_FILE_PROVIDER_TYPE)
      return vault.t(
        oauthPreset === ICLOUD_OAUTH_FILE_PRESET
          ? I18N_KEYS.ProviderPickerIcloud
          : I18N_KEYS.ProviderPickerGoogleDrive,
      );
    if (setup.providerType === LOCAL_FOLDER_PROVIDER_TYPE)
      return vault.t(I18N_KEYS.ProviderPickerLocalFolder);
    return vault.t(localWords);
  }
}
