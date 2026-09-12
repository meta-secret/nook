export enum LandingLocale {
  English = 'en',
  Russian = 'ru',
}

type LandingJsonValue =
  string | number | boolean | LandingJsonValue[] | LandingJsonObject
interface LandingJsonObject {
  [key: string]: LandingJsonValue
}

function isLandingJsonObject(value: unknown): value is LandingJsonObject {
  const objectValue = Object(value)
  return (
    typeof value === 'object' &&
    objectValue === value &&
    !Array.isArray(objectValue) &&
    'description' in objectValue
  )
}

type LocalizeLandingStructuredDataRequest = {
  serialized: string
  description: string
  locale: LandingLocale
}

export function localizeLandingStructuredData(
  request: LocalizeLandingStructuredDataRequest,
): string {
  const { serialized, description, locale } = request
  const structuredData: unknown = JSON.parse(serialized)
  if (!isLandingJsonObject(structuredData)) {
    throw new Error('Incomplete landing structured data.')
  }
  structuredData.description = description
  structuredData.inLanguage = locale
  return JSON.stringify(structuredData)
}
