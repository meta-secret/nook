export type LandingLocale = 'en' | 'ru'

type LandingJsonValue =
  string | number | boolean | null | LandingJsonValue[] | LandingJsonObject
interface LandingJsonObject {
  [key: string]: LandingJsonValue
}

function isLandingJsonObject(value: unknown): value is LandingJsonObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'description' in value
  )
}

type LocalizeLandingStructuredDataRequest = {
  serialized: string | null
  description: string
  locale: LandingLocale
}

export function localizeLandingStructuredData(
  request: LocalizeLandingStructuredDataRequest,
): string {
  const { serialized, description, locale } = request
  const structuredData: unknown = JSON.parse(serialized ?? '')
  if (!isLandingJsonObject(structuredData)) {
    throw new Error('Incomplete landing structured data.')
  }
  structuredData.description = description
  structuredData.inLanguage = locale
  return JSON.stringify(structuredData)
}
