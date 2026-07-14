import { beforeAll, describe, expect, test } from 'vitest'
import initNookWasm, {
  NookBrowserLocale,
  get_translation_catalog as getTranslationCatalog,
  lookupTranslation,
  mergeTranslationCatalogs,
  parseAppLocale,
  resolveAppLocaleFromTag,
  resolveAppLocaleFromTags,
  translateFromCatalog,
} from '$lib/nook-wasm/nook_wasm'
import { HELP_SECTIONS } from '$lib/help-content'

beforeAll(async () => {
  await initNookWasm()
})

describe('locale', () => {
  test('parseAppLocale accepts only supported values', () => {
    expect(parseAppLocale('en')).toBe('en')
    expect(parseAppLocale('ru')).toBe('ru')
    expect(parseAppLocale('de')).toBeUndefined()
    expect(parseAppLocale(undefined)).toBeUndefined()
  })

  test('resolveAppLocaleFromTag maps BCP 47 tags', () => {
    expect(resolveAppLocaleFromTag('ru-RU')).toBe('ru')
    expect(resolveAppLocaleFromTag('ru_BY')).toBe('ru')
    expect(resolveAppLocaleFromTag('en-GB')).toBe('en')
    expect(resolveAppLocaleFromTag('de-DE')).toBeUndefined()
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
      expect(lookupTranslation(catalog, 'provider_picker.google_drive')).toBe(
        'Google Drive',
      )
      expect(
        lookupTranslation(catalog, 'provider_picker.google_drive_desc'),
      ).toBeTypeOf('string')
      expect(
        lookupTranslation(
          catalog,
          'provider_picker.unsupported_replication_desc',
        ),
      ).toBeTypeOf('string')
    }
  })

  test('catalogs include architecture mode strings', () => {
    const modeKeys = [
      'device_protection.mode_group_label',
      'device_protection.mode_standard_title',
      'device_protection.mode_standard_description',
      'device_protection.mode_anti_hacker_title',
      'device_protection.mode_anti_hacker_description',
      'architecture_modes.vault_type_title',
      'architecture_modes.vault_type_simple_title',
      'architecture_modes.vault_type_simple_description',
      'architecture_modes.vault_type_sentinel_title',
      'architecture_modes.vault_type_sentinel_description',
      'architecture_modes.replication_type_title',
      'architecture_modes.replication_type_personal_title',
      'architecture_modes.replication_type_personal_description',
      'architecture_modes.replication_type_shared_title',
      'architecture_modes.replication_type_shared_description',
      'architecture_modes.onboarding_type_title',
      'architecture_modes.onboarding_type_personal-credential-transfer_title',
      'architecture_modes.onboarding_type_personal-credential-transfer_description',
      'architecture_modes.onboarding_type_shared-provider-grant_title',
      'architecture_modes.onboarding_type_shared-provider-grant_description',
      'architecture_modes.provider_capability_title',
      'architecture_modes.provider_capability_description',
      'architecture_modes.shared_grant_manual_instructions',
      'architecture_modes.shared_grant_success',
      'architecture_modes.shared_grant_unsupported',
      'architecture_modes.sentinel_gate_title',
      'architecture_modes.sentinel_gate_description',
      'architecture_modes.sentinel_secret_creation_blocked',
      'architecture_modes.sentinel_ceremony_title',
      'architecture_modes.sentinel_ceremony_instructions',
      'architecture_modes.sentinel_ceremony_awaiting_shares',
      'architecture_modes.sentinel_ceremony_open_local',
      'architecture_modes.sentinel_ceremony_copy_share',
      'architecture_modes.sentinel_ceremony_paste_peer',
      'architecture_modes.sentinel_ceremony_unlock',
      'architecture_modes.sentinel_password_forbidden',
      'errors.validation.shared_joiner_identity_required',
      'errors.validation.shared_joiner_identity_invalid',
      'errors.validation.shared_storage_target_required',
      'onboard_device.shared_identity_label',
      'onboard_device.shared_identity_placeholder',
      'onboard_device.shared_identity_hint',
      'onboard_device.shared_identity_required',
      'onboard_device.no_compatible_sync_providers',
      'provider_picker.unsupported_current_vault',
      'provider_picker.capability_personal_only',
      'provider_picker.capability_personal_shared',
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
      'help.title',
      'help.subtitle',
      'help.in_this_guide',
      'help.jump_to_section',
      'help.diagram.device',
      'help.diagram.local_projection',
      'help.diagram.event_store',
      'help.diagram.device_keys',
      'help.diagram.sync',
      'help.diagram.nook_log',
      'help.diagram.provider_events',
      'help.diagram.set_union',
      'legal.privacy_policy',
      'legal.terms_of_service',
    ]

    for (const locale of ['en', 'ru'] as const) {
      const catalog = getTranslationCatalog(locale)
      for (const key of commonHelpKeys) {
        expect(lookupTranslation(catalog, key), `${locale}:${key}`).toBeTypeOf(
          'string',
        )
      }
      for (const section of HELP_SECTIONS) {
        const prefix = `help.sections.${section.id}`
        expect(
          lookupTranslation(catalog, `${prefix}.title`),
          `${locale}:${prefix}.title`,
        ).toBeTypeOf('string')
        expect(
          lookupTranslation(catalog, `${prefix}.summary`),
          `${locale}:${prefix}.summary`,
        ).toBeTypeOf('string')
        for (let index = 1; index <= section.bulletCount; index += 1) {
          expect(
            lookupTranslation(catalog, `${prefix}.bullet${index}`),
            `${locale}:${prefix}.bullet${index}`,
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
    expect(lookupTranslation(merged, 'provider_picker.google_drive')).toBe(
      'Google Drive',
    )
    expect(lookupTranslation(merged, 'provider_picker.this_device')).toBe(
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
      translateFromCatalog(staleRu, 'ru', 'provider_picker.google_drive'),
    ).toBe('Google Drive')
    expect(
      translateFromCatalog(staleRu, 'en', 'provider_picker.google_drive'),
    ).toBe('provider_picker.google_drive')
  })
})
