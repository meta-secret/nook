import { describe, expect, test } from 'vitest'
import { Effect } from 'effect'
import {
  LandingLocale,
  LandingStructuredDataLocalizer,
  type LandingStructuredDataLocalizationRequest,
} from '../../../src/landing/structured-data'

describe('landing structured data', () => {
  test('adds the locale when the source has no inLanguage field', () => {
    const source = {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      description: 'Original description',
    }
    const request: LandingStructuredDataLocalizationRequest = {
      serialized: JSON.stringify(source),
      description: 'Localized description',
      locale: LandingLocale.Russian,
    }
    const localizer = new LandingStructuredDataLocalizer(request)
    const localized = Effect.runSync(localizer.localize())

    expect(JSON.parse(localized)).toMatchObject({
      description: 'Localized description',
      inLanguage: LandingLocale.Russian,
    })
  })

  test('rejects structured data without a description', () => {
    const source = { '@type': 'WebApplication' }
    const request: LandingStructuredDataLocalizationRequest = {
      serialized: JSON.stringify(source),
      description: 'Localized description',
      locale: LandingLocale.English,
    }
    const localizer = new LandingStructuredDataLocalizer(request)
    const decoded = Effect.runSync(Effect.either(localizer.localize()))
    expect(decoded._tag).toBe('Left')
  })
})
