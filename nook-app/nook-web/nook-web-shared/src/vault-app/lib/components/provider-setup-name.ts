import type { I18nKey } from "../../../generated/i18n-keys";
import { provider_setup_name_key } from "$app-wasm";
import type { VaultState } from "$lib/vault.svelte";
import {
  LoginSetupKind,
  type LoginSetup,
} from "$lib/vault/state/provider.svelte";

/** The provider a setup heading names, and the host's words for this browser. */
export type ProviderSetupNameRequest = {
  readonly vault: VaultState;
  readonly setup: LoginSetup;
  /** What the host calls keeping the vault in this browser only. */
  readonly localWords: I18nKey;
};

/** The name the hosts of the setup wizards give the provider being set up;
 * Rust picks the key for the setup's provider kind. */
export class ProviderSetupName {
  constructor(private readonly request: ProviderSetupNameRequest) {}

  text(): string {
    const { vault, setup, localWords } = this.request;
    switch (setup.kind) {
      case LoginSetupKind.Inactive:
        return vault.t(localWords);
      case LoginSetupKind.Active: {
        const nameRequest: Parameters<typeof provider_setup_name_key>[0] = {
          kind: setup.providerKind,
          thisBrowserKey: localWords,
        };
        return vault.t(provider_setup_name_key(nameRequest));
      }
    }
  }
}
