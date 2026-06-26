export type AppLocale = 'en' | 'ru'

export function parseAppLocale(
  value: string | null | undefined,
): AppLocale | null {
  if (value === 'en' || value === 'ru') return value
  return null
}

/** Map a BCP 47 language tag to a supported app locale, if any. */
export function resolveAppLocaleFromTag(tag: string): AppLocale | null {
  const normalized = tag.trim().toLowerCase().replaceAll('_', '-')
  if (!normalized) return null

  const language = normalized.split('-')[0]
  if (language === 'ru') return 'ru'
  if (language === 'en') return 'en'
  return null
}

/** Pick the first supported locale from the browser's preferred language list. */
export function resolveAppLocaleFromTags(tags: Iterable<string>): AppLocale {
  for (const tag of tags) {
    const locale = resolveAppLocaleFromTag(tag)
    if (locale) return locale
  }
  return 'en'
}

export function getBrowserAppLocale(): AppLocale {
  if (typeof navigator === 'undefined') return 'en'

  const tags =
    navigator.languages?.length > 0 ? navigator.languages : [navigator.language]

  return resolveAppLocaleFromTags(tags)
}
