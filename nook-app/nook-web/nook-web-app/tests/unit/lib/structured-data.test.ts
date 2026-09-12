import { describe, expect, test } from 'vitest'
import { localizeLandingStructuredData } from '../../../src/landing/structured-data'

describe('landing structured data', () => {
  test('adds the locale when the source has no inLanguage field', () => {
    const localized = localizeLandingStructuredData({
      serialized: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        description: 'Original description',
      }),
      description: 'Localized description',
      locale: 'ru',
    })

    expect(JSON.parse(localized)).toMatchObject({
      description: 'Localized description',
      inLanguage: 'ru',
    })
  })

  test('rejects structured data without a description', () => {
    expect(() =>
      localizeLandingStructuredData({
        serialized: JSON.stringify({ '@type': 'WebApplication' }),
        description: 'Localized description',
        locale: 'en',
      }),
    ).toThrow('Incomplete landing structured data.')
  })
})
