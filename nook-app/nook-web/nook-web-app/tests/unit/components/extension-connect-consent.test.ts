import { describe, expect, test } from 'vitest'
import {
  I18N_KEYS,
  type I18nKey,
} from '../../../../nook-web-shared/src/generated/i18n-keys'
import type { ExtensionConnectScope } from '../../../../nook-web-shared/src/extension/extension-connect-scope'
import { ExtensionConsentScopeTranslation } from '../../../../nook-web-shared/src/vault-app/lib/components/extension-connect-consent-state'

const canonicalTranslations: Record<ExtensionConnectScope, I18nKey> = {
  'vault-access': I18N_KEYS.ExtensionConsentScopeVaultAccess,
  'password-filling': I18N_KEYS.ExtensionConsentScopePasswordFilling,
  'passkey-management': I18N_KEYS.ExtensionConsentScopePasskeyManagement,
  'sync-provider-credentials':
    I18N_KEYS.ExtensionConsentScopeSyncProviderCredentials,
}

describe('extension consent scope translation', () => {
  test('translates every canonical scope', () => {
    for (const [scope, expectedKey] of Object.entries(canonicalTranslations)) {
      expect(new ExtensionConsentScopeTranslation(scope).key).toBe(expectedKey)
    }
  })

  test('fails closed for an unrecognized future scope', () => {
    expect(
      () => new ExtensionConsentScopeTranslation('future-scope').key,
    ).toThrow('Unsupported extension consent scope.')
  })
})
