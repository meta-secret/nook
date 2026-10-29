import type { Component } from "svelte";
import { Cloud, Fingerprint, RectangleEllipsis, Vault } from "@lucide/svelte";
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

const extensionConsentScopeIconComponents: Record<
  ExtensionConnectScope,
  Component
> = {
  "vault-access": Vault,
  "password-filling": RectangleEllipsis,
  "passkey-management": Fingerprint,
  "sync-provider-credentials": Cloud,
};
const extensionConsentScopeIcons = new Map(
  Object.entries(extensionConsentScopeIconComponents),
);

/** The icon a requested scope is drawn with, beside its name. */
export class ExtensionConsentScopeIcon {
  constructor(private readonly scope: string) {}

  get component(): Component {
    const icon = extensionConsentScopeIcons.get(this.scope);
    if (!icon) throw new Error("Unsupported extension consent scope.");
    return icon;
  }
}
