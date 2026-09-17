import { describe, expect, test } from 'vitest'
import { Effect } from 'effect'
import {
  LandingStructuredDataDecodeFailureKind,
  LandingLocale,
  localizeLandingStructuredData,
} from '../../../src/landing/structured-data'

describe('landing structured data', () => {
  test('adds the locale when the source has no inLanguage field', () => {
    const localized = Effect.runSync(
      localizeLandingStructuredData({
        serialized: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'WebApplication',
          description: 'Original description',
        }),
        description: 'Localized description',
        locale: LandingLocale.Russian,
      }),
    )

    expect(JSON.parse(localized)).toMatchObject({
      description: 'Localized description',
      inLanguage: LandingLocale.Russian,
    })
  })

  test('rejects structured data without a description', () => {
    const decoding = localizeLandingStructuredData({
      serialized: JSON.stringify({ '@type': 'WebApplication' }),
      description: 'Localized description',
      locale: LandingLocale.English,
    })
    const decoded = Effect.runSync(Effect.either(decoding))
    expect(decoded._tag).toBe('Left')
    if (decoded._tag === 'Left') {
      expect(decoded.left.kind).toBe(
        LandingStructuredDataDecodeFailureKind.InvalidStructuredData,
      )
    }
  })
})
