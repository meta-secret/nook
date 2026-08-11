import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { beforeAll, describe, expect, test } from 'vitest'
import initNookWasm, {
  NookAppLocaleParse,
  NookBrowserLocale,
  get_translation_catalog,
  lookup_translation,
  merge_translation_catalogs,
  parse_app_locale,
  resolve_app_locale_from_tag,
  resolve_app_locale_from_tags,
  supported_app_locale_code,
  translate_from_catalog,
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

    const english = flatten(JSON.parse(get_translation_catalog('en')))
    const russian = flatten(JSON.parse(get_translation_catalog('ru')))

    expect(Object.keys(russian).sort()).toEqual(Object.keys(english).sort())
    for (const key of Object.keys(english)) {
      expect(russian[key], `ru:${key}`).toBeTypeOf('string')
      expect(russian[key], `ru:${key}`).not.toBe('')
    }
  })

  test('parse_app_locale accepts only supported values', () => {
    expect(supported_app_locale_code(parse_app_locale('en'))).toBe('en')
    expect(supported_app_locale_code(parse_app_locale('ru'))).toBe('ru')
    expect(parse_app_locale('de')).toBe(NookAppLocaleParse.Unsupported)
  })

  test('resolve_app_locale_from_tag maps BCP 47 tags', () => {
    expect(
      supported_app_locale_code(resolve_app_locale_from_tag('ru-RU')),
    ).toBe('ru')
    expect(
      supported_app_locale_code(resolve_app_locale_from_tag('ru_BY')),
    ).toBe('ru')
    expect(
      supported_app_locale_code(resolve_app_locale_from_tag('en-GB')),
    ).toBe('en')
    expect(resolve_app_locale_from_tag('de-DE')).toBe(
      NookAppLocaleParse.Unsupported,
    )
  })

  test('resolve_app_locale_from_tags respects preference order', () => {
    expect(resolve_app_locale_from_tags(['de-DE', 'ru-RU'])).toBe('ru')
    expect(resolve_app_locale_from_tags(['de-DE', 'fr-FR'])).toBe('en')
    expect(resolve_app_locale_from_tags(['en-US', 'ru-RU'])).toBe('en')
  })

  test('NookBrowserLocale resolves captured browser tags', () => {
    expect(NookBrowserLocale.from_tags(['de-DE', 'ru-RU']).app_locale()).toBe(
      'ru',
    )
  })

  test('catalogs include provider picker strings', () => {
    for (const locale of ['en', 'ru'] as const) {
      const catalog = get_translation_catalog(locale)
      expect(
        lookup_translation(catalog, I18N_KEYS.ProviderPickerGoogleDrive),
      ).toBe('Google Drive')
      expect(
        lookup_translation(catalog, I18N_KEYS.ProviderPickerGoogleDriveDesc),
      ).toBeTypeOf('string')
      expect(
        lookup_translation(
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
      const catalog = get_translation_catalog(locale)
      for (const key of keys) {
        expect(lookup_translation(catalog, key), `${locale}:${key}`).toBeTypeOf(
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
      const catalog = get_translation_catalog(locale)
      for (const key of modeKeys) {
        expect(lookup_translation(catalog, key), `${locale}:${key}`).toBeTypeOf(
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
      const catalog = get_translation_catalog(locale)
      for (const key of commonHelpKeys) {
        expect(lookup_translation(catalog, key), `${locale}:${key}`).toBeTypeOf(
          'string',
        )
      }
      for (const section of HELP_SECTIONS) {
        expect(
          lookup_translation(catalog, section.titleKey),
          `${locale}:${section.titleKey}`,
        ).toBeTypeOf('string')
        expect(
          lookup_translation(catalog, section.summaryKey),
          `${locale}:${section.summaryKey}`,
        ).toBeTypeOf('string')
        for (const bulletKey of section.bulletKeys) {
          expect(
            lookup_translation(catalog, bulletKey),
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
    const merged = merge_translation_catalogs(
      staleWasm,
      get_translation_catalog('ru'),
    )
    expect(
      lookup_translation(merged, I18N_KEYS.ProviderPickerGoogleDrive),
    ).toBe('Google Drive')
    expect(lookup_translation(merged, I18N_KEYS.ProviderPickerThisDevice)).toBe(
      'Это устройство',
    )
  })

  test('translate_from_catalog falls back to English', () => {
    const staleRu = JSON.stringify({
      provider_picker: {
        github: 'GitHub',
      },
    })
    expect(
      translate_from_catalog(
        staleRu,
        'ru',
        I18N_KEYS.ProviderPickerGoogleDrive,
      ),
    ).toBe('Google Drive')
    expect(
      translate_from_catalog(
        staleRu,
        'en',
        I18N_KEYS.ProviderPickerGoogleDrive,
      ),
    ).toBe(I18N_KEYS.ProviderPickerGoogleDrive)
  })
})
