import { describe, expect, test } from 'vitest'
import {
  I18N_KEYS,
  type I18nKey,
} from '../../../../nook-web-shared/src/generated/i18n-keys'
import type { ExtensionConnectScope } from '../../../../nook-web-shared/src/extension/extension-connect-scope'
import { ExtensionConsentScopeTranslation } from '../../../../nook-web-shared/src/vault-app/lib/components/extension-connect-consent-state'
import {
  ExtensionConsentIdentityText,
  type ExtensionConsentIdentityTextLayout,
} from '../../../../nook-web-shared/src/vault-app/lib/components/extension-consent-identity-text'

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

describe('extension consent identity text', () => {
  const layout: ExtensionConsentIdentityTextLayout = { head: 14, tail: 10 }

  test('keeps identity text whole when it fits the visible layout', () => {
    const identityText = new ExtensionConsentIdentityText('short-key')

    expect(identityText.truncate(layout)).toBe('short-key')
  })

  test('elides the middle while preserving the configured visible ends', () => {
    const identityText = new ExtensionConsentIdentityText(
      '0123456789abcdefghijklmnopqrstuv',
    )

    expect(identityText.truncate(layout)).toBe('0123456789abcd...mnopqrstuv')
  })

  test('keeps the complete value at the exact layout boundary', () => {
    const identityText = new ExtensionConsentIdentityText(
      '123456789012345678901234567',
    )

    expect(identityText.truncate(layout)).toBe('123456789012345678901234567')
  })
})
