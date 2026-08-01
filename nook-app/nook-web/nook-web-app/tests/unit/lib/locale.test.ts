import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { beforeAll, describe, expect, test } from 'vitest'
import initNookWasm, {
  NookAppLocaleParse,
  NookBrowserLocale,
  get_translation_catalog as getTranslationCatalog,
  lookupTranslation,
  mergeTranslationCatalogs,
  parseAppLocale,
  resolveAppLocaleFromTag,
  resolveAppLocaleFromTags,
  supportedAppLocaleCode,
  translateFromCatalog,
} from '$app-wasm'
import { HELP_SECTIONS } from '$lib/content/help'

beforeAll(async () => {
  await initNookWasm()
})

describe('locale', () => {
  test('English and Russian catalogs expose the same translation keys', () => {
    const flatten = (value: unknown, prefix = ''): Record<string, string> => {
      if (typeof value === 'string') return { [prefix]: value }
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`Expected a translation object at ${prefix}`)
      }
      return Object.entries(value).reduce<Record<string, string>>(
        (keys, [key, child]) => ({
          ...keys,
          ...flatten(child, prefix ? `${prefix}.${key}` : key),
        }),
        {},
      )
    }

    const english = flatten(JSON.parse(getTranslationCatalog('en')))
    const russian = flatten(JSON.parse(getTranslationCatalog('ru')))

    expect(Object.keys(russian).sort()).toEqual(Object.keys(english).sort())
    for (const key of Object.keys(english)) {
      expect(russian[key], `ru:${key}`).toBeTypeOf('string')
      expect(russian[key], `ru:${key}`).not.toBe('')
    }
  })

  test('parseAppLocale accepts only supported values', () => {
    expect(supportedAppLocaleCode(parseAppLocale('en'))).toBe('en')
    expect(supportedAppLocaleCode(parseAppLocale('ru'))).toBe('ru')
    expect(parseAppLocale('de')).toBe(NookAppLocaleParse.Unsupported)
  })

  test('resolveAppLocaleFromTag maps BCP 47 tags', () => {
    expect(supportedAppLocaleCode(resolveAppLocaleFromTag('ru-RU'))).toBe('ru')
    expect(supportedAppLocaleCode(resolveAppLocaleFromTag('ru_BY'))).toBe('ru')
    expect(supportedAppLocaleCode(resolveAppLocaleFromTag('en-GB'))).toBe('en')
    expect(resolveAppLocaleFromTag('de-DE')).toBe(
      NookAppLocaleParse.Unsupported,
    )
  })

  test('resolveAppLocaleFromTags respects preference order', () => {
    expect(resolveAppLocaleFromTags(['de-DE', 'ru-RU'])).toBe('ru')
    expect(resolveAppLocaleFromTags(['de-DE', 'fr-FR'])).toBe('en')
    expect(resolveAppLocaleFromTags(['en-US', 'ru-RU'])).toBe('en')
  })

  test('NookBrowserLocale resolves captured browser tags', () => {
    expect(NookBrowserLocale.fromTags(['de-DE', 'ru-RU']).appLocale()).toBe(
      'ru',
    )
  })

  test('catalogs include provider picker strings', () => {
    for (const locale of ['en', 'ru'] as const) {
      const catalog = getTranslationCatalog(locale)
      expect(
        lookupTranslation(catalog, I18N_KEYS.ProviderPickerGoogleDrive),
      ).toBe('Google Drive')
      expect(
        lookupTranslation(catalog, I18N_KEYS.ProviderPickerGoogleDriveDesc),
      ).toBeTypeOf('string')
      expect(
        lookupTranslation(
          catalog,
          I18N_KEYS.ProviderPickerUnsupportedReplicationDesc,
        ),
      ).toBeTypeOf('string')
    }
  })

  test('catalogs include vault feedback and accessibility strings', () => {
    const keys = [
      I18N_KEYS.CommonDismissSuccess,
      I18N_KEYS.CommonDismissError,
      I18N_KEYS.ErrorsValidationOauthAccessTokenEmpty,
      I18N_KEYS.ErrorsGoogleSignInRequired,
      I18N_KEYS.ErrorsEngineLoading,
      I18N_KEYS.ErrorsEngineUnavailable,
      I18N_KEYS.ErrorsManagerUninitialized,
      I18N_KEYS.ErrorsLocalBackupFolderRequired,
      I18N_KEYS.ErrorsConnectionInProgress,
      I18N_KEYS.ErrorsVaultPasswordRequired,
      I18N_KEYS.ErrorsCloudSyncProviderRequired,
      I18N_KEYS.ErrorsGithubCredentialsRequired,
      I18N_KEYS.ErrorsVaultSelectionFailed,
      I18N_KEYS.ErrorsVaultCreationFailed,
      I18N_KEYS.ErrorsVaultRenameFailed,
      I18N_KEYS.ErrorsConflictResolutionFailed,
      I18N_KEYS.ErrorsWholeVaultConflictResolutionRetired,
      I18N_KEYS.ToastsGoogleDriveConnected,
      I18N_KEYS.ToastsSecretConflictResolved,
      I18N_KEYS.AppSecretSyncConflicts,
      I18N_KEYS.AppSecurityConflict,
      I18N_KEYS.AppConflictOriginal,
      I18N_KEYS.AppConflictKeep,
      I18N_KEYS.HelpDiagramLabel,
      I18N_KEYS.LegalManagerDescription,
      I18N_KEYS.LegalDocumentsLabel,
      I18N_KEYS.LegalSource,
      I18N_KEYS.VaultCopyWebsiteUrl,
      I18N_KEYS.VaultCopyUsername,
      I18N_KEYS.VaultCopySecret,
      I18N_KEYS.VaultCopyExpirationDate,
      I18N_KEYS.VaultCopyAccountName,
      I18N_KEYS.VaultCopyNote,
    ]

    for (const locale of ['en', 'ru'] as const) {
      const catalog = getTranslationCatalog(locale)
      for (const key of keys) {
        expect(lookupTranslation(catalog, key), `${locale}:${key}`).toBeTypeOf(
          'string',
        )
      }
    }
  })

  test('catalogs include architecture mode strings', () => {
    const modeKeys = [
      I18N_KEYS.DeviceProtectionModeGroupLabel,
      I18N_KEYS.DeviceProtectionModeStandardTitle,
      I18N_KEYS.DeviceProtectionModeStandardDescription,
      I18N_KEYS.DeviceProtectionModeAntiHackerTitle,
      I18N_KEYS.DeviceProtectionModeAntiHackerDescription,
      I18N_KEYS.ArchitectureModesVaultTypeTitle,
      I18N_KEYS.ArchitectureModesVaultTypeSimpleTitle,
      I18N_KEYS.ArchitectureModesVaultTypeSimpleDescription,
      I18N_KEYS.ArchitectureModesVaultTypeSentinelTitle,
      I18N_KEYS.ArchitectureModesVaultTypeSentinelDescription,
      I18N_KEYS.ArchitectureModesReplicationTypeTitle,
      I18N_KEYS.ArchitectureModesReplicationTypePersonalTitle,
      I18N_KEYS.ArchitectureModesReplicationTypePersonalDescription,
      I18N_KEYS.ArchitectureModesReplicationTypeSharedTitle,
      I18N_KEYS.ArchitectureModesReplicationTypeSharedDescription,
      I18N_KEYS.ArchitectureModesOnboardingTypeTitle,
      I18N_KEYS.ArchitectureModesOnboardingTypePersonalCredentialTransferTitle,
      I18N_KEYS.ArchitectureModesOnboardingTypePersonalCredentialTransferDescription,
      I18N_KEYS.ArchitectureModesOnboardingTypeSharedProviderGrantTitle,
      I18N_KEYS.ArchitectureModesOnboardingTypeSharedProviderGrantDescription,
      I18N_KEYS.ArchitectureModesProviderCapabilityTitle,
      I18N_KEYS.ArchitectureModesProviderCapabilityDescription,
      I18N_KEYS.ArchitectureModesSharedGrantManualInstructions,
      I18N_KEYS.ArchitectureModesSharedGrantSuccess,
      I18N_KEYS.ArchitectureModesSharedGrantUnsupported,
      I18N_KEYS.ArchitectureModesSentinelGateTitle,
      I18N_KEYS.ArchitectureModesSentinelGateDescription,
      I18N_KEYS.ArchitectureModesSentinelSecretCreationBlocked,
      I18N_KEYS.ArchitectureModesSentinelCeremonyTitle,
      I18N_KEYS.ArchitectureModesSentinelCeremonyInstructions,
      I18N_KEYS.ArchitectureModesSentinelCeremonyAwaitingShares,
      I18N_KEYS.ArchitectureModesSentinelCeremonyOpenLocal,
      I18N_KEYS.ArchitectureModesSentinelCeremonyCopyShare,
      I18N_KEYS.ArchitectureModesSentinelCeremonyPastePeer,
      I18N_KEYS.ArchitectureModesSentinelCeremonyUnlock,
      I18N_KEYS.ArchitectureModesSentinelPasswordForbidden,
      I18N_KEYS.ErrorsValidationSharedJoinerIdentityRequired,
      I18N_KEYS.ErrorsValidationSharedJoinerIdentityInvalid,
      I18N_KEYS.ErrorsValidationSharedStorageTargetRequired,
      I18N_KEYS.OnboardDeviceSharedIdentityLabel,
      I18N_KEYS.OnboardDeviceSharedIdentityPlaceholder,
      I18N_KEYS.OnboardDeviceSharedIdentityHint,
      I18N_KEYS.OnboardDeviceSharedIdentityRequired,
      I18N_KEYS.OnboardDeviceNoCompatibleSyncProviders,
      I18N_KEYS.ProviderPickerUnsupportedCurrentVault,
      I18N_KEYS.ProviderPickerCapabilityPersonalOnly,
      I18N_KEYS.ProviderPickerCapabilityPersonalShared,
    ]

    for (const locale of ['en', 'ru'] as const) {
      const catalog = getTranslationCatalog(locale)
      for (const key of modeKeys) {
        expect(lookupTranslation(catalog, key), `${locale}:${key}`).toBeTypeOf(
          'string',
        )
      }
    }
  })

  test('catalogs include complete help page strings', () => {
    const commonHelpKeys = [
      I18N_KEYS.HelpTitle,
      I18N_KEYS.HelpSubtitle,
      I18N_KEYS.HelpInThisGuide,
      I18N_KEYS.HelpJumpToSection,
      I18N_KEYS.HelpDiagramDevice,
      I18N_KEYS.HelpDiagramLocalProjection,
      I18N_KEYS.HelpDiagramEventStore,
      I18N_KEYS.HelpDiagramDeviceKeys,
      I18N_KEYS.HelpDiagramSync,
      I18N_KEYS.HelpDiagramNookLog,
      I18N_KEYS.HelpDiagramProviderEvents,
      I18N_KEYS.HelpDiagramSetUnion,
      I18N_KEYS.LegalPrivacyPolicy,
      I18N_KEYS.LegalTermsOfService,
    ]

    for (const locale of ['en', 'ru'] as const) {
      const catalog = getTranslationCatalog(locale)
      for (const key of commonHelpKeys) {
        expect(lookupTranslation(catalog, key), `${locale}:${key}`).toBeTypeOf(
          'string',
        )
      }
      for (const section of HELP_SECTIONS) {
        expect(
          lookupTranslation(catalog, section.titleKey),
          `${locale}:${section.titleKey}`,
        ).toBeTypeOf('string')
        expect(
          lookupTranslation(catalog, section.summaryKey),
          `${locale}:${section.summaryKey}`,
        ).toBeTypeOf('string')
        for (const bulletKey of section.bulletKeys) {
          expect(
            lookupTranslation(catalog, bulletKey),
            `${locale}:${bulletKey}`,
          ).toBeTypeOf('string')
        }
      }
    }
  })

  test('catalog merge overlays bundled keys onto stale wasm catalogs', () => {
    const staleWasm = JSON.stringify({
      provider_picker: {
        this_device: 'Это устройство',
        github: 'GitHub',
      },
    })
    const merged = mergeTranslationCatalogs(
      staleWasm,
      getTranslationCatalog('ru'),
    )
    expect(lookupTranslation(merged, I18N_KEYS.ProviderPickerGoogleDrive)).toBe(
      'Google Drive',
    )
    expect(lookupTranslation(merged, I18N_KEYS.ProviderPickerThisDevice)).toBe(
      'Это устройство',
    )
  })

  test('translateFromCatalog falls back to English', () => {
    const staleRu = JSON.stringify({
      provider_picker: {
        github: 'GitHub',
      },
    })
    expect(
      translateFromCatalog(staleRu, 'ru', I18N_KEYS.ProviderPickerGoogleDrive),
    ).toBe('Google Drive')
    expect(
      translateFromCatalog(staleRu, 'en', I18N_KEYS.ProviderPickerGoogleDrive),
    ).toBe(I18N_KEYS.ProviderPickerGoogleDrive)
  })
})
