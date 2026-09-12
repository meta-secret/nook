import { I18N_KEYS, type I18nKey } from "../../../generated/i18n-keys";
import type { ExtensionConnectScope } from "../../../extension/extension-connect-scope";

const extensionConsentScopeTranslationKeys: Record<
  ExtensionConnectScope,
  I18nKey
> = {
  "vault-access": I18N_KEYS.ExtensionConsentScopeVaultAccess,
  "password-filling": I18N_KEYS.ExtensionConsentScopePasswordFilling,
  "passkey-management": I18N_KEYS.ExtensionConsentScopePasskeyManagement,
  "sync-provider-credentials":
    I18N_KEYS.ExtensionConsentScopeSyncProviderCredentials,
};
const extensionConsentScopeTranslations = new Map(
  Object.entries(extensionConsentScopeTranslationKeys),
);

export class ExtensionConsentScopeTranslation {
  constructor(private readonly scope: string) {}

  get key(): I18nKey {
    const key = extensionConsentScopeTranslations.get(this.scope);
    if (!key) throw new Error("Unsupported extension consent scope.");
    return key;
  }
}
